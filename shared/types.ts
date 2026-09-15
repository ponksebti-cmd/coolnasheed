/**
 * The wire contract.
 *
 * Plain types, no runtime imports, one file — so the browser bundle (`src/`), the
 * Edge Functions (`supabase/functions/`) and the scripts that generate the seed all
 * describe a nasheed, a note or a play the same way. Deno imports this as
 * `../../../shared/types.ts`; the client imports it as `../../shared/types`.
 *
 * Shapes here mirror what Postgres actually returns. Where the database speaks
 * snake_case (`trending()` returns `song_id`), the raw row type says so and the
 * client mapper turns it into the camelCase the UI uses. Nothing in this file
 * invents a field the database does not have.
 */

/* -------------------------------------------------------------------- people */

export type UserRole = "listener" | "staff";

/**
 * `listener` is somebody who signed up; `artist` is a publisher in the catalogue.
 * Both are rows in `profiles`. Seeded artists have no auth user behind them, so they
 * can be followed and credited but nobody can sign in as them.
 */
export type UserKind = "listener" | "artist";

/** A profile as `my_bootstrap()` and `publisher_profile()` return it. */
export type User = {
  /** the handle — this is what a URL carries (/yusuf), so it is the public id */
  id: string;
  /** the uuid — this is what foreign keys and follows carry */
  profileId: string;
  handle: string;
  name: string;
  nameAr: string | null;
  /** what they do, e.g. "voice, no instruments" */
  tagline: string;
  bio: string;
  city: string;
  /** seed for the generated avatar pattern — the artwork is derived from it */
  seed: string;
  role: UserRole;
  kind: UserKind;
  verified: boolean;
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
  handle?: string;
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

/* --------------------------------------------------------------------- songs */

export type MaqamName =
  | "rast"
  | "bayati"
  | "hijaz"
  | "nahawand"
  | "kurd"
  | "ajam"
  | "saba"
  | "nikriz"
  | "hijazkar"
  | "ushshaq";

export const MAQAM_NAMES: MaqamName[] = [
  "rast",
  "bayati",
  "hijaz",
  "nahawand",
  "kurd",
  "ajam",
  "saba",
  "nikriz",
  "hijazkar",
  "ushshaq",
];

export type LyricLine = {
  /** transliteration — the words as they are sung, in Latin script */
  tr?: string;
  ar?: string;
  en?: string;
  /** attribution, e.g. "traditional" or "Qurʾān 9:128" */
  note?: string;
  /** seconds from the start; supplied for a recording so the karaoke view can sync */
  t?: number;
};

export type SongStatus = "live" | "removed";

/** A nasheed row as the database hands it over. */
export type Song = {
  id: string;
  ownerId: string | null;
  ownerHandle: string | null;
  title: string;
  titleAr: string | null;
  note: string;
  maqam: MaqamName;
  year: number | null;
  tags: string[];
  lines: LyricLine[];
  /** storage path inside the `nasheed-audio` bucket */
  audioPath: string | null;
  audioMime: string | null;
  durationMs: number | null;
  /** storage path inside the `nasheed-artwork` bucket; null means generated pattern */
  artworkPath: string | null;
  status: SongStatus;
  publishedAt: number;
  plays: number;
  likes: number;
  notes: number;
};

/** What the publish function accepts. Paths, not files — uploads go to Storage first. */
export type SongInput = {
  title: string;
  titleAr?: string | null;
  note?: string | null;
  maqam: MaqamName;
  year?: number | null;
  tags?: string[];
  lines?: LyricLine[];
  durationMs?: number | null;
  audioPath?: string | null;
  audioMime?: string | null;
  audioBytes?: number | null;
  artworkPath?: string | null;
};

/** Fields a publisher may change after the fact. */
export type SongPatch = Partial<SongInput> & { status?: SongStatus };

/* ----------------------------------------------------------------- catalogue */

/** A publisher as the browse pages see them. */
export type ArtistCard = {
  /** handle — the public id used in URLs */
  id: string;
  profileId: string;
  handle: string;
  name: string;
  nameAr: string | null;
  /** the tagline, mapped onto the word the UI already uses */
  role: string;
  origin: string;
  bio: string;
  seed: string;
  verified: boolean;
  kind: UserKind;
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
  seed: string;
  tags: string[];
  year: number;
  songIds: string[];
};

export type TagCount = { tag: string; count: number };

/** One call loads the whole catalogue — the `catalog` function caches it for 60s. */
export type CatalogResponse = {
  artists: ArtistCard[];
  songs: Song[];
  collections: CatalogCollection[];
  tags: TagCount[];
  generatedAt: number;
};

/* ------------------------------------------------------------------- social */

/** A note as the UI shows it. */
export type Comment = {
  id: string;
  songId: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorSeed: string;
  authorVerified: boolean;
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
    seed: string;
    verified: boolean;
  } | null;
};

export type Playlist = {
  id: string;
  ownerId: string;
  name: string;
  blurb: string;
  seed: string;
  songIds: string[];
  createdAt: number;
};

/** What PostgREST returns for a `playlists` row. */
export type PlaylistRow = {
  id: string;
  owner_id: string;
  name: string;
  blurb: string;
  seed: string;
  song_ids: string[];
  created_at: string;
};

export type PlaylistInput = { name: string; blurb?: string; songIds?: string[]; seed?: string };

/* ---------------------------------------------------------------- analytics */

export type PlayInput = {
  songId: string;
  seconds: number;
  completed?: boolean;
  clientId?: string | null;
};

export type PlayReceipt = { ok: boolean; counted?: boolean; duplicate?: boolean; plays?: number; error?: string };

/** `trending()` returns snake_case columns. */
export type TrendingDbRow = {
  song_id: string;
  title: string;
  maqam: MaqamName;
  owner_name: string | null;
  plays: number;
  listeners: number;
  seconds: number;
  likes: number;
};

export type TrendingRow = {
  songId: string;
  title: string;
  maqam: MaqamName;
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
    hasAudio: boolean;
    status: SongStatus;
    plays: number;
    publishedAt: number;
  }[];
};

/* ------------------------------------------------------------------ results */

export type ApiError = { error: string; field?: string; status: number };

/** Everything a signed-in session needs to boot, in one round trip. */
export type BootstrapResponse = {
  user: User | null;
  stats: ListenerStats;
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

/* ------------------------------------------------------------------ storage */

export type StorageBucket = "nasheed-audio" | "nasheed-artwork";

export const AUDIO_BUCKET: StorageBucket = "nasheed-audio";
export const ARTWORK_BUCKET: StorageBucket = "nasheed-artwork";

/** The free tier gives 1 GB of storage; these keep one upload from eating it. */
export const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
export const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;

export type PublishResult = { ok: true; song: Song };

/* ------------------------------------------------------------------- health */

export type HealthResponse = {
  ok: boolean;
  version: string;
  driver: "supabase";
  project: string;
  checks: { database: boolean; storage: boolean; auth: boolean; catalogue: boolean };
  counts: { profiles: number; songs: number; comments: number; playEvents: number };
  storageBytes: number;
  tookMs: number;
};
