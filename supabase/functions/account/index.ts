/**
 * /account — the three things a person must be able to do to their own account.
 *
 *   POST { action: "profile" }  change a handle, a name, a bio, an accent
 *   POST { action: "export" }   take everything out as one JSON file
 *   POST { action: "delete" }   erase the account, its uploads and its rows
 *
 * The profile write is the only path that can move a handle, so it is the only place
 * that has to translate a unique-index violation into "that handle is taken". The
 * export and the delete both use the service role, because both have to read or remove
 * rows that belong to the account rather than to the request — and both therefore
 * resolve the account from the verified JWT and never from the body.
 */

import { serviceClient, withTimeout } from "../_shared/db.ts";
import { HttpError, json, readBody, serve } from "../_shared/json.ts";
import { log } from "../_shared/log.ts";
import { requireCaller, type Caller } from "../_shared/auth.ts";
import { AUDIO_BUCKET, ARTWORK_BUCKET, AVATAR_BUCKET, type Accent } from "../../../shared/types.ts";

const ACCENTS: Accent[] = ["jade", "gold", "turq", "madder", "cobalt"];
const HANDLE = /^[a-z0-9._]{3,20}$/;

type ProfilePatch = {
  name?: string;
  nameAr?: string | null;
  tagline?: string;
  bio?: string;
  city?: string;
  accent?: Accent;
  handle?: string;
  /** null takes the picture down; a path is what an upload into the bucket returned */
  avatarPath?: string | null;
};

function text(value: unknown, field: string, min: number, max: number, optional = false): string | null {
  if (value === null || value === undefined || value === "") {
    if (optional) return null;
    throw new HttpError(`${field} is required.`, 400, field);
  }
  if (typeof value !== "string") throw new HttpError(`${field} must be text.`, 400, field);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(`${field} is between ${min} and ${max} characters.`, 400, field);
  }
  return trimmed;
}

const PROFILE_KEYS = ["name", "nameAr", "tagline", "bio", "city", "accent", "handle", "avatarPath"] as const;

function profilePatch(body: Record<string, unknown>, callerId: string): ProfilePatch {
  const extra = Object.keys(body).filter((key) => key !== "action" && !PROFILE_KEYS.includes(key as typeof PROFILE_KEYS[number]));
  if (extra.length) throw new HttpError(`A profile does not have: ${extra.slice(0, 5).join(", ")}.`, 400, extra[0]);

  const patch: ProfilePatch = {};
  if ("name" in body) patch.name = text(body.name, "name", 2, 48)!;
  if ("nameAr" in body) patch.nameAr = text(body.nameAr, "nameAr", 1, 48, true);
  if ("tagline" in body) patch.tagline = text(body.tagline ?? "", "tagline", 0, 120, true) ?? "";
  if ("bio" in body) patch.bio = text(body.bio ?? "", "bio", 0, 280, true) ?? "";
  if ("city" in body) patch.city = text(body.city ?? "", "city", 0, 60, true) ?? "";
  if ("accent" in body) {
    if (typeof body.accent !== "string" || !ACCENTS.includes(body.accent as Accent)) {
      throw new HttpError(`Accent must be one of: ${ACCENTS.join(", ")}.`, 400, "accent");
    }
    patch.accent = body.accent as Accent;
  }
  if ("avatarPath" in body) {
    const value = body.avatarPath;
    if (value === null || value === "") {
      patch.avatarPath = null;
    } else if (typeof value !== "string" || value.length > 200) {
      throw new HttpError("That is not a picture path.", 400, "avatarPath");
    } else {
      /* only ever your own folder, so a path from somebody else's account cannot be
         pasted in and adopted */
      if (!value.startsWith(`${callerId}/`)) {
        throw new HttpError("A picture has to be uploaded to your own account.", 403, "avatarPath");
      }
      patch.avatarPath = value;
    }
  }
  if ("handle" in body) {
    const handle = text(body.handle, "handle", 3, 20)!.toLowerCase();
    if (!HANDLE.test(handle)) {
      throw new HttpError("A handle is 3–20 characters: a–z, 0–9, dot or underscore.", 400, "handle");
    }
    patch.handle = handle;
  }
  if (!Object.keys(patch).length) throw new HttpError("That change did nothing.", 400);
  return patch;
}

async function saveProfile(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  const patch = profilePatch(body, caller.id);
  const { data, error } = await withTimeout(
    caller.client
      .from("profiles")
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.nameAr !== undefined ? { name_ar: patch.nameAr } : {}),
        ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
        ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
        ...(patch.city !== undefined ? { city: patch.city } : {}),
        ...(patch.accent !== undefined ? { accent: patch.accent } : {}),
        ...(patch.handle !== undefined ? { handle: patch.handle } : {}),
        ...(patch.avatarPath !== undefined ? { avatar_path: patch.avatarPath } : {}),
      })
      .eq("id", caller.id)
      .select("id, handle, name, name_ar, tagline, bio, city, accent, role, kind, verified, avatar_path, created_at")
      .single(),
    8000,
    "profiles.update",
  );

  if (error) {
    if (error.code === "23505") throw new HttpError("That handle is taken.", 409, "handle");
    if (error.code === "23514") throw new HttpError("That handle is not allowed.", 400, "handle");
    if (error.code === "42501" || /row-level security/i.test(error.message)) {
      throw new HttpError("You are not allowed to change that profile.", 403);
    }
    throw new HttpError(error.message, 400);
  }

  log.info("account.profile_updated", { fields: Object.keys(patch).join(",") });
  return json({ ok: true, profile: data });
}

async function exportAccount(caller: Caller): Promise<Response> {
  const db = serviceClient();
  const uid = caller.id;

  const [profile, songs, comments, loves, playlists, history, prefs, dhikr, follows, saved] = await Promise.all([
    db.from("profiles").select("*").eq("id", uid).maybeSingle(),
    db.from("songs").select("*").eq("owner_id", uid),
    db.from("comments").select("*").eq("author_id", uid),
    db.from("loves").select("song_id, created_at").eq("profile_id", uid),
    db.from("playlists").select("*").eq("owner_id", uid),
    db.from("play_events").select("song_id, seconds, completed, day").eq("profile_id", uid).limit(5000),
    db.from("user_prefs").select("*").eq("profile_id", uid).maybeSingle(),
    db.from("dhikr_counts").select("*").eq("profile_id", uid),
    db.from("follows").select("artist_id, created_at").eq("profile_id", uid),
    db.from("saved_collections").select("collection_id, created_at").eq("profile_id", uid),
  ]);

  const firstError = [profile, songs, comments, loves, playlists, history, prefs, dhikr, follows, saved]
    .find((result) => result.error)?.error;
  if (firstError) throw new HttpError("Your data would not all load, so nothing was exported.", 502);

  log.info("account.exported", { songs: songs.data?.length ?? 0 });
  return json(
    {
      exportedAt: new Date().toISOString(),
      profile: profile.data ?? null,
      songs: songs.data ?? [],
      comments: comments.data ?? [],
      loves: loves.data ?? [],
      playlists: playlists.data ?? [],
      plays: history.data ?? [],
      prefs: prefs.data ?? null,
      dhikr: dhikr.data ?? [],
      follows: follows.data ?? [],
      savedCollections: saved.data ?? [],
    },
    { headers: { "content-disposition": 'attachment; filename="coolnasheed-export.json"' } },
  );
}

/** Everything the account owns in storage, found by prefix rather than by asking it. */
async function ownedObjects(uid: string): Promise<{ bucket: string; path: string }[]> {
  const db = serviceClient();
  const found: { bucket: string; path: string }[] = [];
  for (const bucket of [AUDIO_BUCKET, ARTWORK_BUCKET, AVATAR_BUCKET]) {
    const { data } = await withTimeout(db.storage.from(bucket).list(uid, { limit: 1000 }), 8000, "storage.list");
    for (const object of data ?? []) {
      if (object?.name) found.push({ bucket, path: `${uid}/${object.name}` });
    }
  }
  return found;
}

async function deleteAccount(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  if (body.confirm !== "delete") {
    throw new HttpError('Send { "confirm": "delete" } to erase an account.', 400, "confirm");
  }
  const db = serviceClient();
  const uid = caller.id;

  // Storage first: once the account row is gone there is no owner left to look files up
  // by, and an orphaned recording would sit in the bucket forever.
  const files = await ownedObjects(uid);
  const byBucket = new Map<string, string[]>();
  for (const file of files) {
    const list = byBucket.get(file.bucket) ?? [];
    list.push(file.path);
    byBucket.set(file.bucket, list);
  }
  for (const [bucket, paths] of byBucket) {
    const { error } = await withTimeout(db.storage.from(bucket).remove(paths), 15_000, "storage.remove");
    if (error) log.warn("account.storage_delete_failed", { bucket, count: paths.length, error: error.message });
  }

  const { error } = await withTimeout(db.auth.admin.deleteUser(uid), 12_000, "auth.deleteUser");
  if (error) {
    // A half-deleted account is worse than a failed delete: say so and stop.
    throw new HttpError(`The account could not be erased: ${error.message}`, 502);
  }

  log.info("account.deleted", { files: files.length });
  return json({ ok: true, deleted: true, files: files.length });
}

Deno.serve(
  serve(["POST"], async ({ req }) => {
    const caller = await requireCaller(req);
    const body = await readBody<Record<string, unknown>>(req);
    const action = body.action;

    switch (action) {
      case "profile":
      case "update_profile":
        return await saveProfile(caller, body);
      case "export":
        return await exportAccount(caller);
      case "delete":
        return await deleteAccount(caller, body);
      default:
        throw new HttpError("Unknown account action.", 400, "action");
    }
  }, { timeoutMs: 25_000, write: true }),
);
