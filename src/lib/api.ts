/**
 * The only place in the client that talks to Supabase.
 *
 * Three kinds of call, and the choice between them is the cost model of the free tier:
 *
 *   1. PostgREST (`sb().from(...)`)  — reads and toggles: loves, amens, follows,
 *      playlists, notes, settings. No function invocation, no cold start, and Row Level
 *      Security does the authorization.
 *   2. Postgres functions (`sb().rpc(...)`) — anything that is a query with rules around
 *      it: the play beacon, the charts, the boot payload. Also free of invocation cost,
 *      and it runs in one transaction next to the data it reads.
 *   3. Edge Functions (`invoke(...)`) — the six things that genuinely need a server:
 *      a cached catalogue, publishing, moderation, account deletion, the dashboard,
 *      health. Every one of them has a direct fallback where a fallback is honest, and
 *      says so plainly where it is not (only account deletion truly needs the secret key).
 *
 * With no project configured (`VITE_SUPABASE_URL` empty) every method here raises
 * `DemoModeError`, which the interface renders as "connect a project" rather than as a
 * failure. There is no bundled catalogue to fall back to: the catalogue is the database.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  audioUrl,
  artworkUrl,
  hasSupabase,
  invoke,
  maybeSb,
  projectRef,
  sb,
  supabaseUrl,
  upload,
  type InvokeInit,
} from "./supabase";
import {
  ApiError,
  ApiUnreachable,
  AuthError,
  DemoModeError,
  errorMessage,
  errorField,
} from "./errors";
import {
  COMMENT_COLUMNS,
  PLAYLIST_COLUMNS,
  PROFILE_COLUMNS,
  SONG_COLUMNS,
  artistFromRow,
  collectionFromRow,
  commentFromRow,
  dailyFromRow,
  epochMs,
  historyFromRow,
  playlistFromRow,
  reportFromRow,
  songFromRow,
  songPatchFromInput,
  songRowFromInput,
  songsFromRows,
  trendingFromRow,
  userFromRow,
  type ArtistRow,
  type CollectionRow,
  type CommentRow,
  type PlaylistRow,
  type ProfileRow,
  type ReportRow,
  type SongRow,
} from "./wire";
import {
  AUDIO_BUCKET,
  ARTWORK_BUCKET,
  DEFAULT_PREFS,
  type Accent,
  type AdminSummary,
  type ArtistCard,
  type BootstrapResponse,
  type CatalogCollection,
  type CatalogResponse,
  type Comment,
  type DailyPoint,
  type DhikrState,
  type HealthResponse,
  type HistoryRow,
  type ListenerStats,
  type PlayerPrefs,
  type Playlist,
  type PlaylistInput,
  type PlayInput,
  type PlayReceipt,
  type ProfileInput,
  type PublisherProfile,
  type Report,
  type SessionUser,
  type Song,
  type SongDraft,
  type SongInput,
  type SongPatch,
  type SongStats,
  type SongStatus,
  type StorageBucket,
  type TagCount,
  type TrendingRow,
  type TrendingWindow,
  type User,
} from "../../shared/types";

export {
  ApiError,
  ApiUnreachable,
  AuthError,
  DemoModeError,
  errorMessage,
  errorField,
};

/* ------------------------------------------------------------------- errors */

type DbError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

/**
 * Which column Postgres was complaining about, when it says.
 *
 * `null value in column "maqam" of relation "songs" violates not-null constraint`
 * is the whole truth, and it is the difference between "something is required" and
 * "your database is still the old shape". PostgREST puts the sentence in `details`
 * on some errors and in `message` on others, so both are read.
 */
function offendingColumn(error: DbError): string | null {
  const haystack = `${error.details ?? ""} ${error.message ?? ""}`;
  const match = haystack.match(/column\s+"?([a-z_][a-z0-9_]*)"?/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/** The columns only the composition-era schema had. Meeting one means an old database. */
const LEGACY_COLUMNS = new Set([
  "maqam",
  "root",
  "bpm",
  "voices",
  "duff",
  "duff_enter",
  "passes",
  "motif_bank",
  "seed",
]);

/**
 * Postgres and PostgREST error codes, translated into sentences.
 *
 * Exported because this mapping *is* the message people read when a write fails, and it
 * has been wrong in a way that cost somebody an evening (every 23502 was reported as a
 * missing recording, whatever column was actually at fault). A pure function of the
 * database's answer deserves to be pinned by a test.
 */
export function apiErrorFromDb(error: DbError, action = "That"): ApiError {
  const message = error.message || action;
  const column = offendingColumn(error);

  /* A required column the client deliberately does not send any more is not a missing
     field — it is a database from an earlier build. Saying "a nasheed needs its
     recording" here sent somebody looking for a file that was already uploaded. */
  if (column && LEGACY_COLUMNS.has(column)) {
    return new ApiError(
      `This database is an older version of CoolNasheed's schema: it still wants a "${column}" value, which recordings do not have. Run \`npm run setup\` (or paste \`supabase/setup.sql\` into Supabase's SQL editor) and retry.`,
      400,
      "schema",
    );
  }

  switch (error.code) {
    case "23505":
      return new ApiError("That is already there.", 409);
    case "23502":
      /* Name the column. A blanket sentence about recordings was wrong often enough to
         send people looking for a file they had already uploaded. */
      if (
        column === "audio_path" ||
        column === "audio_bytes" ||
        column === "audio_mime"
      ) {
        return new ApiError(
          "This nasheed has no recording attached yet. Upload the mp3 in step 1, wait for it to finish, then publish.",
          400,
          "audio",
        );
      }
      if (column === "title")
        return new ApiError("A nasheed needs a title.", 400, "title");
      return new ApiError(
        column
          ? `Postgres refused that: "${column}" may not be empty.`
          : "Postgres refused that: something required was missing.",
        400,
        column ?? undefined,
      );
    case "23503":
      return new ApiError(
        "That does not line up with the rest of the catalogue.",
        400,
      );
    case "23514": {
      const constraint =
        message.match(/check constraint\s+"?(\w+)"?/i)?.[1] ?? "";
      if (constraint === "songs_audio_required") {
        return new ApiError(
          "This nasheed cannot go live without its recording: upload the mp3 in step 1 first.",
          400,
          "audio",
        );
      }
      const cleaned = message
        .replace(/^.*check constraint\s+"?\w+"?\s*/, "")
        .trim();
      return new ApiError(
        cleaned || `That does not satisfy "${constraint || "a rule"}".`,
        400,
        constraint || undefined,
      );
    }
    case "42501":
      return new AuthError("You are not allowed to do that.");
    case "PGRST116":
    case "PGRST117":
      return new ApiError("Nothing matched that.", 404);
    case "PGRST205":
    case "42P01":
      return new ApiError(
        "This Supabase project has no tables yet — the backend is not set up.",
        503,
        "schema",
      );
    case "22023":
      return new ApiError(message, 400);
    default:
      if (/row-level security|permission denied/i.test(message)) {
        return new AuthError(
          "You are not allowed to do that. Sign in again and retry.",
        );
      }
      if (/network|fetch failed|Failed to fetch/i.test(message)) {
        return new ApiUnreachable();
      }
      return new ApiError(message, 400);
  }
}

function unwrap<T>(
  result: { data: T | null; error: DbError | null },
  action: string,
): T {
  if (result.error) throw apiErrorFromDb(result.error, action);
  if (result.data === null || result.data === undefined)
    throw new ApiError(`Nothing came back: ${action}.`, 404);
  return result.data;
}

function unwrapMaybe<T>(
  result: { data: T | null; error: DbError | null },
  action: string,
): T | null {
  if (result.error) throw apiErrorFromDb(result.error, action);
  return result.data ?? null;
}

function list<T>(
  result: { data: T[] | null; error: DbError | null },
  action: string,
): T[] {
  if (result.error) throw apiErrorFromDb(result.error, action);
  return result.data ?? [];
}

function authMessage(message: string): {
  text: string;
  field?: "email" | "password" | "identity" | "handle";
} {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login"))
    return { text: "That email and password do not match.", field: "password" };
  if (lower.includes("email not confirmed")) {
    return {
      text: "Confirm your email address first — the link is in your inbox.",
      field: "email",
    };
  }
  if (
    lower.includes("already registered") ||
    lower.includes("already been registered")
  ) {
    return {
      text: "That email already has an account. Sign in instead.",
      field: "email",
    };
  }
  if (lower.includes("password"))
    return { text: "That password is not strong enough.", field: "password" };
  if (lower.includes("rate limit"))
    return { text: "Too many attempts. Wait a minute and try again." };
  return { text: message };
}

async function requireClient(action: string): Promise<SupabaseClient> {
  const client = maybeSb();
  if (!client) throw new DemoModeError(action);
  return client;
}

async function requireUid(
  action: string,
): Promise<{ client: SupabaseClient; uid: string }> {
  const client = await requireClient(action);
  const { data } = await client.auth.getUser();
  if (!data.user) throw new AuthError(`Sign in to ${action}.`);
  return { client, uid: data.user.id };
}

/** `songs` has no owner handle on the row; fill it in from the people it points at. */
async function withOwners(
  client: SupabaseClient,
  rows: SongRow[],
): Promise<SongRow[]> {
  const ids = [
    ...new Set(
      rows.map((row) => row.owner_id).filter((id): id is string => !!id),
    ),
  ];
  if (!ids.length) return rows;
  const owners = await client
    .from("profiles")
    .select("id, handle, name")
    .in("id", ids);
  const byId = new Map(
    (owners.data ?? []).map((owner) => [owner.id as string, owner]),
  );
  return rows.map((row) => {
    const owner = row.owner_id ? byId.get(row.owner_id) : undefined;
    return {
      ...row,
      ownerHandle: owner?.handle ?? null,
      ownerName: owner?.name ?? null,
    };
  });
}

async function songsFrom(
  client: SupabaseClient,
  rows: SongRow[],
): Promise<Song[]> {
  return songsFromRows(await withOwners(client, rows));
}

/* -------------------------------------------------------------- functions */

let functionsReady: boolean | null = null;

/** Whether the Edge Functions answer. `null` until something has tried. */
export function functionsAvailable(): boolean | null {
  return functionsReady;
}

function isMissingFunction(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 404 || error.status === 501 || error.status === 502)
    return true;
  /* status 0 is "we never got a real response" — a project with nothing deployed answers
     exactly like that, and the direct path is written for it */
  if (error.status === 0) return true;
  return /function/i.test(error.message);
}

/**
 * Call an Edge Function, and fall back to the direct path when the functions are not
 * deployed. A project with the schema but no functions is a perfectly reasonable state —
 * the fallback exists so it is not a broken one.
 */
async function viaFunction<T>(
  name: string,
  init: InvokeInit,
  direct: () => Promise<T>,
): Promise<T> {
  if (!hasSupabase) throw new DemoModeError(`call ${name}`);
  try {
    const result = await invoke<T>(name, init);
    functionsReady = true;
    return result;
  } catch (error) {
    if (!isMissingFunction(error)) {
      functionsReady = false;
      throw error;
    }
    functionsReady = false;
    return await direct();
  }
}

/* ------------------------------------------------------------------ session */

function emptyStats(): ListenerStats {
  return {
    published: 0,
    notes: 0,
    loved: 0,
    playlists: 0,
    amens: 0,
    followers: 0,
    following: 0,
    plays: 0,
    listenSeconds: 0,
    days: 0,
    songs: 0,
    firstAt: null,
  };
}

export type Bootstrap = Omit<BootstrapResponse, "user"> & { user: User | null };

function bootstrapFrom(data: unknown): Bootstrap {
  const payload = (data ?? {}) as Partial<BootstrapResponse>;
  return {
    user: payload.user ?? null,
    stats: { ...emptyStats(), ...(payload.stats ?? {}) },
    prefs: { ...DEFAULT_PREFS, ...(payload.prefs ?? {}) },
    dhikr: payload.dhikr ?? {},
    draft: payload.draft ?? null,
    liked: payload.liked ?? [],
    followed: payload.followed ?? [],
    savedCollections: payload.savedCollections ?? [],
    playlists: (payload.playlists ?? []).map((playlist) => ({
      ...playlist,
      songIds: playlist.songIds ?? [],
    })),
    songs: payload.songs ?? [],
    history: (payload.history ?? []).map(historyFromRow),
  };
}

async function sessionFromClient(client: SupabaseClient): Promise<SessionUser> {
  const { data: userData } = await client.auth.getUser();
  const id = userData.user?.id ?? null;
  if (!id) throw new AuthError();
  const email = userData.user?.email ?? null;

  const { data, error } = await client.rpc("my_bootstrap");
  if (error) throw apiErrorFromDb(error, "your profile");
  const payload = bootstrapFrom(data);
  if (!payload.user) {
    const row = unwrapMaybe(
      await client
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", id)
        .maybeSingle(),
      "your profile",
    ) as ProfileRow | null;
    if (!row)
      throw new ApiError(
        "Your profile is missing. Sign out and back in to remake it.",
        404,
      );
    return { user: userFromRow(row, email), stats: emptyStats() };
  }
  return { user: { ...payload.user, email }, stats: payload.stats };
}

/* -------------------------------------------------------------- catalogue */

let catalogCache: { payload: CatalogResponse; at: number } | null = null;
const CATALOG_TTL = 30_000;

async function readCatalog(fresh = false): Promise<CatalogResponse> {
  if (!fresh && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL)
    return catalogCache.payload;

  const load = async (): Promise<CatalogResponse> => {
    const client = sb("load the catalogue");
    const { data, error } = await client.rpc("catalog_payload");
    if (error) throw apiErrorFromDb(error, "the catalogue");
    const payload = (data ?? {}) as Partial<CatalogResponse>;
    return {
      artists: payload.artists ?? [],
      songs: payload.songs ?? [],
      collections: payload.collections ?? [],
      tags: payload.tags ?? [],
      generatedAt: Number(payload.generatedAt ?? Date.now()),
    };
  };

  if (!hasSupabase) throw new DemoModeError("load the catalogue");

  let payload: CatalogResponse;
  try {
    payload = await invoke<CatalogResponse>("catalog", {
      method: "GET",
      query: fresh ? { fresh: 1 } : {},
    });
    functionsReady = true;
    if (fresh) await readCatalogDirect();
    payload = { ...payload, songs: payload.songs ?? [] };
  } catch (error) {
    if (!isMissingFunction(error)) {
      functionsReady = false;
      throw error;
    }
    functionsReady = false;
    payload = await load();
  }

  catalogCache = { payload, at: Date.now() };
  return payload;
}

async function readCatalogDirect(): Promise<void> {
  catalogCache = null;
}

export function invalidateCatalog(): void {
  catalogCache = null;
}

/* -------------------------------------------------------------- the client */

export type SongQuery = {
  limit?: number;
  offset?: number;
  sort?: "new" | "plays" | "likes" | "trending";
  window?: TrendingWindow;
  status?: SongStatus;
  tag?: string;
  q?: string;
  owner?: string | "me";
  ids?: string[];
};

export type Page<T> = { items: T[]; total: number; next: number | null };

export type SongDetail = {
  song: Song;
  viewer: { liked: boolean; owner: boolean };
  stats: SongStats;
  audioUrl: string | null;
  artworkUrl: string | null;
};

export type SignupInput = {
  name: string;
  handle: string;
  password: string;
  email?: string;
  city?: string;
};

export type SignupResult =
  { pending: true; message: string } | ({ pending: false } & SessionUser);

export type LibraryFile = {
  path: string;
  bucket: StorageBucket;
  bytes: number;
  mime: string;
  createdAt: number;
  url: string;
};

export const api = {
  /* ------------------------------------------------------------- system */

  get configured(): boolean {
    return hasSupabase;
  },

  backend: () => ({ hasSupabase, projectRef, url: supabaseUrl }),

  health: () => invoke<HealthResponse>("health", { method: "GET" }),

  /* ---------------------------------------------------------- catalogue */

  catalog: (fresh = false) => readCatalog(fresh),

  artists: async (): Promise<ArtistCard[]> => (await readCatalog()).artists,

  collections: async (): Promise<CatalogCollection[]> =>
    (await readCatalog()).collections,

  tags: async (): Promise<TagCount[]> => (await readCatalog()).tags,

  publisher: async (idOrHandle: string): Promise<PublisherProfile> => {
    const client = sb("open a publisher page");
    const { data, error } = await client.rpc("publisher_profile", {
      p_id: idOrHandle,
    });
    if (error) throw apiErrorFromDb(error, "that publisher");
    if (!data)
      throw new ApiError("There is no publisher by that name.", 404, "handle");
    return data as unknown as PublisherProfile;
  },

  artist: (idOrHandle: string) => api.publisher(idOrHandle),

  /* --------------------------------------------------------------- songs */

  songs: async (query: SongQuery = {}): Promise<Page<Song>> => {
    const client = sb("browse the catalogue");
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);

    if (query.ids?.length) {
      const rows = list(
        await client
          .from("songs")
          .select(SONG_COLUMNS)
          .in("id", query.ids)
          .neq("status", "removed"),
        "those nasheeds",
      ) as SongRow[];
      const items = await songsFrom(client, rows);
      const order = new Map(query.ids.map((id, index) => [id, index]));
      items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      return { items, total: items.length, next: null };
    }

    // "trending" is a chart, not a sort: it reads the daily rollups
    if (query.sort === "trending") {
      const chart = await api.trending(query.window ?? "7d", limit);
      const ids = chart.rows.map((row) => row.songId);
      if (!ids.length) return { items: [], total: 0, next: null };
      return await api.songs({ ids });
    }

    let select = client.from("songs").select(SONG_COLUMNS, { count: "exact" });

    select = select.eq("status", query.status ?? "live");
    if (query.tag) select = select.contains("tags", [query.tag]);
    if (query.q) {
      const needle = query.q.trim().replace(/[,%()]/g, " ");
      if (needle)
        select = select.or(
          `title.ilike.%${needle}%,note.ilike.%${needle}%,title_ar.ilike.%${needle}%`,
        );
    }
    if (query.owner) {
      if (query.owner === "me") {
        const { uid } = await requireUid("see what you published");
        select = select.eq("owner_id", uid);
      } else {
        const row = unwrapMaybe(
          await client
            .from("profiles")
            .select("id")
            .eq("handle", query.owner.toLowerCase())
            .maybeSingle(),
          "that publisher",
        ) as { id: string } | null;
        if (!row) return { items: [], total: 0, next: null };
        select = select.eq("owner_id", row.id);
      }
    }

    const order =
      query.sort === "plays"
        ? { column: "plays", ascending: false }
        : query.sort === "likes"
          ? { column: "likes", ascending: false }
          : { column: "published_at", ascending: false };

    const { data, error, count } = await select
      .order(order.column, { ascending: order.ascending })
      .range(offset, offset + limit - 1);

    if (error) throw apiErrorFromDb(error, "the catalogue");
    const rows = (data ?? []) as SongRow[];
    const items = await songsFrom(client, rows);
    const total = count ?? items.length;
    return {
      items,
      total,
      next: offset + limit < total ? offset + limit : null,
    };
  },

  song: async (id: string): Promise<SongDetail> => {
    const client = sb("open a nasheed");
    const { data: userData } = await client.auth.getUser();
    const uid = userData.user?.id ?? null;

    const row = unwrap(
      await client
        .from("songs")
        .select(SONG_COLUMNS)
        .eq("id", id)
        .maybeSingle(),
      "that nasheed",
    ) as SongRow;
    const [song] = await songsFrom(client, [row]);

    const liked = uid
      ? Boolean(
          (
            await client
              .from("loves")
              .select("song_id")
              .eq("profile_id", uid)
              .eq("song_id", id)
              .maybeSingle()
          ).data,
        )
      : false;

    const stats = await api.songStats(id).catch<SongStats>(() => ({
      plays: song?.plays ?? 0,
      listeners: 0,
      seconds: 0,
      completed: 0,
      daily: [],
    }));

    return {
      song: song ?? songFromRow(row),
      viewer: { liked, owner: !!uid && row.owner_id === uid },
      stats,
      audioUrl: audioUrl(row.audio_path),
      artworkUrl: artworkUrl(row.artwork_path),
    };
  },

  related: async (id: string, limit = 8): Promise<{ items: Song[] }> => {
    const client = sb("look for more");
    const song = unwrap(
      await client
        .from("songs")
        .select("id, tags, owner_id")
        .eq("id", id)
        .maybeSingle(),
      "that nasheed",
    ) as { tags: string[] | null; owner_id: string | null };

    const byTag = song.tags?.length
      ? (list(
          await client
            .from("songs")
            .select(SONG_COLUMNS)
            .eq("status", "live")
            .contains("tags", song.tags.slice(0, 3))
            .neq("id", id)
            .limit(limit),
          "more like this",
        ) as SongRow[])
      : [];

    if (byTag.length >= limit) return { items: await songsFrom(client, byTag) };

    const byOwner = song.owner_id
      ? (list(
          await client
            .from("songs")
            .select(SONG_COLUMNS)
            .eq("status", "live")
            .eq("owner_id", song.owner_id)
            .neq("id", id)
            .limit(limit),
          "more from that publisher",
        ) as SongRow[])
      : [];

    const seen = new Set(byTag.map((row) => row.id));
    const merged = [
      ...byTag,
      ...byOwner.filter((row) => !seen.has(row.id)),
    ].slice(0, limit);
    return { items: await songsFrom(client, merged) };
  },

  /* -------------------------------------------------------------- notes */

  comments: async (
    songId: string,
    options: { limit?: number; order?: "asc" | "desc" } = {},
  ): Promise<Comment[]> => {
    const client = sb("read the notes");
    const { data: userData } = await client.auth.getUser();
    const uid = userData.user?.id ?? null;

    const rows = list(
      await client
        .from("comments")
        .select(COMMENT_COLUMNS)
        .eq("song_id", songId)
        .order("created_at", { ascending: options.order === "asc" })
        .limit(Math.min(options.limit ?? 60, 200)),
      "the notes",
    ) as unknown as CommentRow[];

    const amened = new Set<string>();
    if (uid && rows.length) {
      const ids = rows.map((row) => row.id);
      const result = await client
        .from("amens")
        .select("comment_id")
        .eq("profile_id", uid)
        .in("comment_id", ids);
      for (const row of result.data ?? [])
        amened.add(String((row as { comment_id: string }).comment_id));
    }

    return rows.map((row) => commentFromRow(row, { id: uid, amened }));
  },

  myComments: async (limit = 100): Promise<Comment[]> => {
    const { client, uid } = await requireUid("see your notes");
    const rows = list(
      await client
        .from("comments")
        .select(COMMENT_COLUMNS)
        .eq("author_id", uid)
        .order("created_at", { ascending: false })
        .limit(limit),
      "your notes",
    ) as unknown as CommentRow[];
    return rows.map((row) =>
      commentFromRow(row, { id: uid, amened: new Set() }),
    );
  },

  addComment: async (
    songId: string,
    text: string,
    atLine?: number | null,
  ): Promise<{ comment: Comment; songId: string }> => {
    const { client, uid } = await requireUid("leave a note");
    const clean = text.trim().slice(0, 600);
    if (!clean) throw new ApiError("Write something first.", 400, "text");

    const row = unwrap(
      await client
        .from("comments")
        .insert({
          song_id: songId,
          author_id: uid,
          text: clean,
          at_line: atLine ?? null,
        })
        .select(COMMENT_COLUMNS)
        .single(),
      "that note",
    ) as unknown as CommentRow;

    return {
      comment: commentFromRow(row, { id: uid, amened: new Set([row.id]) }),
      songId,
    };
  },

  editComment: async (
    id: string,
    text: string,
  ): Promise<{ comment: Comment | null }> => {
    const { client, uid } = await requireUid("edit your note");
    const clean = text.trim().slice(0, 600);
    if (!clean) throw new ApiError("A note cannot be empty.", 400, "text");
    const row = unwrap(
      await client
        .from("comments")
        .update({ text: clean, edited_at: new Date().toISOString() })
        .eq("id", id)
        .select(COMMENT_COLUMNS)
        .single(),
      "that note",
    ) as unknown as CommentRow;
    return { comment: commentFromRow(row, { id: uid, amened: new Set() }) };
  },

  deleteComment: async (
    id: string,
  ): Promise<{ ok: boolean; comment: null }> => {
    const { client } = await requireUid("delete your note");
    const { error } = await client.from("comments").delete().eq("id", id);
    if (error) throw apiErrorFromDb(error, "that note");
    return { ok: true, comment: null };
  },

  amen: async (
    commentId: string,
  ): Promise<{ amened: boolean; amens: number; commentId: string }> => {
    const { client, uid } = await requireUid("say amin");
    const existing = (
      await client
        .from("amens")
        .select("comment_id")
        .eq("profile_id", uid)
        .eq("comment_id", commentId)
        .maybeSingle()
    ).data;

    if (existing) {
      const { error } = await client
        .from("amens")
        .delete()
        .eq("profile_id", uid)
        .eq("comment_id", commentId);
      if (error) throw apiErrorFromDb(error, "that amin");
      return { amened: false, amens: 0, commentId };
    }

    const { error } = await client
      .from("amens")
      .insert({ profile_id: uid, comment_id: commentId });
    if (error) throw apiErrorFromDb(error, "that amin");
    const { data } = await client
      .from("comments")
      .select("amens")
      .eq("id", commentId)
      .maybeSingle();
    return {
      amened: true,
      amens: Number((data as { amens?: number } | null)?.amens ?? 0),
      commentId,
    };
  },

  report: async (
    commentId: string,
    reason: string,
  ): Promise<{ ok: boolean }> => {
    const client = sb("report a note");
    const { error } = await client.rpc("report_comment", {
      p_comment_id: commentId,
      p_reason: reason,
    });
    if (error) throw apiErrorFromDb(error, "that report");
    return { ok: true };
  },

  resolveReport: async (
    id: string,
    hide: boolean,
  ): Promise<{ ok: boolean }> => {
    const client = sb("resolve a report");
    const { error } = await client.rpc("resolve_report", {
      p_report_id: id,
      p_hide: hide,
    });
    if (error) throw apiErrorFromDb(error, "that report");
    return { ok: true };
  },

  /* ------------------------------------------------------------- social */

  like: async (
    songId: string,
  ): Promise<{ liked: boolean; likes: number; songId: string }> => {
    const { client, uid } = await requireUid("love a nasheed");
    const existing = (
      await client
        .from("loves")
        .select("song_id")
        .eq("profile_id", uid)
        .eq("song_id", songId)
        .maybeSingle()
    ).data;

    if (existing) {
      const { error } = await client
        .from("loves")
        .delete()
        .eq("profile_id", uid)
        .eq("song_id", songId);
      if (error) throw apiErrorFromDb(error, "that");
    } else {
      const { error } = await client
        .from("loves")
        .insert({ profile_id: uid, song_id: songId });
      if (error) throw apiErrorFromDb(error, "that");
    }

    const { data } = await client
      .from("songs")
      .select("likes")
      .eq("id", songId)
      .maybeSingle();
    return {
      liked: !existing,
      likes: Number((data as { likes?: number } | null)?.likes ?? 0),
      songId,
    };
  },

  likedIds: async (): Promise<{ songIds: string[] }> => {
    const { client, uid } = await requireUid("see your loved nasheeds");
    const rows = list(
      await client.from("loves").select("song_id").eq("profile_id", uid),
      "your loves",
    );
    return {
      songIds: rows.map((row) => String((row as { song_id: string }).song_id)),
    };
  },

  follow: async (
    artistId: string,
  ): Promise<{ following: boolean; artistId: string }> => {
    const { client, uid } = await requireUid("follow a publisher");
    const target = await client
      .from("profiles")
      .select("id")
      .eq("handle", artistId.toLowerCase())
      .maybeSingle();
    const id = (target.data as { id?: string } | null)?.id;
    if (!id)
      throw new ApiError("There is no publisher by that name.", 404, "handle");
    if (id === uid) throw new ApiError("You cannot follow yourself.", 400);

    const existing = (
      await client
        .from("follows")
        .select("artist_id")
        .eq("profile_id", uid)
        .eq("artist_id", id)
        .maybeSingle()
    ).data;

    if (existing) {
      const { error } = await client
        .from("follows")
        .delete()
        .eq("profile_id", uid)
        .eq("artist_id", id);
      if (error) throw apiErrorFromDb(error, "that");
      return { following: false, artistId };
    }
    const { error } = await client
      .from("follows")
      .insert({ profile_id: uid, artist_id: id });
    if (error) throw apiErrorFromDb(error, "that");
    return { following: true, artistId };
  },

  followedIds: async (): Promise<{ artistIds: string[] }> => {
    const { client, uid } = await requireUid("see who you follow");
    const rows = list(
      await client.from("follows").select("artist_id").eq("profile_id", uid),
      "who you follow",
    );
    const ids = rows.map((row) =>
      String((row as { artist_id: string }).artist_id),
    );
    if (!ids.length) return { artistIds: [] };
    const people = list(
      await client.from("profiles").select("id, handle").in("id", ids),
      "those publishers",
    );
    return {
      artistIds: people.map((person) =>
        String((person as { handle: string }).handle),
      ),
    };
  },

  /* ---------------------------------------------------------- playlists */

  playlists: async (): Promise<Playlist[]> => {
    const { client, uid } = await requireUid("see your sets");
    const rows = list(
      await client
        .from("playlists")
        .select(PLAYLIST_COLUMNS)
        .eq("owner_id", uid)
        .order("created_at", { ascending: false }),
      "your sets",
    ) as PlaylistRow[];
    return rows.map(playlistFromRow);
  },

  playlist: async (id: string): Promise<Playlist & { songs: Song[] }> => {
    const client = sb("open a set");
    const row = unwrap(
      await client
        .from("playlists")
        .select(PLAYLIST_COLUMNS)
        .eq("id", id)
        .maybeSingle(),
      "that set",
    ) as PlaylistRow;
    const playlist = playlistFromRow(row);
    const page = playlist.songIds.length
      ? await api.songs({ ids: playlist.songIds })
      : { items: [] as Song[] };
    return { ...playlist, songs: page.items };
  },

  createPlaylist: async (input: PlaylistInput): Promise<Playlist> => {
    const { client, uid } = await requireUid("make a set");
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new ApiError("A set needs a name.", 400, "name");
    const row = unwrap(
      await client
        .from("playlists")
        .insert({
          owner_id: uid,
          name,
          blurb: (input.blurb ?? "").trim().slice(0, 280),
          accent: input.accent ?? "jade",
          song_ids: input.songIds ?? [],
        })
        .select(PLAYLIST_COLUMNS)
        .single(),
      "that set",
    ) as PlaylistRow;
    return playlistFromRow(row);
  },

  updatePlaylist: async (
    id: string,
    patch: {
      name?: string;
      blurb?: string;
      accent?: Accent;
      songIds?: string[];
    },
  ): Promise<Playlist | null> => {
    const { client } = await requireUid("change a set");
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim().slice(0, 80);
      if (!name) throw new ApiError("A set needs a name.", 400, "name");
      update.name = name;
    }
    if (patch.blurb !== undefined)
      update.blurb = patch.blurb.trim().slice(0, 280);
    if (patch.accent !== undefined) update.accent = patch.accent;
    if (patch.songIds !== undefined)
      update.song_ids = patch.songIds.slice(0, 500);
    if (!Object.keys(update).length) return null;

    const row = unwrap(
      await client
        .from("playlists")
        .update(update)
        .eq("id", id)
        .select(PLAYLIST_COLUMNS)
        .single(),
      "that set",
    ) as PlaylistRow;
    return playlistFromRow(row);
  },

  deletePlaylist: async (id: string): Promise<{ ok: boolean }> => {
    const { client } = await requireUid("delete a set");
    const { error } = await client.from("playlists").delete().eq("id", id);
    if (error) throw apiErrorFromDb(error, "that set");
    return { ok: true };
  },

  playlistSong: async (
    id: string,
    songId: string,
    remove = false,
  ): Promise<{
    playlist: Playlist | null;
    added: boolean;
    removed: boolean;
  }> => {
    const { client } = await requireUid("change a set");
    const row = unwrap(
      await client
        .from("playlists")
        .select("song_ids")
        .eq("id", id)
        .maybeSingle(),
      "that set",
    ) as { song_ids: string[] | null };
    const current = row.song_ids ?? [];
    const next = remove
      ? current.filter((entry) => entry !== songId)
      : [...current.filter((entry) => entry !== songId), songId];
    const updated = await api.updatePlaylist(id, { songIds: next });
    return { playlist: updated, added: !remove, removed: remove };
  },

  savedCollections: async (): Promise<{ collectionIds: string[] }> => {
    const { client, uid } = await requireUid("see your saved shelves");
    const rows = list(
      await client
        .from("saved_collections")
        .select("collection_id")
        .eq("profile_id", uid),
      "your saved shelves",
    );
    return {
      collectionIds: rows.map((row) =>
        String((row as { collection_id: string }).collection_id),
      ),
    };
  },

  saveCollection: async (
    collectionId: string,
  ): Promise<{ saved: boolean; collectionId: string }> => {
    const { client, uid } = await requireUid("save a shelf");
    const existing = (
      await client
        .from("saved_collections")
        .select("collection_id")
        .eq("profile_id", uid)
        .eq("collection_id", collectionId)
        .maybeSingle()
    ).data;
    if (existing) {
      const { error } = await client
        .from("saved_collections")
        .delete()
        .eq("profile_id", uid)
        .eq("collection_id", collectionId);
      if (error) throw apiErrorFromDb(error, "that");
      return { saved: false, collectionId };
    }
    const { error } = await client
      .from("saved_collections")
      .insert({ profile_id: uid, collection_id: collectionId });
    if (error) throw apiErrorFromDb(error, "that");
    return { saved: true, collectionId };
  },

  /* ----------------------------------------------------------- publishing */

  /**
   * Publish a nasheed. The mp3 is already in storage; this sends a path.
   *
   * Through the `publish` function when it is deployed (it verifies the object exists,
   * sniffs the mp3 header and is idempotent per upload), and straight to PostgREST when
   * it is not — where RLS and the check constraints do the same job with less to say
   * when something is wrong.
   */
  publish: async (input: SongInput): Promise<{ ok: true; song: Song }> =>
    viaFunction<{ ok: true; song: Song }>(
      "publish",
      { method: "POST", body: input },
      async () => {
        const { client, uid } = await requireUid("publish");
        const row = songRowFromInput(input, uid);
        const inserted = unwrap(
          await client
            .from("songs")
            .insert({ owner_id: uid, ...row, status: "live" })
            .select(SONG_COLUMNS)
            .single(),
          "that nasheed",
        ) as SongRow;
        const [song] = await songsFrom(client, [inserted]);
        return { ok: true as const, song: song ?? songFromRow(inserted) };
      },
    ),

  updateSong: async (
    id: string,
    patch: SongPatch,
  ): Promise<{ ok: true; song: Song }> =>
    viaFunction<{ ok: true; song: Song }>(
      "publish",
      { method: "PATCH", body: { id, patch } },
      async () => {
        const { client, uid } = await requireUid("edit a nasheed");
        const row = songPatchFromInput(patch, uid);
        const update: Record<string, unknown> = { ...row };
        if (patch.status) update.status = patch.status;
        if (!Object.keys(update).length)
          throw new ApiError("That edit changed nothing.", 400);
        const updated = unwrap(
          await client
            .from("songs")
            .update(update)
            .eq("id", id)
            .select(SONG_COLUMNS)
            .single(),
          "that nasheed",
        ) as SongRow;
        const [song] = await songsFrom(client, [updated]);
        return { ok: true as const, song: song ?? songFromRow(updated) };
      },
    ),

  setSongStatus: async (
    id: string,
    status: SongStatus,
  ): Promise<{ song: Song | null }> => {
    const result = await api.updateSong(id, { status });
    return { song: result.song };
  },

  /**
   * Take a nasheed down. `files` also removes the uploads from storage; the default
   * keeps them, because a taken-down nasheed is usually one that will come back.
   */
  removeSong: async (id: string, files = false): Promise<{ ok: boolean }> =>
    viaFunction<{ ok: boolean }>(
      "publish",
      { method: "DELETE", body: { id } },
      async () => {
        const { client } = await requireUid("remove a nasheed");
        const { error } = await client
          .from("songs")
          .update({ status: "removed" })
          .eq("id", id);
        if (error) throw apiErrorFromDb(error, "that nasheed");
        return { ok: true };
      },
    ).then(async (result) => {
      if (!files) return result;
      await api.deleteFilesFor(id).catch(() => {});
      return result;
    }),

  /** Remove the uploaded mp3 (and cover) behind a nasheed. Best effort. */
  deleteFilesFor: async (id: string): Promise<void> => {
    const client = sb("remove files");
    const row = unwrap(
      await client
        .from("songs")
        .select("owner_id, audio_path, artwork_path")
        .eq("id", id)
        .maybeSingle(),
      "that nasheed",
    ) as {
      owner_id: string | null;
      audio_path: string | null;
      artwork_path: string | null;
    };
    if (row.audio_path)
      await client.storage.from(AUDIO_BUCKET).remove([row.audio_path]);
    if (row.artwork_path)
      await client.storage.from(ARTWORK_BUCKET).remove([row.artwork_path]);
  },

  /* -------------------------------------------------------------- uploads */

  uploadAudio: async (
    file: File,
    onStage?: (progress: number) => void,
  ): Promise<{ path: string; bytes: number; mime: string }> => {
    const { uid } = await requireUid("upload a recording");
    if (!/\.mp3$/i.test(file.name)) {
      throw new ApiError("Recordings must be .mp3 files.", 400, "audio");
    }
    const stored = await upload(uid, "recording", file, {
      bucket: AUDIO_BUCKET,
      contentType: "audio/mpeg",
      onStage,
    });
    return {
      path: stored.path,
      bytes: stored.bytes,
      mime: stored.contentType || "audio/mpeg",
    };
  },

  uploadArtwork: async (file: File): Promise<{ path: string }> => {
    const { uid } = await requireUid("upload cover art");
    const { path } = await upload(uid, "cover", file, {
      bucket: ARTWORK_BUCKET,
    });
    return { path };
  },

  /* ------------------------------------------------------------ analytics */

  play: async (input: PlayInput): Promise<PlayReceipt> => {
    const client = maybeSb();
    if (!client) return { ok: false, error: "not configured" };
    const { data, error } = await client.rpc("record_play", {
      p_song_id: input.songId,
      p_seconds: input.seconds,
      p_completed: input.completed ?? false,
    });
    if (error) throw apiErrorFromDb(error, "that listen");
    return (data ?? { ok: true }) as PlayReceipt;
  },

  trending: async (
    window: TrendingWindow = "7d",
    limit = 10,
  ): Promise<{
    window: TrendingWindow;
    rows: TrendingRow[];
    generatedAt: number;
  }> => {
    const client = sb("read the charts");
    const rows = list(
      await client.rpc("trending", { p_window: window, p_limit: limit }),
      "the charts",
    );
    return {
      window,
      rows: (rows as unknown as Parameters<typeof trendingFromRow>[0][]).map(
        trendingFromRow,
      ),
      generatedAt: Date.now(),
    };
  },

  daily: async (days = 14): Promise<DailyPoint[]> => {
    const client = sb("read the charts");
    const rows = list(
      await client.rpc("daily_curve", { p_days: days }),
      "the charts",
    );
    return (rows as unknown as Parameters<typeof dailyFromRow>[0][]).map(
      dailyFromRow,
    );
  },

  history: async (limit = 30): Promise<HistoryRow[]> => {
    const { client } = await requireUid("see your history");
    const { data, error } = await client.rpc("my_history", { p_limit: limit });
    if (error) throw apiErrorFromDb(error, "your history");
    return ((data ?? []) as Partial<HistoryRow>[]).map(historyFromRow);
  },

  playTotals: async (): Promise<{
    count: number;
    seconds: number;
    firstAt: number | null;
    days: number;
    songs: number;
  }> => {
    const { client } = await requireUid("see your listening");
    const { data, error } = await client.rpc("my_listening");
    if (error) throw apiErrorFromDb(error, "your listening");
    const payload = (data ?? {}) as {
      plays?: number;
      listenSeconds?: number;
      firstAt?: number | null;
      days?: number;
      songs?: number;
    };
    return {
      count: Number(payload.plays ?? 0),
      seconds: Number(payload.listenSeconds ?? 0),
      firstAt: payload.firstAt ?? null,
      days: Number(payload.days ?? 0),
      songs: Number(payload.songs ?? 0),
    };
  },

  songStats: async (id: string): Promise<SongStats> => {
    const client = sb("read a nasheed's numbers");
    const { data, error } = await client.rpc("song_stats", { p_song_id: id });
    if (error) throw apiErrorFromDb(error, "those numbers");
    const stats = (data ?? {}) as Partial<SongStats>;
    return {
      plays: Number(stats.plays ?? 0),
      listeners: Number(stats.listeners ?? 0),
      seconds: Number(stats.seconds ?? 0),
      completed: Number(stats.completed ?? 0),
      daily: stats.daily ?? [],
    };
  },

  songAnalytics: async (
    id: string,
  ): Promise<{ song: Song; stats: SongStats }> => {
    const [detail, stats] = await Promise.all([
      api.song(id),
      api.songStats(id),
    ]);
    return { song: detail.song, stats };
  },

  /* --------------------------------------------------------------- staff */

  adminOverview: (days = 14) =>
    invoke<AdminSummary>("analytics", {
      method: "GET",
      query: { view: "admin", days },
    }),

  adminSongs: async (): Promise<{
    items: Song[];
    total: number;
    removed: number;
  }> => {
    const client = sb("read the catalogue");
    const rows = list(
      await client
        .from("songs")
        .select(SONG_COLUMNS)
        .order("published_at", { ascending: false })
        .limit(200),
      "the catalogue",
    ) as SongRow[];
    const items = await songsFrom(client, rows);
    return {
      items,
      total: items.length,
      removed: items.filter((song) => song.status === "removed").length,
    };
  },

  moderate: (action: string, payload: Record<string, unknown> = {}) =>
    viaFunction<Record<string, unknown>>(
      "moderate",
      { method: "POST", body: { action, ...payload } },
      async () => {
        // The queue and every action behind it need the secret key. Say so, once.
        throw new ApiError(
          "Moderation needs the `moderate` Edge Function, which is not deployed on this project. `npx supabase functions deploy moderate`.",
          501,
          "functions",
        );
      },
    ),

  reportQueue: async (): Promise<Report[]> => {
    const client = sb("read the moderation queue");
    const rows = list(
      await client
        .from("reports")
        .select(
          "id, comment_id, reporter_id, reason, resolved, created_at, comment_text, author_handle, song_id, song_title",
        )
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(100),
      "the moderation queue",
    ) as ReportRow[];
    return rows.map(reportFromRow);
  },

  /* --------------------------------------------------------------- account */

  signup: async (input: SignupInput): Promise<SignupResult> => {
    const client = sb("create an account");
    const email = (input.email ?? "").trim();
    if (!email)
      throw new ApiError("An email address is required.", 400, "email");

    const { data, error } = await client.auth.signUp({
      email,
      password: input.password,
      options: {
        data: {
          handle: input.handle.trim().toLowerCase().replace(/^@/, ""),
          name: input.name.trim().slice(0, 48),
          city: (input.city ?? "").trim().slice(0, 60),
        },
      },
    });
    if (error) {
      const shaped = authMessage(error.message);
      throw new ApiError(shaped.text, 400, shaped.field ?? "email");
    }
    if (!data.session) {
      return {
        pending: true,
        message:
          "Account created. Check your email to confirm it, then sign in here.",
      };
    }
    return { pending: false, ...(await sessionFromClient(client)) };
  },

  signin: async (identity: string, password: string): Promise<SessionUser> => {
    const client = sb("sign in");
    const clean = identity.trim();
    if (!clean.includes("@")) {
      throw new ApiError("Sign in with your email address.", 400, "identity");
    }
    const { data, error } = await client.auth.signInWithPassword({
      email: clean,
      password,
    });
    if (error) {
      const shaped = authMessage(error.message);
      throw new ApiError(shaped.text, 400, shaped.field ?? "identity");
    }
    if (!data.session) throw new AuthError("That did not start a session.");
    return sessionFromClient(client);
  },

  signout: async (): Promise<{ ok: boolean }> => {
    const client = maybeSb();
    if (client) await client.auth.signOut();
    catalogCache = null;
    return { ok: true };
  },

  me: async (): Promise<SessionUser | null> => {
    const client = maybeSb();
    if (!client) return null;
    const { data } = await client.auth.getUser();
    if (!data.user) return null;
    try {
      return await sessionFromClient(client);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },

  /** Everything about you in one round trip: profile, counters, settings, sets, history. */
  bootstrap: async (): Promise<Bootstrap> => {
    const client = sb("load your library");
    const { data, error } = await client.rpc("my_bootstrap");
    if (error) throw apiErrorFromDb(error, "your library");
    return bootstrapFrom(data);
  },

  updateProfile: async (patch: ProfileInput): Promise<SessionUser> => {
    const client = await requireClient("change your profile");
    await viaFunction<{ ok: boolean }>(
      "account",
      { method: "POST", body: { action: "profile", ...patch } },
      async () => {
        const { uid } = await requireUid("change your profile");
        const update: Record<string, unknown> = {};
        if (patch.name !== undefined) update.name = patch.name.trim();
        if (patch.nameAr !== undefined)
          update.name_ar = patch.nameAr?.trim() || null;
        if (patch.tagline !== undefined) update.tagline = patch.tagline.trim();
        if (patch.bio !== undefined) update.bio = patch.bio.trim();
        if (patch.city !== undefined) update.city = patch.city.trim();
        if (patch.accent !== undefined) update.accent = patch.accent;
        if (patch.handle !== undefined)
          update.handle = patch.handle.trim().toLowerCase();
        if (!Object.keys(update).length)
          throw new ApiError("Nothing to change.", 400);
        const { error } = await client
          .from("profiles")
          .update(update)
          .eq("id", uid);
        if (error) throw apiErrorFromDb(error, "your profile");
        return { ok: true };
      },
    );
    return sessionFromClient(client);
  },

  changePassword: async (
    current: string,
    next: string,
  ): Promise<{ ok: boolean }> => {
    const client = await requireClient("change your password");
    const { data } = await client.auth.getUser();
    const email = data.user?.email;
    if (!email)
      throw new ApiError(
        "This account has no email to verify against.",
        400,
        "password",
      );

    if (current) {
      const { error } = await client.auth.signInWithPassword({
        email,
        password: current,
      });
      if (error)
        throw new ApiError(
          "That is not your current password.",
          400,
          "password",
        );
    }
    const { error } = await client.auth.updateUser({ password: next });
    if (error) {
      const shaped = authMessage(error.message);
      throw new ApiError(shaped.text, 400, shaped.field ?? "password");
    }
    return { ok: true };
  },

  deleteAccount: async (): Promise<{ ok: boolean; filesRemoved: number }> =>
    viaFunction<{ ok: boolean; filesRemoved: number }>(
      "account",
      { method: "POST", body: { action: "delete", confirm: "delete" } },
      async () => {
        throw new ApiError(
          "Closing an account needs the `account` Edge Function — erasing a user in auth.users takes the secret key, which a browser must never hold. Deploy it with `npx supabase functions deploy account`.",
          501,
          "functions",
        );
      },
    ),

  exportAccount: () =>
    viaFunction<Record<string, unknown>>(
      "account",
      { method: "POST", body: { action: "export" } },
      async () => {
        const { client, uid } = await requireUid("export your account");
        const [
          profile,
          songs,
          comments,
          loves,
          playlists,
          follows,
          plays,
          prefs,
          dhikr,
        ] = await Promise.all([
          client.from("profiles").select("*").eq("id", uid).maybeSingle(),
          client.from("songs").select("*").eq("owner_id", uid),
          client.from("comments").select("*").eq("author_id", uid),
          client.from("loves").select("*").eq("profile_id", uid),
          client.from("playlists").select("*").eq("owner_id", uid),
          client.from("follows").select("*").eq("profile_id", uid),
          client
            .from("play_events")
            .select("*")
            .eq("profile_id", uid)
            .limit(1000),
          client
            .from("user_prefs")
            .select("*")
            .eq("profile_id", uid)
            .maybeSingle(),
          client.from("dhikr_counts").select("*").eq("profile_id", uid),
        ]);
        return {
          ok: true,
          exportedAt: new Date().toISOString(),
          profile: profile.data ?? null,
          songs: songs.data ?? [],
          comments: comments.data ?? [],
          loves: loves.data ?? [],
          playlists: playlists.data ?? [],
          follows: follows.data ?? [],
          playEvents: plays.data ?? [],
          prefs: prefs.data ?? null,
          dhikr: dhikr.data ?? [],
        };
      },
    ),

  /* -------------------------------------------------------------- settings */

  prefs: async (): Promise<PlayerPrefs> => {
    const { client, uid } = await requireUid("load your settings");
    const row = (
      await client
        .from("user_prefs")
        .select("*")
        .eq("profile_id", uid)
        .maybeSingle()
    ).data as {
      theme?: string;
      volume?: number | string;
      muted?: boolean;
      lyric_script?: string;
      show_arabic?: boolean;
      show_translation?: boolean;
      reduce_motion?: boolean;
    } | null;
    if (!row) return { ...DEFAULT_PREFS };
    return {
      theme: row.theme === "dawn" ? "dawn" : "night",
      volume: Math.min(
        Math.max(Number(row.volume ?? DEFAULT_PREFS.volume), 0),
        1,
      ),
      muted: row.muted ?? false,
      lyricScript:
        row.lyric_script === "en" || row.lyric_script === "ar"
          ? row.lyric_script
          : "tr",
      showArabic: row.show_arabic ?? true,
      showTranslation: row.show_translation ?? true,
      reduceMotion: row.reduce_motion ?? false,
    };
  },

  savePrefs: async (patch: Partial<PlayerPrefs>): Promise<PlayerPrefs> => {
    const { client, uid } = await requireUid("save your settings");
    const update: Record<string, unknown> = {};
    if (patch.theme !== undefined) update.theme = patch.theme;
    if (patch.volume !== undefined)
      update.volume = Math.min(Math.max(patch.volume, 0), 1);
    if (patch.muted !== undefined) update.muted = patch.muted;
    if (patch.lyricScript !== undefined)
      update.lyric_script = patch.lyricScript;
    if (patch.showArabic !== undefined) update.show_arabic = patch.showArabic;
    if (patch.showTranslation !== undefined)
      update.show_translation = patch.showTranslation;
    if (patch.reduceMotion !== undefined)
      update.reduce_motion = patch.reduceMotion;
    if (!Object.keys(update).length) return api.prefs();

    update.updated_at = new Date().toISOString();
    update.profile_id = uid;
    const { error } = await client
      .from("user_prefs")
      .upsert(update, { onConflict: "profile_id" });
    if (error) throw apiErrorFromDb(error, "your settings");
    return api.prefs();
  },

  dhikr: async (): Promise<Record<string, DhikrState>> => {
    const { client, uid } = await requireUid("load your dhikr");
    const rows = list(
      await client
        .from("dhikr_counts")
        .select("phrase, count, target")
        .eq("profile_id", uid),
      "your dhikr",
    );
    const out: Record<string, DhikrState> = {};
    for (const row of rows) {
      const entry = row as { phrase: string; count: number; target: number };
      out[entry.phrase] = {
        count: Number(entry.count),
        target: Number(entry.target),
      };
    }
    return out;
  },

  saveDhikr: async (phrase: string, state: DhikrState): Promise<void> => {
    const { client, uid } = await requireUid("count your dhikr");
    const { error } = await client
      .from("dhikr_counts")
      .upsert(
        {
          profile_id: uid,
          phrase,
          count: state.count,
          target: state.target,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "profile_id,phrase" },
      );
    if (error) throw apiErrorFromDb(error, "your dhikr");
  },

  clearDhikr: async (phrase?: string): Promise<void> => {
    const { client, uid } = await requireUid("reset your dhikr");
    let query = client.from("dhikr_counts").delete().eq("profile_id", uid);
    if (phrase) query = query.eq("phrase", phrase);
    const { error } = await query;
    if (error) throw apiErrorFromDb(error, "your dhikr");
  },

  /* ------------------------------------------------------------------ draft */

  draft: async (): Promise<SongDraft | null> => {
    const { client, uid } = await requireUid("load your draft");
    const row = (
      await client
        .from("studio_drafts")
        .select("draft")
        .eq("profile_id", uid)
        .maybeSingle()
    ).data as { draft?: SongDraft } | null;
    return row?.draft ?? null;
  },

  saveDraft: async (draft: SongDraft): Promise<void> => {
    const { client, uid } = await requireUid("save your draft");
    const { error } = await client
      .from("studio_drafts")
      .upsert(
        { profile_id: uid, draft, updated_at: new Date().toISOString() },
        { onConflict: "profile_id" },
      );
    if (error) throw apiErrorFromDb(error, "your draft");
  },

  discardDraft: async (): Promise<void> => {
    const { client, uid } = await requireUid("discard your draft");
    const { error } = await client
      .from("studio_drafts")
      .delete()
      .eq("profile_id", uid);
    if (error) throw apiErrorFromDb(error, "your draft");
  },

  /* ------------------------------------------------------------------ files */

  files: async (): Promise<{ items: LibraryFile[]; total: number }> => {
    const { client, uid } = await requireUid("list your files");
    const items: LibraryFile[] = [];
    for (const bucket of [AUDIO_BUCKET, ARTWORK_BUCKET] as StorageBucket[]) {
      const { data } = await client.storage
        .from(bucket)
        .list(uid, { limit: 200 });
      for (const object of data ?? []) {
        const path = `${uid}/${object.name}`;
        items.push({
          path,
          bucket,
          bytes: Number(
            (object.metadata as { size?: number } | null)?.size ?? 0,
          ),
          mime: String(
            (object.metadata as { mimetype?: string } | null)?.mimetype ?? "",
          ),
          createdAt:
            Date.parse(object.updated_at ?? object.created_at ?? "") || 0,
          url:
            bucket === AUDIO_BUCKET
              ? String(audioUrl(path))
              : String(artworkUrl(path)),
        });
      }
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    return { items, total: items.reduce((sum, file) => sum + file.bytes, 0) };
  },
};

export type {
  ArtistCard,
  CatalogCollection,
  CatalogResponse,
  Song,
  SongInput,
  User,
};
export { artistFromRow, collectionFromRow, songFromRow, userFromRow };
export type { ArtistRow, CollectionRow, SongRow };
export { epochMs };
