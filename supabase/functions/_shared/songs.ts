/**
 * Song rows: what Postgres stores, and what the client is sent.
 *
 * One mapper, used by every function that returns a nasheed, so the wire shape cannot
 * drift between `publish`, `moderate` and `catalog_payload()` (which builds the same
 * object in SQL — the keys there and here are meant to match exactly).
 */

import type { LyricLine, Song, SongStatus } from "../../../shared/types.ts";

export type SongDbRow = {
  id: string;
  owner_id: string | null;
  title: string;
  title_ar: string | null;
  note: string;
  tags: string[] | null;
  lines: LyricLine[] | null;
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

/* The owner arrives joined, from the select that carries `owner:profiles(handle, name)`.
   Anything missing is null rather than invented — a nasheed with no publisher is a row
   with no publisher, and the interface says so. */
export type SongOwner = {
  owner_handle?: string | null;
  owner_name?: string | null;
};

/** Every column a select needs in order to build a `Song`. */
export const SONG_COLUMNS =
  "id, owner_id, title, title_ar, note, tags, lines, audio_path, audio_mime, audio_bytes, duration_ms, artwork_path, status, published_at, created_at, plays, likes, notes";

function epochMs(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return Date.now();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

const numberOr = (value: unknown, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export function songFromRow(
  row: SongDbRow & SongOwner,
  ownerHandle: string | null,
  ownerName: string | null = null,
): Song {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerHandle,
    ownerName,
    title: row.title,
    titleAr: row.title_ar,
    note: row.note ?? "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    lines: Array.isArray(row.lines) ? row.lines : [],
    /* A live nasheed always has a recording — the table says so. A removed one may not,
       and the client is told that honestly rather than being handed an empty string. */
    audioPath: row.audio_path ?? "",
    audioMime: row.audio_mime,
    audioBytes:
      row.audio_bytes === null || row.audio_bytes === undefined ? null : Math.round(numberOr(row.audio_bytes, 0)),
    durationMs:
      row.duration_ms === null || row.duration_ms === undefined ? null : Math.round(numberOr(row.duration_ms, 0)),
    artworkPath: row.artwork_path,
    status: row.status ?? "live",
    publishedAt: epochMs(row.published_at),
    plays: numberOr(row.plays, 0),
    likes: numberOr(row.likes, 0),
    notes: numberOr(row.notes, 0),
  };
}

/** A storage path shaped for one publisher: `<uid>/nasheed-<short>.<ext>`. */
export function storagePath(ownerId: string, prefix: string, ext: string): string {
  const safeExt = (ext || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 6) || "bin";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${ownerId}/${prefix}-${stamp}-${nonce}.${safeExt}`;
}
