/**
 * /account — the three things an account needs a server for.
 *
 *   POST { action: "profile", ...ProfileInput }   change your own profile
 *   POST { action: "export" }                     download everything you have here
 *   POST { action: "delete" }                     leave: files, rows, then the account
 *
 * Editing a profile is something the browser could do straight through PostgREST, and
 * it does for the simple fields; this endpoint exists for the two cases where a good
 * error message matters more than saving one invocation — taking a handle that is
 * already spoken for, and deleting an account, which has to happen in the right order
 * and needs the service role to touch `auth.users` at all.
 */

import { requireCaller } from "../_shared/auth.ts";
import { hasServiceKey, serviceClient } from "../_shared/db.ts";
import { HttpError, json, readBody, serve } from "../_shared/json.ts";
import { ARTWORK_BUCKET, AUDIO_BUCKET, type ProfileInput } from "../../../shared/types.ts";

const ACCENTS = ["jade", "gold", "turq", "madder", "cobalt"] as const;

/** Everything in both buckets that belongs to one uid folder. */
async function ownedFiles(client: ReturnType<typeof serviceClient>, ownerId: string) {
  const found: { bucket: string; paths: string[] }[] = [];
  for (const bucket of [AUDIO_BUCKET, ARTWORK_BUCKET]) {
    const { data } = await client.storage.from(bucket).list(ownerId, { limit: 1000 });
    const paths = (data ?? []).map((file) => `${ownerId}/${file.name}`);
    if (paths.length) found.push({ bucket, paths });
  }
  return found;
}

function clean(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new HttpError(`${field} must be text.`, 400, field);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(`${field} is at most ${max} characters.`, 400, field);
  return trimmed;
}

Deno.serve(
  serve(["POST"], async (req) => {
    const caller = await requireCaller(req);
    if (!caller.profile) throw new HttpError("Your profile is missing.", 409);

    const body = await readBody<Record<string, unknown> & Partial<ProfileInput>>(req);
    const action = typeof body.action === "string" ? body.action : "profile";

    /* -------------------------------------------------------------- profile */
    if (action === "profile") {
      const update: Record<string, unknown> = {};

      const name = clean(body.name, "name", 48);
      if (name !== undefined) {
        if (name.length < 2) throw new HttpError("A name is at least 2 characters.", 400, "name");
        update.name = name;
      }

      const nameAr = clean(body.nameAr, "nameAr", 48);
      if (nameAr !== undefined) update.name_ar = nameAr || null;

      const tagline = clean(body.tagline, "tagline", 120);
      if (tagline !== undefined) update.tagline = tagline;

      const bio = clean(body.bio, "bio", 280);
      if (bio !== undefined) update.bio = bio;

      const city = clean(body.city, "city", 60);
      if (city !== undefined) update.city = city;

      if (body.accent !== undefined) {
        if (typeof body.accent !== "string" || !ACCENTS.includes(body.accent as (typeof ACCENTS)[number])) {
          throw new HttpError(`An accent is one of: ${ACCENTS.join(", ")}.`, 400, "accent");
        }
        update.accent = body.accent;
      }

      if (body.handle !== undefined) {
        const handle = String(body.handle).trim().toLowerCase();
        if (!/^[a-z0-9._]{3,20}$/.test(handle)) {
          throw new HttpError("A handle is 3–20 characters of a-z, 0-9, dot or underscore.", 400, "handle");
        }
        const { data: taken } = await caller.client
          .from("profiles")
          .select("id")
          .neq("id", caller.id)
          .eq("handle", handle)
          .maybeSingle();
        if (taken) throw new HttpError("That handle is already spoken for.", 409, "handle");
        update.handle = handle;
      }

      if (Object.keys(update).length === 0) throw new HttpError("Nothing to change.", 400);

      const { data, error } = await caller.client
        .from("profiles")
        .update(update)
        .eq("id", caller.id)
        .select("id, handle, name, name_ar, tagline, bio, city, seed, accent, role, kind, verified, created_at")
        .single();
      if (error) throw new HttpError(`That would not save: ${error.message}`, 400);

      return json({ ok: true, profile: data });
    }

    /* --------------------------------------------------------------- export */
    if (action === "export") {
      const [profile, songs, comments, loves, playlists, follows, plays] = await Promise.all([
        caller.client.from("profiles").select("*").eq("id", caller.id).maybeSingle(),
        caller.client.from("songs").select("*").eq("owner_id", caller.id),
        caller.client.from("comments").select("*").eq("author_id", caller.id),
        caller.client.from("loves").select("*").eq("profile_id", caller.id),
        caller.client.from("playlists").select("*").eq("owner_id", caller.id),
        caller.client.from("follows").select("*").eq("profile_id", caller.id),
        caller.client.from("play_events").select("*").eq("profile_id", caller.id).limit(1000),
      ]);

      return json({
        ok: true,
        exportedAt: new Date().toISOString(),
        account: { id: caller.id, email: caller.email },
        profile: profile?.data ?? null,
        songs: songs.data ?? [],
        comments: comments.data ?? [],
        loves: loves.data ?? [],
        playlists: playlists.data ?? [],
        follows: follows.data ?? [],
        playEvents: plays.data ?? [],
      });
    }

    /* --------------------------------------------------------------- delete */
    if (action === "delete") {
      if (!hasServiceKey()) {
        throw new HttpError(
          "Deleting an account needs SUPABASE_SERVICE_ROLE_KEY on this function.",
          500,
        );
      }
      const admin = serviceClient();

      // order matters: files, then the row everything else hangs off, then the account
      let filesRemoved = 0;
      for (const group of await ownedFiles(admin, caller.id)) {
        const { error } = await admin.storage.from(group.bucket).remove(group.paths);
        if (!error) filesRemoved += group.paths.length;
      }

      const { error: profileError } = await admin.from("profiles").delete().eq("id", caller.id);
      if (profileError) throw new HttpError(`Your rows would not delete: ${profileError.message}`, 500);

      const { error: authError } = await admin.auth.admin.deleteUser(caller.id);
      if (authError) throw new HttpError(`Your account would not close: ${authError.message}`, 500);

      return json({ ok: true, deleted: true, filesRemoved });
    }

    throw new HttpError("That action does not exist here.", 404, "action");
  }),
);
