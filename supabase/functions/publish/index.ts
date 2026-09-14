/**
 * /publish — put a nasheed into the catalogue, change it, or take it down.
 *
 *   POST   { ...SongInput }          → publish
 *   PATCH  { id, ...SongPatch }      → edit your own
 *   DELETE ?id=sng_…&files=1         → take it down (and optionally give the storage back)
 *
 * The audio and the artwork are already in Storage when this is called: the browser
 * uploads them straight to the bucket with the caller's own JWT, so a 40 MB recording
 * never passes through a function, never counts against an invocation's wall time and
 * never costs memory here. What is left is the part a browser cannot be trusted to do
 * — check that the file really exists, really belongs to the caller and really is
 * inside the bucket's limits — and then write a row the rest of the app can read.
 *
 * Writes go through the caller's own client, so Row Level Security decides whether
 * the insert lands. This function is a validator with good error messages, not the
 * authority.
 */

import { requireCaller, type Caller } from "../_shared/auth.ts";
import { HttpError, json, readBody, serve } from "../_shared/json.ts";
import { songRowFrom, verifyUpload, type SongRow } from "../_shared/validate.ts";
import { SONG_COLUMNS, songFromRow, type SongDbRow } from "../_shared/songs.ts";
import {
  ARTWORK_BUCKET,
  AUDIO_BUCKET,
  type SongInput,
  type SongPatch,
  type SongStatus,
} from "../../../shared/types.ts";

const STATUSES: SongStatus[] = ["live", "removed"];

/** The columns `songRowFrom` produces, i.e. everything a publisher may write. */
const WRITABLE = [
  "title",
  "title_ar",
  "note",
  "maqam",
  "root",
  "bpm",
  "voices",
  "duff",
  "duff_enter",
  "passes",
  "accent",
  "year",
  "tags",
  "lines",
  "motif_bank",
  "audio_path",
  "audio_mime",
  "audio_bytes",
  "duration_ms",
  "artwork_path",
] as const;

/** A stored row turned back into the shape `songRowFrom` accepts, for merging. */
function inputFromDb(row: SongDbRow): SongInput {
  return {
    title: row.title,
    titleAr: row.title_ar,
    note: row.note,
    maqam: row.maqam,
    root: row.root,
    bpm: row.bpm,
    voices: row.voices,
    duff: row.duff,
    duffEnter: row.duff_enter,
    passes: row.passes,
    accent: row.accent,
    year: row.year,
    tags: row.tags ?? [],
    lines: row.lines ?? [],
    motifBank: row.motif_bank,
    durationMs: row.duration_ms,
    audioPath: row.audio_path,
    audioMime: row.audio_mime,
    audioBytes: Number(row.audio_bytes ?? 0) || null,
    artworkPath: row.artwork_path,
  };
}

/**
 * The handle a nasheed is credited to. Staff editing somebody else's work must not
 * stamp their own name on it.
 */
async function ownerHandle(caller: Caller, ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null;
  if (ownerId === caller.id) return caller.profile?.handle ?? null;
  const { data } = await caller.client.from("profiles").select("handle").eq("id", ownerId).maybeSingle();
  return (data?.handle as string | undefined) ?? null;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Only the columns that actually changed, so an edit cannot quietly blank a field. */
function diff(next: SongRow, previous: SongDbRow): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  for (const column of WRITABLE) {
    if (!same(next[column], previous[column])) update[column] = next[column];
  }
  return update;
}

async function findSong(caller: Caller, id: string): Promise<SongDbRow> {
  const { data, error } = await caller.client
    .from("songs")
    .select(SONG_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new HttpError(`That nasheed could not be read: ${error.message}`, 502);
  if (!data) throw new HttpError("There is no nasheed by that id.", 404, "id");

  const row = data as SongDbRow;
  const staff = caller.profile?.role === "staff";
  if (row.owner_id !== caller.id && !staff) {
    throw new HttpError("That nasheed is not yours.", 403);
  }
  return row;
}

/** Check the files a row points at really are in Storage, and record what they are. */
async function verifyFiles(caller: Caller, row: SongRow): Promise<void> {
  if (row.audio_path) {
    const found = await verifyUpload(caller.client, AUDIO_BUCKET, row.audio_path, caller.id);
    row.audio_bytes = found.bytes || row.audio_bytes;
    row.audio_mime = found.mime || row.audio_mime;
  }
  if (row.artwork_path) {
    await verifyUpload(caller.client, ARTWORK_BUCKET, row.artwork_path, caller.id);
  }
}

Deno.serve(
  serve(["POST", "PATCH", "DELETE"], async (req, url) => {
    const caller = await requireCaller(req);
    if (!caller.profile) {
      throw new HttpError("Your profile is missing. Sign out and back in, and it will be made.", 409);
    }

    /* ------------------------------------------------------------- publish */
    if (req.method === "POST") {
      const input = await readBody<SongInput>(req);
      const row = songRowFrom(input, caller.id);
      await verifyFiles(caller, row);

      const { data, error } = await caller.client
        .from("songs")
        .insert({ ...row, owner_id: caller.id })
        .select(SONG_COLUMNS)
        .single();

      if (error) {
        throw new HttpError(
          error.message.includes("duplicate key")
            ? "That nasheed is already in the catalogue."
            : `The catalogue refused it: ${error.message}`,
          400,
        );
      }

      const song = songFromRow(data as SongDbRow, caller.profile.handle);
      return json({ ok: true, song });
    }

    /* ---------------------------------------------------------------- edit */
    if (req.method === "PATCH") {
      const patch = await readBody<SongPatch & { id: string }>(req);
      if (typeof patch.id !== "string" || !patch.id) throw new HttpError("Which nasheed?", 400, "id");

      const previous = await findSong(caller, patch.id);
      const { id: _ignored, status, ...changes } = patch;

      // merge the patch over what is stored, then validate the whole thing once.
      // paths belong to the nasheed's owner: staff editing somebody else's work must
      // not be told the original recording is not in their own folder
      const merged = songRowFrom({ ...inputFromDb(previous), ...changes }, previous.owner_id ?? caller.id);
      const update = diff(merged, previous);

      if (status !== undefined) {
        if (!STATUSES.includes(status)) throw new HttpError("That status does not exist.", 400, "status");
        if (status !== previous.status) update.status = status;
      }
      if (Object.keys(update).length === 0) throw new HttpError("Nothing to change.", 400);

      if ("audio_path" in update && update.audio_path !== previous.audio_path) {
        await verifyUpload(caller.client, AUDIO_BUCKET, String(update.audio_path ?? ""), caller.id);
      }
      if ("artwork_path" in update && update.artwork_path !== previous.artwork_path) {
        await verifyUpload(caller.client, ARTWORK_BUCKET, String(update.artwork_path ?? ""), caller.id);
      }

      const { data, error } = await caller.client
        .from("songs")
        .update(update)
        .eq("id", previous.id)
        .select(SONG_COLUMNS)
        .single();
      if (error) throw new HttpError(`That edit would not save: ${error.message}`, 400);

      return json({ ok: true, song: songFromRow(data as SongDbRow, await ownerHandle(caller, previous.owner_id)) });
    }

    /* ---------------------------------------------------------- take down */
    const id = url.searchParams.get("id");
    if (!id) throw new HttpError("Which nasheed?", 400, "id");

    const previous = await findSong(caller, id);

    // taking a nasheed down hides it; `files=1` also gives the storage back
    const { error } = await caller.client.from("songs").update({ status: "removed" }).eq("id", id);
    if (error) throw new HttpError(`That would not come down: ${error.message}`, 400);

    let filesRemoved = 0;
    if (url.searchParams.get("files") === "1") {
      const targets = [
        previous.audio_path ? { bucket: AUDIO_BUCKET, path: previous.audio_path } : null,
        previous.artwork_path ? { bucket: ARTWORK_BUCKET, path: previous.artwork_path } : null,
      ].filter((t): t is { bucket: typeof AUDIO_BUCKET | typeof ARTWORK_BUCKET; path: string } => !!t);

      for (const target of targets) {
        const { error: removeError } = await caller.client.storage.from(target.bucket).remove([target.path]);
        if (!removeError) filesRemoved += 1;
      }
    }

    return json({ ok: true, id, status: "removed", filesRemoved });
  }),
);
