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
import type { LyricLine } from "../../shared/types";
import type {
  ArtistCard,
  CatalogCollection,
  Comment,
  CommentRow,
  DailyPoint,
  DailyPointDb,
  HistoryRow,
  MaqamName,
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
  year: number | null;
  tags: string[] | null;
  lines: LyricLine[] | null;
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
  "id, owner_id, title, title_ar, note, maqam, year, tags, lines, audio_path, audio_mime, audio_bytes, duration_ms, artwork_path, status, published_at, created_at, plays, likes, notes";

export function songFromRow(row: SongRow): Song {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerHandle: row.ownerHandle ?? null,
    title: row.title,
    titleAr: row.title_ar,
    note: row.note ?? "",
    maqam: row.maqam,
    year: row.year === null || row.year === undefined ? null : Number(row.year),
    tags: Array.isArray(row.tags) ? row.tags : [],
    lines: Array.isArray(row.lines) ? row.lines : [],
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
  role: UserRole;
  kind: UserKind;
  verified: boolean;
  created_at: string;
};

export const PROFILE_COLUMNS =
  "id, handle, name, name_ar, tagline, bio, city, seed, role, kind, verified, created_at";

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

export const PLAYLIST_COLUMNS = "id, owner_id, name, blurb, seed, song_ids, created_at";

export function playlistFromRow(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    blurb: row.blurb ?? "",
    seed: row.seed || `playlist-${row.id}`,
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
    tags: Array.isArray(row.tags) ? row.tags : [],
    year: Number(row.year ?? new Date().getFullYear()),
    songIds: Array.isArray(row.song_ids) ? row.song_ids : [],
  };
}

/* ---------------------------------------------------------------- analytics */

export const trendingFromRow = (row: TrendingDbRow): TrendingRow => ({
  songId: row.song_id,
  title: row.title,
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
