/**
 * Payload validation for the publish function.
 *
 * Postgres already enforces every one of these rules with a check constraint, so this
 * file is not the last line of defence — it is the first, and its job is to turn
 * `23514 value for domain ... violates check constraint` into "A title is between 2
 * and 120 characters." The database stays correct without it; people stay informed
 * because of it.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  AUDIO_BUCKET,
  ARTWORK_BUCKET,
  MAQAM_NAMES,
  MAX_ARTWORK_BYTES,
  MAX_AUDIO_BYTES,
  type Accent,
  type LyricLine,
  type MaqamName,
  type SongInput,
  type StorageBucket,
} from "../../../shared/types.ts";
import { HttpError } from "./json.ts";

const ACCENTS: Accent[] = ["jade", "gold", "turq", "madder", "cobalt"];
const VOICES = ["solo", "duet", "choir"] as const;

export type SongRow = {
  title: string;
  title_ar: string | null;
  note: string;
  maqam: MaqamName;
  root: number;
  bpm: number;
  voices: "solo" | "duet" | "choir";
  duff: string | null;
  duff_enter: "intro" | "verse";
  passes: number;
  accent: Accent;
  year: number | null;
  tags: string[];
  lines: LyricLine[];
  motif_bank: number[] | null;
  audio_path: string | null;
  audio_mime: string | null;
  audio_bytes: number | null;
  duration_ms: number | null;
  artwork_path: string | null;
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

function whole(value: unknown, field: string, min: number, max: number, fallback?: number): number {
  if (value === null || value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new HttpError(`${field} is required.`, 400, field);
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new HttpError(`${field} must be a number.`, 400, field);
  }
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) {
    throw new HttpError(`${field} is between ${min} and ${max}.`, 400, field);
  }
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
 * A storage path must live under the uploader's own folder — the same rule the bucket
 * policies enforce, checked again here so the error arrives before the insert rather
 * than as a policy violation.
 */
export function ownedPath(value: unknown, ownerId: string, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(`${field} must be text.`, 400, field);

  const path = value.replace(/^\/+/, "");
  if (path.includes("..") || path.includes("//") || path.startsWith("/")) {
    throw new HttpError(`${field} is not a valid storage path.`, 400, field);
  }
  if (path.length > 512) throw new HttpError(`${field} is too long.`, 400, field);
  if (path.split("/")[0] !== ownerId) {
    throw new HttpError(`${field} must be inside your own folder.`, 403, field);
  }
  return path;
}

function cleanTags(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError("Tags must be a list.", 400, "tags");
  const out: string[] = [];
  for (const raw of value.slice(0, 8)) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase().replace(/[^a-z0-9\- ]/g, "").replace(/\s+/g, "-");
    if (tag && tag.length <= 24 && !out.includes(tag)) out.push(tag);
  }
  return out;
}

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
      const v = row[key];
      if (typeof v === "string" && v.trim()) line[key] = v.trim().slice(0, 240);
    }
    if (typeof row.t === "number" && Number.isFinite(row.t) && row.t >= 0) {
      line.t = Math.round(row.t * 1000) / 1000;
    }
    if (line.tr || line.ar || line.en) lines.push(line);
  }
  return lines;
}

function cleanMotifs(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .map((n) => Math.round(n))
    .slice(0, 24);
  return out.length ? out : null;
}

/** Validate a full publish payload and shape it for an insert. */
export function songRowFrom(input: SongInput, ownerId: string): SongRow {
  if (!input || typeof input !== "object") throw new HttpError("That was not a nasheed.", 400);

  const title = text(input.title, "title", 2, 120);
  if (!title) throw new HttpError("A title is required.", 400, "title");

  const maqam = oneOf(input.maqam, MAQAM_NAMES, "maqam");
  const duff = typeof input.duff === "string" && input.duff.trim() ? input.duff.trim() : null;
  if (duff && !/^[DT.]{16}$/.test(duff)) {
    throw new HttpError("A drum pattern is 16 steps of D, T or .", 400, "duff");
  }

  const audioPath = ownedPath(input.audioPath, ownerId, "audioPath");
  const artworkPath = ownedPath(input.artworkPath, ownerId, "artworkPath");

  return {
    title,
    title_ar: text(input.titleAr, "titleAr", 1, 120, true),
    note: text(input.note ?? "", "note", 0, 480, true) ?? "",
    maqam,
    root: whole(input.root, "root", 24, 96),
    bpm: whole(input.bpm, "bpm", 30, 240),
    voices: oneOf(input.voices, VOICES, "voices"),
    duff,
    duff_enter: oneOf(input.duffEnter, ["intro", "verse"] as const, "duffEnter", "verse"),
    passes: whole(input.passes, "passes", 1, 6, 2),
    accent: oneOf(input.accent, ACCENTS, "accent", "jade"),
    year:
      input.year === null || input.year === undefined
        ? null
        : whole(input.year, "year", 600, 2200),
    tags: cleanTags(input.tags),
    lines: cleanLines(input.lines),
    motif_bank: cleanMotifs(input.motifBank),
    audio_path: audioPath,
    audio_mime:
      typeof input.audioMime === "string" && input.audioMime.startsWith("audio/")
        ? input.audioMime.slice(0, 80)
        : null,
    audio_bytes:
      typeof input.audioBytes === "number" && input.audioBytes > 0
        ? Math.min(Math.round(input.audioBytes), MAX_AUDIO_BYTES)
        : null,
    duration_ms:
      input.durationMs === null || input.durationMs === undefined
        ? null
        : whole(input.durationMs, "durationMs", 1000, 86400000),
    artwork_path: artworkPath,
  };
}

/**
 * Confirm an uploaded object is really there, really yours, and really within the
 * bucket's size limit. Returns its size and mime so the row can carry them.
 *
 * The caller's own client is enough: the storage policies let you list your own
 * folder, so a path that belongs to somebody else simply comes back empty.
 */
export async function verifyUpload(
  client: SupabaseClient,
  bucket: StorageBucket,
  path: string,
  ownerId: string,
): Promise<{ bytes: number; mime: string }> {
  const folder = path.split("/")[0];
  if (folder !== ownerId) throw new HttpError("That file is not in your folder.", 403);

  const search = path.split("/").slice(1).join("/");
  const { data, error } = await client.storage.from(bucket).list(folder, { search, limit: 5 });
  if (error) throw new HttpError(`Could not read ${bucket}: ${error.message}`, 400);

  const wanted = search.split("/").pop();
  const found = (data ?? []).find((file) => file.name === wanted);
  if (!found) throw new HttpError(`Nothing is stored at ${bucket}/${path}. Upload it first.`, 400);

  const metadata = (found.metadata ?? {}) as { size?: number; mimetype?: string };
  const bytes = Number(metadata.size ?? 0);
  const mime = String(metadata.mimetype ?? "");
  const limit = bucket === AUDIO_BUCKET ? MAX_AUDIO_BYTES : MAX_ARTWORK_BYTES;
  if (bytes > limit) {
    throw new HttpError(
      `That file is ${(bytes / 1048576).toFixed(1)} MB; the limit here is ${(limit / 1048576).toFixed(0)} MB.`,
      413,
    );
  }
  return { bytes, mime };
}

export { ARTWORK_BUCKET, AUDIO_BUCKET };
