/**
 * /publish — the only way a nasheed enters the catalogue.
 *
 * The browser uploads the mp3 straight to storage with the caller's own JWT (a 40 MB
 * recording never passes through a function), and this endpoint is handed a *path*.
 * It then does the five things the browser cannot be trusted to do:
 *
 *   1. proves the path belongs to the caller, in this bucket, ending in .mp3
 *   2. proves the object is really there, with a real size and a real MP3 header
 *   3. refuses unknown fields, so a typo cannot look like it worked
 *   4. forces `owner_id` to the caller — never from the body
 *   5. is idempotent per (caller, audio path), so a retried request does not publish
 *      the same recording twice
 *
 * POST creates, PATCH edits, DELETE takes a nasheed down (status, not a row delete, so
 * its notes and history stay where they are).
 */

import { hasServiceKey, serviceClient, storageObject, withTimeout } from "../_shared/db.ts";
import { invalidate } from "../_shared/cache.ts";
import { HttpError, json, readBody, serve } from "../_shared/json.ts";
import { log } from "../_shared/log.ts";
import { requireCaller, type Caller } from "../_shared/auth.ts";
import { songPatchFromInput, songRowFromInput } from "../_shared/validate.ts";
import { songFromRow, type SongDbRow } from "../_shared/songs.ts";
import { AUDIO_BUCKET, MAX_AUDIO_BYTES, looksLikeMp3, type Song } from "../../../shared/types.ts";

/**
 * A row as the client reads it.
 *
 * Postgres hands back snake_case columns; the app speaks camelCase (`audioPath`,
 * `ownerId`). Casting one to the other is not a shortcut, it is a bug with a delay on
 * it: `song.ownerId` reads as `undefined`, so the ownership test answers "that nasheed
 * belongs to somebody else" to its own owner, and `song.audioPath` reads as `undefined`,
 * so editing the title of a nasheed that has a recording is refused with "it needs an
 * mp3". Both of those were live. Every row this function returns or inspects goes
 * through here, and `scripts/contract.ts` holds this mapper to the same fixture the
 * browser side is held to.
 */
type Owner = { handle: string; name: string } | null;

function asSong(row: Record<string, unknown> | null, owner: Owner): Song {
  return songFromRow(
    row as unknown as SongDbRow,
    owner?.handle ?? null,
    owner?.name ?? null,
  );
}

/** The profile behind a row's owner_id — the caller's own in every ordinary case. */
async function ownerOf(caller: Caller, row: Record<string, unknown>): Promise<Owner> {
  const ownerId = typeof row.owner_id === "string" ? row.owner_id : null;
  if (!ownerId || ownerId === caller.id) return caller.profile ?? null;
  /* Only reachable when staff edit somebody else's nasheed; the client shows who
     published it, so it is worth one indexed read to name the right person. */
  const { data } = await withTimeout(
    serviceClient().from("profiles").select("handle, name").eq("id", ownerId).maybeSingle(),
    4000,
    "profiles.select",
  );
  return (data as Owner) ?? null;
}

const MP3_MIMES = ["audio/mpeg", "audio/mp3", "audio/x-mpeg", "application/octet-stream"];

/**
 * Read the first three bytes of the object over the public CDN and check the MP3
 * signature. A range request, so a 40 MB file costs three bytes of bandwidth.
 *
 * Returns "unverified" — not a refusal — when the CDN cannot be reached: storage has
 * already told us the object exists with an audio MIME type and a sane size, and
 * failing an upload because a HEAD request timed out would be worse than accepting it.
 */
async function verifyMp3(path: string): Promise<"ok" | "unverified" | "not-mp3"> {
  const url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${AUDIO_BUCKET}/${path}`;
  try {
    const response = await withTimeout(
      fetch(url, { headers: { range: "bytes=0-2" }, signal: AbortSignal.timeout(4000) }),
      4500,
      "mp3 sniff",
    );
    if (!response.ok && response.status !== 206) return "unverified";
    const head = new Uint8Array(await response.arrayBuffer());
    return looksLikeMp3(head) ? "ok" : "not-mp3";
  } catch {
    return "unverified";
  }
}

/** The object's real size and type, or a clear refusal. */
async function assertUploaded(caller: Caller, path: string): Promise<{ bytes: number; mime: string }> {
  if (!hasServiceKey()) {
    // Without the service key storage cannot be inspected from here. The bucket policy
    // (own folder, mp3 only, 5 MB) has already constrained the upload, so the path is
    // accepted and the check is left to the database's own constraints.
    log.warn("publish.storage_unverified", { reason: "no service key" });
    return { bytes: 0, mime: "audio/mpeg" };
  }

  const object = await storageObject(AUDIO_BUCKET, path);
  if (!object) {
    throw new HttpError("That upload is not in storage yet. Upload the mp3, then publish.", 409, "audioPath");
  }
  if (object.size <= 0) throw new HttpError("That upload is empty.", 400, "audioPath");
  if (object.size > MAX_AUDIO_BYTES) {
    throw new HttpError(
      `That recording is ${(object.size / 1048576).toFixed(1)} MB; the limit is ${MAX_AUDIO_BYTES / 1048576} MB.`,
      413,
      "audioPath",
    );
  }
  if (object.contentType && !MP3_MIMES.includes(object.contentType)) {
    throw new HttpError(`Storage has that file as ${object.contentType}. Recordings must be mp3.`, 415, "audioPath");
  }

  const sniff = await verifyMp3(path);
  if (sniff === "not-mp3") {
    throw new HttpError("That file does not look like an mp3. Re-export it and upload again.", 415, "audioPath");
  }
  return { bytes: object.size, mime: object.contentType ?? "audio/mpeg" };
}

/** An existing row for the same caller and the same upload: a retry, not a duplicate. */
async function existingForUpload(caller: Caller, path: string): Promise<Song | null> {
  const { data, error } = await withTimeout(
    caller.client
      .from("songs")
      .select("*")
      .eq("owner_id", caller.id)
      .eq("audio_path", path)
      .neq("status", "removed")
      .limit(1),
    5000,
    "songs.find",
  );
  if (error) throw new HttpError("Could not check for an existing nasheed.", 502);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  return row ? asSong(row, await ownerOf(caller, row)) : null;
}

async function create(caller: Caller, body: unknown): Promise<Response> {
  const row = songRowFromInput(body, caller.id);
  const upload = await assertUploaded(caller, row.audio_path);

  const already = await existingForUpload(caller, row.audio_path);
  if (already) {
    log.info("publish.idempotent", { requestId: caller.id, songId: already.id });
    return json({ ok: true, song: already, duplicate: true });
  }

  const { data, error } = await withTimeout(
    caller.client
      .from("songs")
      .insert({
        owner_id: caller.id,
        ...row,
        audio_mime: row.audio_mime ?? upload.mime,
        audio_bytes: row.audio_bytes ?? upload.bytes,
        status: "live",
      })
      .select("*")
      .single(),
    10_000,
    "songs.insert",
  );

  if (error) {
    if (/audio_path.*not.*null|songs_audio_required/i.test(error.message)) {
      throw new HttpError("A nasheed needs an mp3. Upload the recording first.", 400, "audioPath");
    }
    if (error.code === "42501" || /row-level security/i.test(error.message)) {
      throw new HttpError("You are not allowed to publish as that account.", 403);
    }
    if (error.code === "23505") throw new HttpError("That recording is already published.", 409);
    throw new HttpError(error.message, 400);
  }

  await invalidate("catalog");
  const song = asSong(data as Record<string, unknown>, caller.profile ?? null);
  log.info("publish.created", { requestId: caller.id, songId: song.id });
  return json({ ok: true, song }, { status: 201 });
}

/** The row the caller is allowed to touch, or a 404/403 that says which. */
async function ownedSong(caller: Caller, id: unknown): Promise<Song> {
  const songId = typeof id === "string" ? id.trim() : "";
  if (!songId || songId.length > 64) throw new HttpError("Which nasheed?", 400, "id");

  const { data, error } = await withTimeout(
    serviceClient().from("songs").select("*").eq("id", songId).maybeSingle(),
    5000,
    "songs.select",
  );
  if (error) throw new HttpError("That nasheed would not load.", 502);
  if (!data) throw new HttpError("That nasheed is not here.", 404, "id");

  const row = data as Record<string, unknown>;
  const song = asSong(row, await ownerOf(caller, row));
  const mine = song.ownerId === caller.id;
  if (!mine && caller.profile?.role !== "staff") {
    throw new HttpError("That nasheed belongs to somebody else.", 403);
  }
  return song;
}

async function edit(caller: Caller, payload: Record<string, unknown>): Promise<Response> {
  const song = await ownedSong(caller, payload.id);
  const patch = songPatchFromInput(payload.patch, song.ownerId ?? caller.id);

  if (patch.audio_path && patch.audio_path !== song.audioPath) {
    const upload = await assertUploaded(caller, patch.audio_path);
    patch.audio_bytes = patch.audio_bytes ?? upload.bytes;
    patch.audio_mime = patch.audio_mime ?? upload.mime;
  }

  const status = (payload.patch as Record<string, unknown> | undefined)?.status;
  const next: Record<string, unknown> = { ...patch };
  if (status === "live" || status === "removed") next.status = status;
  // A live nasheed always has audio, whichever way it got there.
  if (next.status === "live" && !(next.audio_path ?? song.audioPath)) {
    throw new HttpError("A nasheed needs an mp3 before it can be live.", 400, "audioPath");
  }
  if (!Object.keys(next).length) throw new HttpError("That edit changed nothing.", 400);

  const { data, error } = await withTimeout(
    caller.client.from("songs").update(next).eq("id", song.id).select("*").single(),
    8000,
    "songs.update",
  );
  if (error) throw new HttpError(error.message, error.code === "42501" ? 403 : 400);

  await invalidate("catalog");
  log.info("publish.updated", { songId: song.id, fields: Object.keys(next).length });
  const updated = data as Record<string, unknown>;
  return json({ ok: true, song: asSong(updated, await ownerOf(caller, updated)) });
}

async function remove(caller: Caller, url: URL, payload: Record<string, unknown> | null): Promise<Response> {
  const song = await ownedSong(caller, payload?.id ?? url.searchParams.get("id"));

  const { data, error } = await withTimeout(
    caller.client.from("songs").update({ status: "removed" }).eq("id", song.id).select("*").single(),
    8000,
    "songs.remove",
  );
  if (error) throw new HttpError(error.message, error.code === "42501" ? 403 : 400);

  await invalidate("catalog");
  log.info("publish.removed", { songId: song.id });
  const updated = data as Record<string, unknown>;
  return json({ ok: true, song: asSong(updated, await ownerOf(caller, updated)) });
}

Deno.serve(
  serve(
    ["POST", "PATCH", "DELETE"],
    async ({ req, url }) => {
      const caller = await requireCaller(req);

      if (req.method === "POST") {
        const body = await readBody(req);
        return create(caller, body);
      }
      if (req.method === "PATCH") {
        const body = await readBody<Record<string, unknown>>(req);
        return edit(caller, body);
      }

      // DELETE takes a body when the client can send one, a query string when it cannot
      let body: Record<string, unknown> | null = null;
      try {
        body = await readBody<Record<string, unknown>>(req);
      } catch {
        body = null;
      }
      return remove(caller, url, body);
    },
    { timeoutMs: 20_000, write: true },
  ),
);
