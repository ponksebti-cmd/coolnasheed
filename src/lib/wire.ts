/**
 * Rows in, models out.
 *
 * PostgREST hands back exactly what is in the table: snake_case columns, ISO
 * timestamps, storage paths. The app speaks camelCase, epoch milliseconds and
 * absolute URLs. Every conversion lives here, in one place, so a component never has
 * to know whether it is looking at a database row or a nasheed.
 *
 * The Edge Functions and the Postgres functions already return camelCase (they build
 * JSON themselves), so their payloads pass through these mappers untouched — the
 * mappers accept both spellings where that is cheap to do.
 */

import { artworkUrl, audioUrl } from "./supabase";
import { ApiError } from "./errors";
import { MAQAM_NAMES, MAX_AUDIO_BYTES } from "../../shared/types";
import type {
  Accent,
  ArtistCard,
  CatalogCollection,
  Comment,
  CommentRow,
  DailyPoint,
  DailyPointDb,
  HistoryRow,
  LyricLine,
  MaqamName,
  Playlist,
  PlaylistRow,
  Report,
  Song,
  SongInput,
  SongStatus,
  TrendingDbRow,
  TrendingRow,
  User,
  UserKind,
  UserRole,
} from "../../shared/types";

export type { CommentRow, PlaylistRow };

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
  maqam: MaqamName;
  root: number;
  bpm: number;
  voices: "solo" | "duet" | "choir";
  duff: string | null;
  duff_enter: "intro" | "verse" | null;
  passes: number | null;
  accent: Accent;
  year: number | null;
  tags: string[] | null;
  lines: LyricLine[] | null;
  motif_bank: number[] | null;
  audio_path: string | null;
  audio_mime: string | null;
  /** only read back when an edit needs to preserve it; the model does not carry it */
  audio_bytes?: number | null;
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
};

/** Every column a song read needs. */
export const SONG_COLUMNS =
  "id, owner_id, title, title_ar, note, maqam, root, bpm, voices, duff, duff_enter, passes, accent, year, tags, lines, motif_bank, audio_path, audio_mime, audio_bytes, duration_ms, artwork_path, status, published_at, created_at, plays, likes, notes";

export function songFromRow(row: SongRow): Song {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerHandle: row.ownerHandle ?? null,
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
    audioMime: row.audio_mime ?? null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    artworkPath: row.artwork_path,
    status: row.status ?? "live",
    publishedAt: epochMs(row.published_at, Date.now()),
    plays: Number(row.plays ?? 0),
    likes: Number(row.likes ?? 0),
    notes: Number(row.notes ?? 0),
  };
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
  seed: string | null;
  accent: Accent | null;
  role: UserRole;
  kind: UserKind;
  verified: boolean;
  created_at: string;
};

export const PROFILE_COLUMNS =
  "id, handle, name, name_ar, tagline, bio, city, seed, accent, role, kind, verified, created_at";

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
    seed: row.seed || `listener-${row.handle}`,
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
  "id, song_id, author_id, text, at_line, edited_at, amens, reports, removed, created_at";

/**
 * A note plus who wrote it. `viewerId` and `amenedIds` come from the caller so the
 * list arrives ready to render: no second round trip to find out which notes this
 * account has already said amin to.
 */
export function commentFromRow(
  row: CommentRow,
  viewer: { id: string | null; amened: Set<string> },
): Comment {
  const author = row.author ?? null;
  return {
    id: row.id,
    songId: row.song_id,
    authorId: author?.handle ?? row.author_id,
    authorName: author?.name ?? "Somebody",
    authorHandle: author?.handle ?? "",
    authorSeed: author?.seed || `listener-${author?.handle ?? row.author_id}`,
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

export const PLAYLIST_COLUMNS = "id, owner_id, name, blurb, seed, accent, song_ids, created_at";

export function playlistFromRow(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    blurb: row.blurb ?? "",
    seed: row.seed || `playlist-${row.id}`,
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
  seed: string | null;
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
    seed: row.seed || `artist-${row.handle}`,
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
  seed: string | null;
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
    seed: row.seed || `collection-${row.id}`,
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
  accent: row.accent,
  maqam: row.maqam,
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
    accent: (row.accent ?? "jade") as Accent,
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

/* ------------------------------------------- writing a nasheed from the browser */

/**
 * The row `publish` would have written, built here instead.
 *
 * The Edge Function is a validator with good error messages, not the authority: Row
 * Level Security decides whether an insert lands, and the same check constraints run
 * either way. So a project with the database set up but no functions deployed can
 * still publish — the browser builds the identical row and PostgREST carries it.
 *
 * That is why this mirror keeps the same rules, the same order and the same wording
 * as `supabase/functions/_shared/validate.ts`. When one changes, change both.
 */
export type SongInsertRow = {
  title: string;
  title_ar: string | null;
  note: string;
  maqam: MaqamName;
  root: number;
  bpm: number;
  voices: Song["voices"];
  duff: string | null;
  duff_enter: Song["duffEnter"];
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

const ACCENT_NAMES: Accent[] = ["jade", "gold", "turq", "madder", "cobalt"];
const VOICE_NAMES: Song["voices"][] = ["solo", "duet", "choir"];

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

function whole(value: unknown, field: string, min: number, max: number, fallback?: number): number {
  if (value === null || value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new ApiError(`${field} is required.`, 400, field);
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ApiError(`${field} must be a number.`, 400, field);
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) throw new ApiError(`${field} is between ${min} and ${max}.`, 400, field);
  return rounded;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if (value === null || value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new ApiError(`${field} is required.`, 400, field);
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ApiError(`${field} must be one of: ${allowed.join(", ")}.`, 400, field);
  }
  return value as T;
}

/** A storage path must live under the uploader's own folder — the bucket policy's rule, checked early. */
function ownedPath(value: unknown, ownerId: string, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new ApiError(`${field} must be text.`, 400, field);
  const path = value.replace(/^\/+/, "");
  if (path.includes("..") || path.includes("//")) throw new ApiError(`${field} is not a valid storage path.`, 400, field);
  if (path.length > 512) throw new ApiError(`${field} is too long.`, 400, field);
  if (path.split("/")[0] !== ownerId) throw new ApiError(`${field} must be inside your own folder.`, 403, field);
  return path;
}

function cleanTags(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new ApiError("Tags must be a list.", 400, "tags");
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
  if (!Array.isArray(value)) throw new ApiError("Lyrics must be a list of lines.", 400, "lines");
  if (value.length > 40) throw new ApiError("A nasheed is at most 40 lines here.", 400, "lines");

  const lines: LyricLine[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const line: LyricLine = {};
    for (const key of ["tr", "ar", "en", "note"] as const) {
      const v = row[key];
      if (typeof v === "string" && v.trim()) line[key] = v.trim().slice(0, 240);
    }
    if (typeof row.t === "number" && Number.isFinite(row.t) && row.t >= 0) line.t = Math.round(row.t * 1000) / 1000;
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
export function songRowFromInput(input: SongInput, ownerId: string): SongInsertRow {
  if (!input || typeof input !== "object") throw new ApiError("That was not a nasheed.", 400);

  const title = text(input.title, "title", 2, 120);
  if (!title) throw new ApiError("A title is required.", 400, "title");

  const maqam = oneOf(input.maqam, MAQAM_NAMES, "maqam");
  const duff = typeof input.duff === "string" && input.duff.trim() ? input.duff.trim() : null;
  if (duff && !/^[DT.]{16}$/.test(duff)) throw new ApiError("A drum pattern is 16 steps of D, T or .", 400, "duff");

  return {
    title,
    title_ar: text(input.titleAr, "titleAr", 1, 120, true),
    note: text(input.note ?? "", "note", 0, 480, true) ?? "",
    maqam,
    root: whole(input.root, "root", 24, 96),
    bpm: whole(input.bpm, "bpm", 30, 240),
    voices: oneOf(input.voices, VOICE_NAMES, "voices"),
    duff,
    duff_enter: oneOf(input.duffEnter, ["intro", "verse"] as const, "duffEnter", "verse"),
    passes: whole(input.passes, "passes", 1, 6, 2),
    accent: oneOf(input.accent, ACCENT_NAMES, "accent", "jade"),
    year: input.year === null || input.year === undefined ? null : whole(input.year, "year", 600, 2200),
    tags: cleanTags(input.tags),
    lines: cleanLines(input.lines),
    motif_bank: cleanMotifs(input.motifBank),
    audio_path: ownedPath(input.audioPath, ownerId, "audioPath"),
    audio_mime:
      typeof input.audioMime === "string" && input.audioMime.startsWith("audio/") ? input.audioMime.slice(0, 80) : null,
    audio_bytes:
      typeof input.audioBytes === "number" && input.audioBytes > 0
        ? Math.min(Math.round(input.audioBytes), MAX_AUDIO_BYTES)
        : null,
    duration_ms:
      input.durationMs === null || input.durationMs === undefined ? null : whole(input.durationMs, "durationMs", 1000, 86400000),
    artwork_path: ownedPath(input.artworkPath, ownerId, "artworkPath"),
  };
}

/** A stored row turned back into the shape `songRowFromInput` accepts, for merging an edit. */
export function songInputFromRow(row: SongRow): SongInput {
  return {
    title: row.title,
    titleAr: row.title_ar,
    note: row.note,
    maqam: row.maqam,
    root: Number(row.root),
    bpm: Number(row.bpm),
    voices: row.voices,
    duff: row.duff,
    duffEnter: row.duff_enter ?? "verse",
    passes: Number(row.passes ?? 2),
    accent: row.accent,
    year: row.year === null || row.year === undefined ? null : Number(row.year),
    tags: row.tags ?? [],
    lines: row.lines ?? [],
    motifBank: row.motif_bank,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    audioPath: row.audio_path,
    audioMime: row.audio_mime,
    audioBytes: Number(row.audio_bytes ?? 0) || null,
    artworkPath: row.artwork_path,
  };
}
