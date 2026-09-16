/**
 * The wire contract.
 *
 * Plain types, no runtime imports, one file — so the browser bundle (`src/`), the
 * Edge Functions (`supabase/functions/`) and the test scripts all describe a
 * nasheed, a note or a play the same way. Deno imports this as
 * `../../../shared/types.ts`; the client imports it as `../../shared/types`.
 *
 * A nasheed is a recording. The row carries an mp3 that a publisher uploaded to
 * the `nasheed-audio` bucket, its metadata, its lyrics and its counters — and
 * nothing about how the music should be performed, because nothing performs it.
 *
 * Where the database speaks snake_case, the raw row types say so and the client
 * mappers in `src/lib/wire.ts` turn them into the camelCase the UI uses. Nothing
 * in this file invents a field the database does not have.
 */

/* -------------------------------------------------------------------- people */

export type UserRole = "listener" | "staff";

/** `listener` is anybody with an account; `artist` is somebody with a published nasheed. */
export type UserKind = "listener" | "artist";

export type Accent = "jade" | "gold" | "turq" | "madder" | "cobalt";

/** A profile as `my_bootstrap()` and `publisher_profile()` return it. */
export type User = {
  /** the handle — this is what a URL carries (/yusuf), so it is the public id */
  id: string;
  /** the uuid — this is what foreign keys and follows carry */
  profileId: string;
  handle: string;
  name: string;
  nameAr: string | null;
  /** what they do, e.g. "singer in Algiers" */
  tagline: string;
  bio: string;
  city: string;
  accent: Accent;
  role: UserRole;
  kind: UserKind;
  verified: boolean;
  /** the storage path of their picture, not a URL — URLs are derived */
  avatarPath: string | null;
  createdAt: number;
  /** filled in from the Supabase auth session, never from the database */
  email?: string | null;
};

/** What a profile update may carry. Everything else is the database's business. */
export type ProfileInput = {
  name?: string;
  nameAr?: string | null;
  tagline?: string;
  bio?: string;
  city?: string;
  accent?: Accent;
  handle?: string;
  /** null takes the picture down; a path is what an upload returned */
  avatarPath?: string | null;
};

export type ListenerStats = {
  published: number;
  notes: number;
  loved: number;
  playlists: number;
  amens: number;
  followers: number;
  following: number;
  /** from my_listening(): what this account has actually played */
  plays: number;
  listenSeconds: number;
  days: number;
  songs: number;
  firstAt: number | null;
};

/** A signed-in account and its counters — what `me()` and a sign-in return. */
export type SessionUser = { user: User; stats: ListenerStats };

/* ------------------------------------------------------------------- prefs */

export type LyricScript = "tr" | "en" | "ar";

/**
 * Player settings, stored per account in `user_prefs`. These used to live in the
 * browser; they no longer do, so a listener who signs in elsewhere finds their
 * own theme, volume and lyric preferences waiting for them.
 */
export type PlayerPrefs = {
  theme: "night" | "dawn";
  volume: number;
  muted: boolean;
  lyricScript: LyricScript;
  showArabic: boolean;
  showTranslation: boolean;
  reduceMotion: boolean;
};

export const DEFAULT_PREFS: PlayerPrefs = {
  /* light by default: the night book is a choice, not the house */
  theme: "dawn",
  volume: 0.85,
  muted: false,
  lyricScript: "tr",
  showArabic: true,
  showTranslation: true,
  reduceMotion: false,
};

/** One row of `dhikr_counts`, keyed by phrase id in `{ [phrase]: DhikrState }`. */
export type DhikrState = { count: number; target: number };

/* ------------------------------------------------------------------- songs */

export type LyricLine = {
  /** transliteration, when a publisher supplied one */
  tr?: string;
  ar?: string;
  en?: string;
  /** attribution, e.g. "traditional" or "Qurʾān 9:128" */
  note?: string;
  /**
   * Seconds from the start of the recording. Optional, and only ever what a
   * publisher typed or imported: nothing derives timings from the audio, so a
   * lyric view only scrolls in time when real timings exist.
   */
  t?: number;
};

export type SongStatus = "live" | "removed";

/** A nasheed row as the database hands it over. */
export type Song = {
  id: string;
  ownerId: string | null;
  ownerHandle: string | null;
  ownerName: string | null;
  title: string;
  titleAr: string | null;
  note: string;
  tags: string[];
  lines: LyricLine[];
  /** storage path inside `nasheed-audio`; every live nasheed has one */
  audioPath: string;
  audioMime: string | null;
  audioBytes: number | null;
  durationMs: number | null;
  /** storage path inside `nasheed-artwork`, or null for a plain tile */
  artworkPath: string | null;
  status: SongStatus;
  publishedAt: number;
  plays: number;
  likes: number;
  notes: number;
};

/** What the publish function accepts. A path, not a file: the upload goes first. */
export type SongInput = {
  title: string;
  titleAr?: string | null;
  note?: string | null;
  tags?: string[];
  lines?: LyricLine[];
  /** required: the mp3 in the `nasheed-audio` bucket */
  audioPath: string;
  audioMime?: string | null;
  audioBytes?: number | null;
  durationMs?: number | null;
  artworkPath?: string | null;
};

/** Fields a publisher may change after the fact. */
export type SongPatch = Partial<SongInput> & { status?: SongStatus };

/** What the studio keeps per account while a nasheed is still being written. */
export type DraftLine = { tr: string; ar: string; en: string; note: string; t: number | null };

export type SongDraft = {
  title: string;
  titleAr: string;
  note: string;
  tags: string[];
  lines: DraftLine[];
  audioPath: string | null;
  audioMime: string | null;
  audioBytes: number | null;
  durationMs: number | null;
  artworkPath: string | null;
  /** editing an existing nasheed rather than writing a new one */
  songId: string | null;
  updatedAt: number;
};

/* ----------------------------------------------------------------- catalogue */

/** A publisher as the browse pages see them. */
export type ArtistCard = {
  /** handle — the public id used in URLs */
  id: string;
  profileId: string;
  handle: string;
  name: string;
  nameAr: string | null;
  /** the tagline, mapped onto the word the UI uses for it */
  role: string;
  origin: string;
  bio: string;
  accent: Accent;
  verified: boolean;
  kind: UserKind;
  /** the publisher's picture, if they have one */
  avatarPath: string | null;
  songs: number;
  followers: number;
};

export type CollectionKind = "album" | "mukhtarat" | "mix";

export type CatalogCollection = {
  id: string;
  kind: CollectionKind;
  title: string;
  titleAr: string | null;
  curator: string;
  blurb: string;
  accent: Accent;
  tags: string[];
  year: number;
  songIds: string[];
};

export type TagCount = { tag: string; count: number };

/**
 * One call loads the whole catalogue. Every field is real: nothing is generated
 * for display, so an empty catalogue answers with empty arrays.
 */
export type CatalogResponse = {
  artists: ArtistCard[];
  songs: Song[];
  collections: CatalogCollection[];
  tags: TagCount[];
  generatedAt: number;
};

/* -------------------------------------------------------------------- social */

/** A note as the UI shows it. */
export type Comment = {
  id: string;
  songId: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAccent: Accent;
  authorVerified: boolean;
  authorAvatar: string | null;
  text: string;
  atLine: number | null;
  createdAt: number;
  editedAt: number | null;
  amens: number;
  reports: number;
  removed: boolean;
  /** set by the client for the signed-in account */
  amened?: boolean;
  mine?: boolean;
};

/** The row PostgREST returns, with the author embedded. */
export type CommentRow = {
  id: string;
  song_id: string;
  author_id: string;
  text: string;
  at_line: number | null;
  edited_at: string | null;
  amens: number;
  reports: number;
  removed: boolean;
  created_at: string;
  author?: {
    id: string;
    handle: string;
    name: string;
    accent: Accent;
    verified: boolean;
    avatar_path?: string | null;
  } | null;
};

export type Playlist = {
  id: string;
  ownerId: string;
  name: string;
  blurb: string;
  accent: Accent;
  songIds: string[];
  createdAt: number;
};

/** What PostgREST returns for a `playlists` row. */
export type PlaylistRow = {
  id: string;
  owner_id: string;
  name: string;
  blurb: string;
  accent: Accent;
  song_ids: string[];
  created_at: string;
};

export type PlaylistInput = { name: string; blurb?: string; songIds?: string[]; accent?: Accent };

/* ----------------------------------------------------------------- analytics */

export type PlayInput = {
  songId: string;
  seconds: number;
  completed?: boolean;
};

export type PlayReceipt = { ok: boolean; counted?: boolean; duplicate?: boolean; plays?: number; error?: string };

/** `trending()` returns snake_case columns. */
export type TrendingDbRow = {
  song_id: string;
  title: string;
  accent: Accent;
  owner_name: string | null;
  plays: number;
  listeners: number;
  seconds: number;
  likes: number;
};

export type TrendingRow = {
  songId: string;
  title: string;
  ownerName: string | null;
  plays: number;
  listeners: number;
  seconds: number;
  likes: number;
};

export type TrendingWindow = "24h" | "7d" | "30d" | "all";

export type HistoryRow = {
  songId: string;
  title: string;
  ownerName: string | null;
  plays: number;
  seconds: number;
  lastAt: number;
};

/** `daily_curve()` returns one row per day, zero-filled. */
export type DailyPointDb = { day: string; plays: number; listeners: number; signups: number };

export type DailyPoint = { day: string; plays: number; listeners: number; signups: number };

export type SongStats = {
  plays: number;
  listeners: number;
  seconds: number;
  completed: number;
  daily: { day: string; plays: number; listeners: number }[];
};

export type Report = {
  id: string;
  commentId: string;
  reporterId: string;
  reason: string;
  createdAt: number;
  resolved: boolean;
  /** denormalised so the queue reads without three joins */
  commentText: string;
  authorHandle: string;
  songId: string;
  songTitle: string;
};

export type AdminSummary = {
  totals: {
    users: number;
    artists: number;
    songs: number;
    removed: number;
    plays: number;
    listenSeconds: number;
    notes: number;
    likes: number;
    amens: number;
    reportsOpen: number;
    storageBytes: number;
  };
  daily: DailyPoint[];
  topSongs: TrendingRow[];
  topOwners: { ownerId: string; name: string; handle: string; songs: number; plays: number }[];
  reports: Report[];
  recentSongs: {
    id: string;
    title: string;
    owner: string | null;
    status: SongStatus;
    plays: number;
    publishedAt: number;
  }[];
};

/* ------------------------------------------------------------------- results */

export type ApiError = { error: string; field?: string; status: number };

/** Everything a signed-in session needs to boot, in one round trip. */
export type BootstrapResponse = {
  user: User | null;
  stats: ListenerStats;
  prefs: PlayerPrefs;
  dhikr: Record<string, DhikrState>;
  draft: SongDraft | null;
  liked: string[];
  followed: string[];
  savedCollections: string[];
  playlists: Playlist[];
  songs: Song[];
  history: HistoryRow[];
};

export type PublisherProfile = {
  user: User;
  followers: number;
  youFollow: boolean;
  songs: Song[];
  totals: { plays: number; likes: number; notes: number };
};

/* ------------------------------------------------------------------- storage */

export type StorageBucket =
  | "nasheed-audio"
  | "nasheed-artwork"
  | "nasheed-avatars";

export const AUDIO_BUCKET: StorageBucket = "nasheed-audio";
export const ARTWORK_BUCKET: StorageBucket = "nasheed-artwork";
export const AVATAR_BUCKET: StorageBucket = "nasheed-avatars";

/**
 * What one upload may weigh. The browser brings anything larger inside these before it
 * uploads (`src/lib/compress.ts`), the buckets refuse anything larger, and the `songs`
 * table refuses a row that describes anything larger — the same two numbers, enforced
 * three times, because a limit that lives only in the interface is a suggestion.
 *
 *   a recording       5 MB   mp3, transcoded down to the best bitrate that fits
 *   cover art         2 MB   webp/jpeg, scaled down until it fits
 *   a profile picture 1 MB   jpeg/png/webp, scaled down until it fits
 */
export const MAX_AUDIO_BYTES = 5242880;
export const MAX_ARTWORK_BYTES = 2097152;
export const MAX_AVATAR_BYTES = 1048576;

/** mp3 only, and the two MIME spellings browsers and Supabase disagree about. */
export const AUDIO_MIME_TYPES = ["audio/mpeg", "audio/mp3", "audio/x-mpeg"] as const;

/** The bytes an mp3 starts with: an ID3 tag, or a raw MPEG frame header. */
export function looksLikeMp3(head: Uint8Array): boolean {
  if (head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true; // "ID3"
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return true; // frame sync
  return false;
}

export type PublishResult = { ok: true; song: Song };

/* -------------------------------------------------------------------- health */

export type HealthResponse = {
  ok: boolean;
  version: string;
  driver: "supabase";
  project: string;
  checks: { database: boolean; storage: boolean; auth: boolean };
  counts: { profiles: number; songs: number; comments: number; playEvents: number };
  storageBytes: number;
  tookMs: number;
};
