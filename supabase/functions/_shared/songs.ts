/**
 * Song rows: what Postgres stores, and what the client is sent.
 *
 * One mapper, used by every function that returns a nasheed, so the wire shape cannot
 * drift between `publish`, `moderate` and `catalog_payload()` (which builds the same
 * object in SQL — the keys there and here are meant to match exactly).
 */

import type { Accent, LyricLine, MaqamName, Song, SongStatus } from "../../../shared/types.ts";

export type SongDbRow = {
  id: string;
  owner_id: string | null;
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
  tags: string[] | null;
  lines: LyricLine[] | null;
  motif_bank: number[] | null;
  audio_path: string | null;
  audio_mime: string | null;
  audio_bytes: number | null;
  duration_ms: number | null;
  artwork_path: string | null;
  status: SongStatus;
  published_at: string;
  created_at: string;
  plays: number;
  likes: number;
  notes: number;
};

/** Every column a select needs in order to build a `Song`. */
export const SONG_COLUMNS =
  "id, owner_id, title, title_ar, note, maqam, root, bpm, voices, duff, duff_enter, passes, accent, year, tags, lines, motif_bank, audio_path, audio_mime, audio_bytes, duration_ms, artwork_path, status, published_at, created_at, plays, likes, notes";

function epochMs(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return Date.now();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function songFromRow(row: SongDbRow, ownerHandle: string | null): Song {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerHandle,
    title: row.title,
    titleAr: row.title_ar,
    note: row.note ?? "",
    maqam: row.maqam,
    root: Number(row.root),
    bpm: Number(row.bpm),
    voices: row.voices,
    duff: row.duff,
    duffEnter: row.duff_enter ?? "verse",
    passes: Number(row.passes ?? 2),
    accent: row.accent ?? "jade",
    year: row.year === null || row.year === undefined ? null : Number(row.year),
    tags: Array.isArray(row.tags) ? row.tags : [],
    lines: Array.isArray(row.lines) ? row.lines : [],
    motifBank: Array.isArray(row.motif_bank) ? row.motif_bank : null,
    audioPath: row.audio_path,
    audioMime: row.audio_mime,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    artworkPath: row.artwork_path,
    status: row.status ?? "live",
    publishedAt: epochMs(row.published_at),
    plays: Number(row.plays ?? 0),
    likes: Number(row.likes ?? 0),
    notes: Number(row.notes ?? 0),
  };
}

/** A storage path shaped for one publisher: `<uid>/nasheed-<short>.<ext>`. */
export function storagePath(ownerId: string, prefix: string, ext: string): string {
  const safeExt = (ext || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 6) || "bin";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${ownerId}/${prefix}-${stamp}-${nonce}.${safeExt}`;
}
