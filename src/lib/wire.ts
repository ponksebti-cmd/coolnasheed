/**
 * Rows in, models out.
 *
 * PostgREST hands back exactly what is in the table: snake_case columns, ISO
 * timestamps, storage paths. The app speaks camelCase, epoch milliseconds and absolute
 * URLs. Every conversion lives here, so a component never has to know whether it is
 * looking at a database row or at a nasheed.
 *
 * This file also holds the browser's copy of the publish validator. A project with the
 * database set up but no Edge Functions deployed still publishes — the browser builds
 * the row PostgREST will accept, and Row Level Security plus the check constraints
 * decide whether it lands. `supabase/functions/_shared/validate.ts` is the server's
 * copy, and `shared/fixtures/publish-cases.json` holds the two of them to the same
 * answers so they cannot drift apart (`npm run contract:test`).
 */

import { artworkUrl, audioUrl } from "./supabase";
import { ApiError } from "./errors";
import { MAX_AUDIO_BYTES, type Accent, type LyricLine, type SongInput } from "../../shared/types";
import type {
  ArtistCard,
  CatalogCollection,
  Comment,
  CommentRow,
  DailyPoint,
  DailyPointDb,
  HistoryRow,
  Playlist,
  PlaylistRow,
  Report,
  Song,
  SongStatus,
  TrendingDbRow,
  TrendingRow,
  User,
  UserKind,
  UserRole,
} from "../../shared/types";

export type { CommentRow, PlaylistRow };

export type Listener = { id: string | null; amened: Set<string> };

/** ISO string or epoch millis → epoch millis. */
export function epochMs(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `2026-09-14` or a full timestamp → the date part, which is all a chart label needs. */
export function dayKey(value: string | null | undefined): string {
  return String(value ?? "").slice(0, 10);
}

/* -------------------------------------------------------------------- songs */

/** What a `select` on `songs` returns. */
export type SongRow = {
  id: string;
  owner_id: string | null;
  title: string;
  title_ar: string | null;
  note: string | null;
  tags: string[] | null;
  lines: LyricLine[] | null;
  audio_path: string | null;
  audio_mime: string | null;
  audio_bytes: number | null;
  duration_ms: number | null;
  artwork_path: string | null;
  status: SongStatus;
  published_at: string;
  created_at?: string;
  plays: number;
  likes: number;
  notes: number;
  /** filled by the caller when it knows who published it */
  ownerHandle?: string | null;
  ownerName?: string | null;
};

/** Every column a song read needs. */
export const SONG_COLUMNS =
  "id, owner_id, title, title_ar, note, tags, lines, audio_path, audio_mime, audio_bytes, duration_ms, artwork_path, status, published_at, created_at, plays, likes, notes";

/**
 * A row that has no recording is not a nasheed this app can play, so it is skipped
 * rather than rendered as a dead entry. The database refuses to make one live, which
 * makes this a belt-and-braces check on old rows.
 */
export function playableRow(row: SongRow): boolean {
  return typeof row.audio_path === "string" && row.audio_path.length > 0;
}

export function songFromRow(row: SongRow): Song {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerHandle: row.ownerHandle ?? null,
    ownerName: row.ownerName ?? null,
    title: row.title,
    titleAr: row.title_ar,
    note: row.note ?? "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    lines: Array.isArray(row.lines) ? row.lines : [],
    audioPath: row.audio_path!,
    audioMime: row.audio_mime ?? null,
    audioBytes: row.audio_bytes === null || row.audio_bytes === undefined ? null : Number(row.audio_bytes),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    artworkPath: row.artwork_path,
    status: row.status ?? "live",
    publishedAt: epochMs(row.published_at, Date.now()),
    plays: Number(row.plays ?? 0),
    likes: Number(row.likes ?? 0),
    notes: Number(row.notes ?? 0),
  };
}

export function songsFromRows(rows: SongRow[] | null | undefined): Song[] {
  return (rows ?? []).filter(playableRow).map(songFromRow);
}

/** Storage paths are stored; URLs are derived. The player and the artwork want URLs. */
export const songAudioUrl = (song: Pick<Song, "audioPath">): string | null => audioUrl(song.audioPath);
export const songArtworkUrl = (song: Pick<Song, "artworkPath">): string | null => artworkUrl(song.artworkPath);

/* ------------------------------------------------------------------ profiles */

export type ProfileRow = {
  id: string;
  handle: string;
  name: string;
  name_ar: string | null;
  tagline: string | null;
  bio: string | null;
  city: string | null;
  accent: Accent | null;
  role: UserRole;
  kind: UserKind;
  verified: boolean;
  created_at: string;
};

export const PROFILE_COLUMNS =
  "id, handle, name, name_ar, tagline, bio, city, accent, role, kind, verified, created_at";

/** The public id of a person is their handle; the uuid travels beside it. */
export function userFromRow(row: ProfileRow, email?: string | null): User {
  return {
    id: row.handle,
    profileId: row.id,
    handle: row.handle,
    name: row.name,
    nameAr: row.name_ar,
    tagline: row.tagline ?? "",
    bio: row.bio ?? "",
    city: row.city ?? "",
    accent: row.accent ?? "jade",
    role: row.role ?? "listener",
    kind: row.kind ?? "listener",
    verified: Boolean(row.verified),
    createdAt: epochMs(row.created_at, Date.now()),
    email: email ?? null,
  };
}

/* ----------------------------------------------------------------- comments */

export const COMMENT_COLUMNS =
  "id, song_id, author_id, text, at_line, edited_at, amens, reports, removed, created_at, author:profiles(id, handle, name, accent, verified)";

/**
 * A note plus who wrote it. `viewer` comes from the caller so the list arrives ready to
 * render: no second round trip to find out which notes this account already amened.
 */
export function commentFromRow(row: CommentRow, viewer: Listener): Comment {
  const author = row.author ?? null;
  return {
    id: row.id,
    songId: row.song_id,
    authorId: author?.handle ?? row.author_id,
    authorName: author?.name ?? "Somebody",
    authorHandle: author?.handle ?? "",
    authorAccent: author?.accent ?? "jade",
    authorVerified: Boolean(author?.verified),
    text: row.text,
    atLine: row.at_line ?? null,
    createdAt: epochMs(row.created_at, Date.now()),
    editedAt: row.edited_at ? epochMs(row.edited_at) : null,
    amens: Number(row.amens ?? 0),
    reports: Number(row.reports ?? 0),
    removed: Boolean(row.removed),
    amened: viewer.amened.has(row.id),
    mine: viewer.id !== null && row.author_id === viewer.id,
  };
}

/* ---------------------------------------------------------------- playlists */

export const PLAYLIST_COLUMNS = "id, owner_id, name, blurb, accent, song_ids, created_at";

export function playlistFromRow(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    blurb: row.blurb ?? "",
    accent: row.accent ?? "jade",
    songIds: Array.isArray(row.song_ids) ? row.song_ids : [],
    createdAt: epochMs(row.created_at, Date.now()),
  };
}

/* ---------------------------------------------------------------- catalogue */

export type ArtistRow = {
  id: string;
  handle: string;
  name: string;
  name_ar: string | null;
  tagline: string | null;
  bio: string | null;
  city: string | null;
  accent: Accent | null;
  verified: boolean;
  kind: UserKind;
};

export function artistFromRow(row: ArtistRow, songs = 0, followers = 0): ArtistCard {
  return {
    id: row.handle,
    profileId: row.id,
    handle: row.handle,
    name: row.name,
    nameAr: row.name_ar,
    role: row.tagline || "Publisher",
    origin: row.city || "—",
    bio: row.bio ?? "",
    accent: row.accent ?? "jade",
    verified: Boolean(row.verified),
    kind: row.kind ?? "artist",
    songs,
    followers,
  };
}

export type CollectionRow = {
  id: string;
  kind: CatalogCollection["kind"];
  title: string;
  title_ar: string | null;
  curator: string | null;
  blurb: string | null;
  accent: Accent | null;
  tags: string[] | null;
  year: number | null;
  song_ids: string[] | null;
};

export function collectionFromRow(row: CollectionRow): CatalogCollection {
  return {
    id: row.id,
    kind: row.kind ?? "album",
    title: row.title,
    titleAr: row.title_ar,
    curator: row.curator || "CoolNasheed",
    blurb: row.blurb ?? "",
    accent: row.accent ?? "jade",
    tags: Array.isArray(row.tags) ? row.tags : [],
    year: Number(row.year ?? new Date().getFullYear()),
    songIds: Array.isArray(row.song_ids) ? row.song_ids : [],
  };
}

/* ---------------------------------------------------------------- analytics */

export const trendingFromRow = (row: TrendingDbRow): TrendingRow => ({
  songId: row.song_id,
  title: row.title,
  ownerName: row.owner_name,
  plays: Number(row.plays ?? 0),
  listeners: Number(row.listeners ?? 0),
  seconds: Number(row.seconds ?? 0),
  likes: Number(row.likes ?? 0),
});

export const dailyFromRow = (row: DailyPointDb): DailyPoint => ({
  day: dayKey(row.day),
  plays: Number(row.plays ?? 0),
  listeners: Number(row.listeners ?? 0),
  signups: Number(row.signups ?? 0),
});

/** `my_history()` already answers in camelCase; this only defends against nulls. */
export function historyFromRow(row: Partial<HistoryRow>): HistoryRow {
  return {
    songId: String(row.songId ?? ""),
    title: String(row.title ?? ""),
    ownerName: row.ownerName ?? null,
    plays: Number(row.plays ?? 0),
    seconds: Number(row.seconds ?? 0),
    lastAt: Number(row.lastAt ?? 0),
  };
}

export type ReportRow = {
  id: string;
  comment_id: string;
  reporter_id: string;
  reason: string;
  resolved: boolean;
  created_at: string;
  comment_text: string | null;
  author_handle: string | null;
  song_id: string | null;
  song_title: string | null;
};

export function reportFromRow(row: ReportRow): Report {
  return {
    id: row.id,
    commentId: row.comment_id,
    reporterId: row.reporter_id,
    reason: row.reason,
    createdAt: epochMs(row.created_at, Date.now()),
    resolved: Boolean(row.resolved),
    commentText: row.comment_text ?? "",
    authorHandle: row.author_handle ?? "",
    songId: row.song_id ?? "",
    songTitle: row.song_title ?? "",
  };
}

/* ------------------------------------------- writing a nasheed from the browser

   The row `publish` would have written, built here instead. The order of the checks,
   the wording of each refusal and the shape of the result are the same as
   `supabase/functions/_shared/validate.ts`; the fixture in `shared/fixtures` proves it.
*/

export type SongInsertRow = {
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

const PUBLISH_KEYS = [
  "title", "titleAr", "note", "tags", "lines",
  "audioPath", "audioMime", "audioBytes", "durationMs", "artworkPath",
] as const;

function rejectUnknown(input: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const extra = Object.keys(input).filter((key) => !allowed.includes(key));
  if (extra.length) {
    throw new ApiError(`${where} does not accept: ${extra.slice(0, 5).join(", ")}.`, 400, extra[0]);
  }
}

function text(value: unknown, field: string, min: number, max: number, optional = false): string | null {
  if (value === null || value === undefined || value === "") {
    if (optional) return null;
    throw new ApiError(`${field} is required.`, 400, field);
  }
  if (typeof value !== "string") throw new ApiError(`${field} must be text.`, 400, field);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new ApiError(`${field} is between ${min} and ${max} characters.`, 400, field);
  }
  return trimmed;
}

function whole(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ApiError(`${field} must be a number.`, 400, field);
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) throw new ApiError(`${field} is between ${min} and ${max}.`, 400, field);
  return rounded;
}

/**
 * A storage path has to live under the uploader's own folder — the same rule the bucket
 * policy enforces, checked before anything is written. `..` is refused rather than
 * normalised, because a path that is trying to climb out is not a typo.
 */
export function ownedPath(value: unknown, ownerId: string, field: string, required = false): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new ApiError(`${field} is required.`, 400, field);
    return null;
  }
  if (typeof value !== "string") throw new ApiError(`${field} must be text.`, 400, field);
  const path = value.replace(/^\/+/, "");
  if (path.includes("..") || path.includes("//") || /[\\\u0000-\u001f]/.test(path)) {
    throw new ApiError(`${field} is not a valid storage path.`, 400, field);
  }
  if (path.length > 512) throw new ApiError(`${field} is too long.`, 400, field);
  if (path.split("/")[0] !== ownerId) {
    throw new ApiError(`${field} must be inside your own folder.`, 403, field);
  }
  return path;
}

function audioPath(value: unknown, ownerId: string): string {
  const path = ownedPath(value, ownerId, "audioPath", true)!;
  if (!/\.mp3$/i.test(path)) throw new ApiError("The recording must be an .mp3 file.", 400, "audioPath");
  return path;
}

function artworkPath(value: unknown, ownerId: string): string | null {
  const path = ownedPath(value, ownerId, "artworkPath");
  if (path && !/\.(png|jpe?g|webp|avif)$/i.test(path)) {
    throw new ApiError("Cover art must be a png, jpg, webp or avif image.", 400, "artworkPath");
  }
  return path;
}

function cleanTags(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new ApiError("Tags must be a list.", 400, "tags");
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

function cleanLines(value: unknown): LyricLine[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new ApiError("Lyrics must be a list of lines.", 400, "lines");
  if (value.length > 40) throw new ApiError("A nasheed is at most 40 lines here.", 400, "lines");

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

/** Validate a full publish payload and shape it for an insert. */
export function songRowFromInput(input: SongInput, ownerId: string): SongInsertRow {
  if (!input || typeof input !== "object") throw new ApiError("That was not a nasheed.", 400);
  const payload = input as unknown as Record<string, unknown>;
  rejectUnknown(payload, PUBLISH_KEYS, "Publishing");

  const title = text(payload.title, "title", 2, 120);
  if (!title) throw new ApiError("A title is required.", 400, "title");

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

export type SongPatchRow = Partial<SongInsertRow>;

/** Validate an edit. Only the keys present are touched, and audio cannot be cleared. */
export function songPatchFromInput(input: unknown, ownerId: string): SongPatchRow {
  if (!input || typeof input !== "object") throw new ApiError("That was not an edit.", 400);
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
