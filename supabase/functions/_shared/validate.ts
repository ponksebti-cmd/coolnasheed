/**
 * Payload validation for the publish function.
 *
 * Postgres enforces every one of these rules with a check constraint, so this file is
 * not the last line of defence — it is the first, and its job is to turn
 * `23514 value for domain ... violates check constraint` into "A title is between 2 and
 * 120 characters." The database stays correct without it; people stay informed because
 * of it.
 *
 * The mirror of this file lives in `src/lib/wire.ts` (`songRowFromInput`), because a
 * project with the database but no functions deployed still publishes straight through
 * PostgREST. `shared/fixtures/publish-cases.json` holds both of them to the same
 * answers, and `npm run contract:test` fails when they drift.
 */

import {
  AUDIO_BUCKET,
  MAX_ARTWORK_BYTES,
  MAX_AUDIO_BYTES,
  type LyricLine,
  type SongInput,
  type SongPatch,
} from "../../../shared/types.ts";
import { HttpError } from "./json.ts";

/** The row shape an insert needs — no composition columns, audio is mandatory. */
export type SongRow = {
  title: string;
  title_ar: string | null;
  note: string;
  tags: string[];
  lines: LyricLine[];
  audio_path: string;
  audio_mime: string | null;
  audio_bytes: number | null;
  duration_ms: number | null;
  artwork_path: string | null;
};

export type SongPatchRow = Partial<SongRow>;

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

function whole(value: unknown, field: string, min: number, max: number, fallback?: number): number {
  if (value === null || value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new HttpError(`${field} is required.`, 400, field);
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new HttpError(`${field} must be a number.`, 400, field);
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) throw new HttpError(`${field} is between ${min} and ${max}.`, 400, field);
  return rounded;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if (value === null || value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new HttpError(`${field} is required.`, 400, field);
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpError(`${field} must be one of: ${allowed.join(", ")}.`, 400, field);
  }
  return value as T;
}

/**
 * A storage path has to live under the uploader's own folder — the same rule the
 * bucket policy enforces, checked before anything is written. `..` is refused rather
 * than normalised, because a path that is trying to climb out is not a typo.
 */
export function ownedPath(value: unknown, ownerId: string, field: string, required = false): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new HttpError(`${field} is required.`, 400, field);
    return null;
  }
  if (typeof value !== "string") throw new HttpError(`${field} must be text.`, 400, field);
  const path = value.replace(/^\/+/, "");
  if (path.includes("..") || path.includes("//") || /[\\\u0000-\u001f]/.test(path)) {
    throw new HttpError(`${field} is not a valid storage path.`, 400, field);
  }
  if (path.length > 512) throw new HttpError(`${field} is too long.`, 400, field);
  if (path.split("/")[0] !== ownerId) {
    throw new HttpError(`${field} must be inside your own folder.`, 403, field);
  }
  return path;
}

/** An mp3 in the audio bucket, or a clear refusal. */
export function audioPath(value: unknown, ownerId: string): string {
  const path = ownedPath(value, ownerId, "audioPath", true)!;
  if (!/\.mp3$/i.test(path)) {
    throw new HttpError("The recording must be an .mp3 file.", 400, "audioPath");
  }
  return path;
}

function artworkPath(value: unknown, ownerId: string): string | null {
  const path = ownedPath(value, ownerId, "artworkPath");
  if (path && !/\.(png|jpe?g|webp|avif)$/i.test(path)) {
    throw new HttpError("Cover art must be a png, jpg, webp or avif image.", 400, "artworkPath");
  }
  return path;
}

function cleanTags(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError("Tags must be a list.", 400, "tags");
  const out: string[] = [];
  for (const raw of value.slice(0, 8)) {
    if (typeof raw !== "string") continue;
    /* transliteration folds to plain letters first: "Ṣalawāt" is a tag people type,
       and "salawt" is not what they meant */
    const tag = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\- ]/g, "")
      .replace(/\s+/g, "-");
    if (tag && tag.length <= 24 && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Lines, plus whatever timings the publisher actually supplied. Nothing is invented. */
function cleanLines(value: unknown): LyricLine[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError("Lyrics must be a list of lines.", 400, "lines");
  if (value.length > 40) throw new HttpError("A nasheed is at most 40 lines here.", 400, "lines");

  const lines: LyricLine[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const line: LyricLine = {};
    for (const key of ["tr", "ar", "en", "note"] as const) {
      const item = row[key];
      if (typeof item === "string" && item.trim()) line[key] = item.trim().slice(0, 240);
    }
    if (typeof row.t === "number" && Number.isFinite(row.t) && row.t >= 0 && row.t <= 86400) {
      line.t = Math.round(row.t * 1000) / 1000;
    }
    if (line.tr || line.ar || line.en) lines.push(line);
  }
  return lines;
}

/** Unknown keys are refused rather than ignored: a typo should not look like it worked. */
export function rejectUnknown(input: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const extra = Object.keys(input).filter((key) => !allowed.includes(key));
  if (extra.length) {
    throw new HttpError(`${where} does not accept: ${extra.slice(0, 5).join(", ")}.`, 400, extra[0]);
  }
}

const PUBLISH_KEYS = [
  "title", "titleAr", "note", "tags", "lines",
  "audioPath", "audioMime", "audioBytes", "durationMs", "artworkPath",
] as const;

/** Validate a full publish payload and shape it for an insert. */
export function songRowFromInput(input: unknown, ownerId: string): SongRow {
  if (!input || typeof input !== "object") throw new HttpError("That was not a nasheed.", 400);
  const payload = input as Record<string, unknown>;
  rejectUnknown(payload, PUBLISH_KEYS, "Publishing");

  const title = text(payload.title, "title", 2, 120);
  if (!title) throw new HttpError("A title is required.", 400, "title");

  const bytes = payload.audioBytes;
  const mime = payload.audioMime;

  return {
    title,
    title_ar: text(payload.titleAr, "titleAr", 1, 120, true),
    note: text(payload.note ?? "", "note", 0, 480, true) ?? "",
    tags: cleanTags(payload.tags),
    lines: cleanLines(payload.lines),
    audio_path: audioPath(payload.audioPath, ownerId),
    audio_mime: mime === null || mime === undefined ? "audio/mpeg" : text(mime, "audioMime", 4, 60),
    audio_bytes:
      typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0
        ? Math.min(Math.round(bytes), MAX_AUDIO_BYTES)
        : null,
    duration_ms:
      payload.durationMs === null || payload.durationMs === undefined || payload.durationMs === ""
        ? null
        : whole(payload.durationMs, "durationMs", 1000, 21600000),
    artwork_path: artworkPath(payload.artworkPath, ownerId),
  };
}

/** Validate an edit. Only the keys present are touched, and audio cannot be cleared. */
export function songPatchFromInput(input: unknown, ownerId: string): SongPatchRow {
  if (!input || typeof input !== "object") throw new HttpError("That was not an edit.", 400);
  const payload = input as Record<string, unknown>;
  rejectUnknown(payload, [...PUBLISH_KEYS, "status"] as const, "An edit");

  const patch: SongPatchRow = {};
  if ("title" in payload) patch.title = text(payload.title, "title", 2, 120)!;
  if ("titleAr" in payload) patch.title_ar = text(payload.titleAr, "titleAr", 1, 120, true);
  if ("note" in payload) patch.note = text(payload.note ?? "", "note", 0, 480, true) ?? "";
  if ("tags" in payload) patch.tags = cleanTags(payload.tags);
  if ("lines" in payload) patch.lines = cleanLines(payload.lines);
  if ("audioPath" in payload) patch.audio_path = audioPath(payload.audioPath, ownerId);
  if ("audioMime" in payload) patch.audio_mime = text(payload.audioMime, "audioMime", 4, 60);
  if ("audioBytes" in payload) {
    patch.audio_bytes = typeof payload.audioBytes === "number" ? Math.round(payload.audioBytes) : null;
  }
  if ("durationMs" in payload) {
    patch.duration_ms =
      payload.durationMs === null || payload.durationMs === ""
        ? null
        : whole(payload.durationMs, "durationMs", 1000, 21600000);
  }
  if ("artworkPath" in payload) patch.artwork_path = artworkPath(payload.artworkPath, ownerId);
  return patch;
}

export const LIMITS = { audio: MAX_AUDIO_BYTES, artwork: MAX_ARTWORK_BYTES, bucket: AUDIO_BUCKET };
export type { SongInput, SongPatch };
