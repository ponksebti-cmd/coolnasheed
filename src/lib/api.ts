/**
 * The only place in the client that talks to Supabase.
 *
 * Three kinds of call live here, and the choice between them is the whole cost model
 * of the free tier:
 *
 *   1. PostgREST (`sb().from(...).select()`)  — reads and toggles: loves, amens,
 *      follows, playlists, notes. No function invocation, no cold start, and Row
 *      Level Security does the authorization.
 *   2. Postgres functions (`sb().rpc(...)`)   — anything that is a query with rules
 *      around it: the play beacon, the charts, the boot payload. Also free of
 *      invocation cost, and it runs in one transaction next to the data.
 *   3. Edge Functions (`invoke(...)`)         — the six things that genuinely need a
 *      server: a cached catalogue, multipart-adjacent publishing, moderation,
 *      account deletion, the dashboard, health.
 *
 * In demo mode (no VITE_SUPABASE_URL) nothing here is reachable, and every method
 * raises `DemoModeError` — which the interface renders as "connect a project" rather
 * than as a failure. The bundled catalogue still plays; that path never comes here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  artworkUrl,
  audioUrl,
  hasSupabase,
  invoke,
  maybeSb,
  projectRef,
  sb,
  supabaseUrl,
  upload,
  type InvokeInit,
} from "./supabase";
import { ApiError, ApiUnreachable, AuthError, DemoModeError, errorMessage, errorField } from "./errors";
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
  songInputFromRow,
  songRowFromInput,
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
  ARTWORK_BUCKET,
  AUDIO_BUCKET,
  type Accent,
  type AdminSummary,
  type ArtistCard,
  type BootstrapResponse,
  type CatalogCollection,
  type CatalogResponse,
  type Comment,
  type DailyPoint,
  type HealthResponse,
  type HistoryRow,
  type ListenerStats,
  type Playlist,
  type PlaylistInput,
  type PlayInput,
  type PlayReceipt,
  type ProfileInput,
  type PublisherProfile,
  type Report,
  type SessionUser,
  type Song,
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

export { ApiError, ApiUnreachable, AuthError, DemoModeError, errorMessage, errorField };

/* ------------------------------------------------------------------- errors */

type DbError = { message: string; code?: string; details?: string; hint?: string };

/** Postgres and PostgREST error codes, translated into sentences. */
function dbError(error: DbError, action: string): ApiError {
  const message = error.message || action;
  switch (error.code) {
    case "23505":
      return new ApiError("That is already there.", 409);
    case "23503":
      return new ApiError(`That does not line up with the rest of the catalogue: ${message}`, 400);
    case "23514":
      return new ApiError(message.replace(/^.*check constraint\s+"?\w+"?\s*/, "") || message, 400);
    case "42501":
    case "42503":
      return new AuthError("You are not allowed to do that.");
    case "PGRST116":
    case "PGRST117":
      return new ApiError("Nothing matched that.", 404);
    case "PGRST205":
    case "42P01":
      // The project is there; the schema is not. Nothing works until this is fixed and
      // the fix is one command, so it is the one database error worth saying plainly
      // rather than as whatever Postgres called the missing relation.
      return new ApiError("This Supabase project has no tables yet — the backend is not set up.", 500, "schema");
    case "22023":
      return new ApiError(message, 400);
    default:
      if (/row-level security|new row violates/i.test(message)) {
        return new AuthError("You are not allowed to do that. Sign in again and retry.");
      }
      return new ApiError(message, 400);
  }
}

function unwrap<T>(result: { data: T | null; error: DbError | null }, action: string): T {
  if (result.error) throw dbError(result.error, action);
  if (result.data === null || result.data === undefined) {
    throw new ApiError(`Nothing came back: ${action}.`, 404);
  }
  return result.data;
}

function unwrapMaybe<T>(result: { data: T | null; error: DbError | null }, action: string): T | null {
  if (result.error) throw dbError(result.error, action);
  return result.data;
}

function list<T>(result: { data: T[] | null; error: DbError | null }, action: string): T[] {
  if (result.error) throw dbError(result.error, action);
  return result.data ?? [];
}

/** Supabase auth messages, softened. */
function authMessage(message: string): { text: string; field?: "email" | "password" | "identity" | "handle" } {
  const lower = message.toLowerCase();
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return { text: "That email already has an account. Try signing in.", field: "email" };
  }
  if (lower.includes("invalid login credentials")) {
    return { text: "That email and password do not match.", field: "password" };
  }
  if (lower.includes("email not confirmed")) {
    return { text: "That email is not confirmed yet — check your inbox.", field: "email" };
  }
  if (lower.includes("password should be at least")) {
    return { text: "That password is too short for this project.", field: "password" };
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return { text: "Too many attempts. Give it a minute and try again.", field: undefined };
  }
  return { text: message, field: undefined };
}

/* ------------------------------------------------------------------ session */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in client, or an AuthError. */
function mine(action = "that"): SupabaseClient {
  const client = sb(action);
  return client;
}

async function currentUid(): Promise<string | null> {
  const client = maybeSb();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

async function requireUid(action = "that"): Promise<{ client: SupabaseClient; uid: string }> {
  const client = mine(action);
  const uid = await currentUid();
  if (!uid) throw new AuthError(`You need an account to ${action}.`);
  return { client, uid };
}

/** Resolve a handle or a uuid to the uuid that foreign keys want. */
async function profileIdOf(client: SupabaseClient, idOrHandle: string): Promise<string> {
  if (UUID_RE.test(idOrHandle)) return idOrHandle;
  const { data } = await client
    .from("profiles")
    .select("id")
    .eq("handle", idOrHandle.toLowerCase().replace(/^@/, ""))
    .maybeSingle();
  if (!data?.id) throw new ApiError("There is no publisher by that name.", 404, "handle");
  return String(data.id);
}

/** Handles for a set of profile uuids, in one query. */
async function handlesFor(client: SupabaseClient, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const { data } = await client.from("profiles").select("id, handle").in("id", unique);
  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(String(row.id), String(row.handle));
  return map;
}

async function withOwnerHandles(client: SupabaseClient, rows: SongRow[]): Promise<SongRow[]> {
  const handles = await handlesFor(client, rows.map((r) => r.owner_id));
  return rows.map((row) => ({ ...row, ownerHandle: row.owner_id ? handles.get(row.owner_id) ?? null : null }));
}

/* ------------------------------------------------------------ device beacon */

/**
 * A stable anonymous device id, so "listeners" on the charts counts people who have
 * not signed in as people rather than as page loads. It is not an account and it
 * carries no identity — clearing site data makes a new one.
 */
export function deviceId(): string {
  const key = "coolnasheed:device:v1";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const bytes = new Uint8Array(12);
    globalThis.crypto?.getRandomValues(bytes);
    const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, id);
    return id;
  } catch {
    return "anonymous";
  }
}

/* ------------------------------- functions are a shortcut, not the only road */

/**
 * Edge Functions are where secrets live and where a cache is worth paying for. They
 * are never the only way to reach the database: everything one of them does here is
 * also expressible as PostgREST plus an RPC under the same Row Level Security, and
 * the browser is allowed to do that itself.
 *
 * That matters on day one. A project can have its tables and no functions deployed —
 * the CLI is not installed, or a deploy failed — and publishing, moderating and the
 * staff dashboard must still work. So every function call here carries the direct
 * road beside it, and the first "that function is not there" is remembered for the
 * rest of the session instead of costing a round trip on every action.
 *
 * `null` means nothing has answered yet, `true` means a function answered, `false`
 * means the app has gone direct and should stop knocking.
 */
let functionsUp: boolean | null = null;

/** Which road the app is on, for the dashboard to say so plainly. */
export function functionsAvailable(): boolean | null {
  return functionsUp;
}

function isMissingFunction(error: unknown): boolean {
  if (error instanceof ApiUnreachable) return true;
  // the account is the problem, not the function: let that surface as a sign-in prompt
  if (error instanceof AuthError) return false;
  if (error instanceof ApiError) {
    if ([0, 404, 405, 501, 502, 503].includes(error.status)) return true;
    return /function (not found|is not|unavailable)|failed to (retrieve|send)|relay|not deployed/i.test(error.message);
  }
  return false;
}

async function viaFunction<T>(name: string, init: InvokeInit, direct: () => Promise<T>): Promise<T> {
  if (functionsUp === false) return direct();
  try {
    const result = await invoke<T>(name, init);
    functionsUp = true;
    return result;
  } catch (error) {
    if (!isMissingFunction(error)) throw error;
    functionsUp = false;
    return direct();
  }
}

/** Give the storage back when a nasheed goes. Best effort — the row is what matters. */
async function removeOwnedFiles(
  client: SupabaseClient,
  audioPath: string | null | undefined,
  artworkPath: string | null | undefined,
): Promise<number> {
  let removed = 0;
  for (const target of [
    audioPath ? { bucket: AUDIO_BUCKET, path: audioPath } : null,
    artworkPath ? { bucket: ARTWORK_BUCKET, path: artworkPath } : null,
  ]) {
    if (!target) continue;
    const { error } = await client.storage.from(target.bucket).remove([target.path]);
    if (!error) removed += 1;
  }
  return removed;
}

/* ------------------------------------------------------------------ caching */

let catalogCache: { at: number; payload: CatalogResponse } | null = null;
const CATALOG_TTL = 60_000;

async function readCatalog(fresh = false): Promise<CatalogResponse> {
  if (!fresh && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL) return catalogCache.payload;

  // the function puts a 60-second cache in front of the query; the RPC behind it
  // does the same job uncached, and is what runs when the functions are not deployed
  const payload = await viaFunction<CatalogResponse>(
    "catalog",
    { method: "GET", query: fresh ? { fresh: 1 } : {} },
    async () => {
      const client = sb("read the catalogue");
      const { data, error } = await client.rpc("catalog_payload");
      if (error) throw dbError(error, "the catalogue");
      return data as CatalogResponse;
    },
  );

  const normalized: CatalogResponse = {
    artists: payload?.artists ?? [],
    songs: payload?.songs ?? [],
    collections: payload?.collections ?? [],
    tags: payload?.tags ?? [],
    generatedAt: payload?.generatedAt ?? Date.now(),
    seeded: Boolean(payload?.seeded),
  };
  catalogCache = { at: Date.now(), payload: normalized };
  return normalized;
}

/** Forget the cached catalogue — called after publishing or taking something down. */
export function invalidateCatalog(): void {
  catalogCache = null;
}

/* -------------------------------------------------------------------- types */

export type SongQuery = {
  q?: string;
  maqam?: string;
  voices?: string;
  tag?: string;
  /** a handle, a uuid, or "me" */
  owner?: string;
  loved?: boolean;
  uploaded?: boolean;
  status?: SongStatus;
  sort?: "new" | "plays" | "likes" | "trending" | "title";
  window?: TrendingWindow;
  limit?: number;
  offset?: number;
};

export type Page<T> = { items: T[]; total: number; next: number | null };

export type SongDetail = {
  song: Song;
  viewer: { liked: boolean; owner: boolean };
  stats: SongStats;
  audioUrl: string | null;
  artworkUrl: string | null;
};

export type SignupInput = { name: string; handle: string; password: string; email?: string; city?: string };

export type SignupResult =
  | ({ pending: false } & SessionUser)
  | { pending: true; message: string };

export type LibraryFile = {
  path: string;
  bucket: StorageBucket;
  bytes: number;
  mime: string;
  createdAt: number;
  url: string;
};

/* --------------------------------------------------------------------- api */

export const api = {
  /* ------------------------------------------------------------- system */

  get configured(): boolean {
    return hasSupabase;
  },

  backend: () => ({ hasSupabase, projectRef, url: supabaseUrl }),

  health: () => invoke<HealthResponse>("health", { method: "GET" }),

  /* ------------------------------------------------------------ catalogue */

  catalog: (fresh = false) => readCatalog(fresh),

  artists: async (): Promise<ArtistCard[]> => (await readCatalog()).artists,

  collections: async (): Promise<CatalogCollection[]> => (await readCatalog()).collections,

  tags: async (): Promise<TagCount[]> => (await readCatalog()).tags,

  /** A publisher page: who they are, what they published, whether you follow them. */
  publisher: async (idOrHandle: string): Promise<PublisherProfile> => {
    const client = sb("open a publisher page");
    const { data, error } = await client.rpc("publisher_profile", { p_id: idOrHandle });
    if (error) throw dbError(error, "that publisher");
    if (!data) throw new ApiError("There is no publisher by that name.", 404, "handle");
    return data as unknown as PublisherProfile;
  },

  artist: (idOrHandle: string) => api.publisher(idOrHandle),

  /* ---------------------------------------------------------------- songs */

  songs: async (query: SongQuery = {}): Promise<Page<Song>> => {
    const client = sb("browse the catalogue");
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);

    // "trending" is a chart, not a sort: it reads the daily rollups
    if (query.sort === "trending") {
      const chart = await api.trending(query.window ?? "7d", limit);
      const ids = chart.rows.map((r) => r.songId);
      if (ids.length === 0) return { items: [], total: 0, next: null };
      const rows = list(
        await client.from("songs").select(SONG_COLUMNS).in("id", ids).eq("status", "live"),
        "those nasheeds",
      ) as SongRow[];
      const byId = new Map((await withOwnerHandles(client, rows)).map((r) => [r.id, songFromRow(r)]));
      const items = ids.map((id) => byId.get(id)).filter((s): s is Song => !!s);
      return { items, total: items.length, next: null };
    }

    let select = client.from("songs").select(SONG_COLUMNS, { count: "exact" });

    select = select.eq("status", query.status ?? "live");
    if (query.maqam) select = select.eq("maqam", query.maqam);
    if (query.voices) select = select.eq("voices", query.voices);
    if (query.tag) select = select.contains("tags", [query.tag]);
    if (query.uploaded) select = select.not("audio_path", "is", null);
    if (query.q) {
      const needle = query.q.trim().replace(/[,%()]/g, " ");
      if (needle) {
        select = select.or(`title.ilike.%${needle}%,note.ilike.%${needle}%,title_ar.ilike.%${needle}%`);
      }
    }
    if (query.owner) {
      if (query.owner === "me") {
        const uid = await currentUid();
        if (!uid) return { items: [], total: 0, next: null };
        select = select.eq("owner_id", uid);
        // your own page shows what you took down too
        if (!query.status) select = select.neq("status", "never");
      } else {
        select = select.eq("owner_id", await profileIdOf(client, query.owner));
      }
    }

    const order =
      query.sort === "plays"
        ? { column: "plays", ascending: false }
        : query.sort === "likes"
          ? { column: "likes", ascending: false }
          : query.sort === "title"
            ? { column: "title", ascending: true }
            : { column: "published_at", ascending: false };

    const { data, count, error } = await select
      .order(order.column, { ascending: order.ascending })
      .range(offset, offset + limit - 1);
    if (error) throw dbError(error, "that search");

    const rows = (await withOwnerHandles(client, (data ?? []) as SongRow[])).map(songFromRow);
    let items = rows;

    if (query.loved) {
      const loved = new Set((await api.likedIds()).songIds);
      items = rows.filter((song) => loved.has(song.id));
    }

    const total = count ?? items.length;
    return { items, total, next: offset + items.length < total ? offset + items.length : null };
  },

  song: async (id: string): Promise<SongDetail> => {
    const client = sb("open a nasheed");
    const row = unwrapMaybe(
      await client.from("songs").select(SONG_COLUMNS).eq("id", id).maybeSingle(),
      "that nasheed",
    ) as SongRow | null;
    if (!row) throw new ApiError("There is no nasheed by that id.", 404, "id");

    const [withHandles, stats, uid] = await Promise.all([
      withOwnerHandles(client, [row]),
      api.songStats(id),
      currentUid(),
    ]);
    const song = songFromRow(withHandles[0]!);

    let liked = false;
    if (uid) {
      const { data } = await client.from("loves").select("song_id").eq("profile_id", uid).eq("song_id", id).maybeSingle();
      liked = Boolean(data);
    }

    return {
      song,
      viewer: { liked, owner: Boolean(uid && song.ownerId === uid) },
      stats,
      audioUrl: audioUrl(song.audioPath),
      artworkUrl: artworkUrl(song.artworkPath),
    };
  },

  /** Same maqām first, then the room it belongs to. Cheap, and it sounds curated. */
  related: async (id: string, limit = 8): Promise<{ items: Song[] }> => {
    const client = sb("find something similar");
    const row = unwrapMaybe(
      await client.from("songs").select("maqam, accent, tags").eq("id", id).maybeSingle(),
      "that nasheed",
    ) as { maqam: string; accent: string; tags: string[] | null } | null;
    if (!row) return { items: [] };

    const sameMaqam = list(
      await client
        .from("songs")
        .select(SONG_COLUMNS)
        .eq("status", "live")
        .eq("maqam", row.maqam)
        .neq("id", id)
        .order("plays", { ascending: false })
        .limit(limit),
      "similar nasheeds",
    ) as SongRow[];

    let rows = sameMaqam;
    if (rows.length < limit) {
      const more = list(
        await client
          .from("songs")
          .select(SONG_COLUMNS)
          .eq("status", "live")
          .eq("accent", row.accent)
          .neq("id", id)
          .not("id", "in", `(${rows.map((r) => `"${r.id}"`).join(",") || '""'})`)
          .order("plays", { ascending: false })
          .limit(limit - rows.length),
        "similar nasheeds",
      ) as SongRow[];
      rows = [...rows, ...more];
    }

    return { items: (await withOwnerHandles(client, rows.slice(0, limit))).map(songFromRow) };
  },

  /* ------------------------------------------------------------- comments */

  comments: async (
    songId: string,
    query: { order?: "asc" | "desc"; limit?: number } = {},
  ): Promise<Page<Comment>> => {
    const client = sb("read the notes");
    const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
    const uid = await currentUid();

    const select = `id, song_id, author_id, text, at_line, edited_at, amens, reports, removed, created_at, author:profiles!comments_author_id_fkey(id, handle, name, seed, accent, verified)`;
    const { data, count, error } = await client
      .from("comments")
      .select(select, { count: "exact" })
      .eq("song_id", songId)
      .order("created_at", { ascending: query.order === "asc" })
      .limit(limit);
    if (error) throw dbError(error, "those notes");

    const amened = new Set<string>();
    if (uid) {
      const { data: mine } = await client.from("amens").select("comment_id").eq("profile_id", uid);
      for (const row of mine ?? []) amened.add(String(row.comment_id));
    }

    const items = ((data ?? []) as unknown as CommentRow[]).map((row) =>
      commentFromRow(row, { id: uid, amened }),
    );
    return { items, total: count ?? items.length, next: null };
  },

  /** Every note this account has written, newest first — a profile page's "notes" tab. */
  myComments: async (limit = 100): Promise<Comment[]> => {
    const { client, uid } = await requireUid("read your notes");
    const select = `${COMMENT_COLUMNS}, author:profiles!comments_author_id_fkey(id, handle, name, seed, accent, verified)`;
    const { data, error } = await client
      .from("comments")
      .select(select)
      .eq("author_id", uid)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 200));
    if (error) throw dbError(error, "your notes");

    const amened = new Set<string>();
    const { data: mine } = await client.from("amens").select("comment_id").eq("profile_id", uid);
    for (const row of mine ?? []) amened.add(String(row.comment_id));

    return ((data ?? []) as unknown as CommentRow[]).map((row) => commentFromRow(row, { id: uid, amened }));
  },

  addComment: async (songId: string, text: string, atLine?: number | null): Promise<{ comment: Comment; songId: string }> => {
    const { client, uid } = await requireUid("leave a note");
    const clean = text.trim();
    if (!clean) throw new ApiError("Say something first.", 400, "text");
    if (clean.length > 600) throw new ApiError("A note is at most 600 characters.", 400, "text");

    const select = `id, song_id, author_id, text, at_line, edited_at, amens, reports, removed, created_at, author:profiles!comments_author_id_fkey(id, handle, name, seed, accent, verified)`;
    const row = unwrap(
      await client
        .from("comments")
        .insert({ song_id: songId, author_id: uid, text: clean, at_line: atLine ?? null })
        .select(select)
        .single(),
      "that note",
    );
    return { comment: commentFromRow(row as unknown as CommentRow, { id: uid, amened: new Set() }), songId };
  },

  editComment: async (id: string, text: string): Promise<{ comment: Comment | null }> => {
    const { client, uid } = await requireUid("edit a note");
    const clean = text.trim();
    if (!clean) throw new ApiError("Say something first.", 400, "text");

    const select = `${COMMENT_COLUMNS}, author:profiles!comments_author_id_fkey(id, handle, name, seed, accent, verified)`;
    const row = unwrapMaybe(
      await client.from("comments").update({ text: clean }).eq("id", id).select(select).maybeSingle(),
      "that note",
    );
    if (!row) return { comment: null };
    return { comment: commentFromRow(row as unknown as CommentRow, { id: uid, amened: new Set() }) };
  },

  deleteComment: async (id: string): Promise<{ ok: boolean; comment: null }> => {
    const { client } = await requireUid("delete a note");
    const { error } = await client.from("comments").delete().eq("id", id);
    if (error) throw dbError(error, "that note");
    return { ok: true, comment: null };
  },

  amen: async (commentId: string): Promise<{ amened: boolean; amens: number; commentId: string }> => {
    const { client, uid } = await requireUid("say amin");
    const { data: existing } = await client
      .from("amens")
      .select("comment_id")
      .eq("profile_id", uid)
      .eq("comment_id", commentId)
      .maybeSingle();

    if (existing) {
      const { error } = await client.from("amens").delete().eq("profile_id", uid).eq("comment_id", commentId);
      if (error) throw dbError(error, "that amin");
    } else {
      const { error } = await client.from("amens").insert({ profile_id: uid, comment_id: commentId });
      if (error) throw dbError(error, "that amin");
    }

    const { data } = await client.from("comments").select("amens").eq("id", commentId).maybeSingle();
    return { amened: !existing, amens: Number(data?.amens ?? 0), commentId };
  },

  report: async (commentId: string, reason: string): Promise<{ ok: boolean }> => {
    const client = mine("report a note");
    const { data, error } = await client.rpc("report_comment", {
      p_comment_id: commentId,
      p_reason: reason.trim().slice(0, 300),
    });
    if (error) throw dbError(error, "that report");
    return (data ?? { ok: true }) as { ok: boolean };
  },

  resolveReport: async (id: string, hide: boolean): Promise<{ ok: boolean }> => {
    const client = mine("resolve a report");
    const { error } = await client.rpc("resolve_report", { p_report_id: id, p_hide: hide });
    if (error) throw dbError(error, "that report");
    return { ok: true };
  },

  /* ---------------------------------------------------------------- loves */

  like: async (songId: string): Promise<{ liked: boolean; likes: number; songId: string }> => {
    const { client, uid } = await requireUid("love a nasheed");
    const { data: existing } = await client
      .from("loves")
      .select("song_id")
      .eq("profile_id", uid)
      .eq("song_id", songId)
      .maybeSingle();

    if (existing) {
      const { error } = await client.from("loves").delete().eq("profile_id", uid).eq("song_id", songId);
      if (error) throw dbError(error, "that love");
    } else {
      const { error } = await client.from("loves").insert({ profile_id: uid, song_id: songId });
      if (error) throw dbError(error, "that love");
    }

    const { data } = await client.from("songs").select("likes").eq("id", songId).maybeSingle();
    return { liked: !existing, likes: Number(data?.likes ?? 0), songId };
  },

  likedIds: async (): Promise<{ songIds: string[] }> => {
    const uid = await currentUid();
    if (!uid) return { songIds: [] };
    const client = sb("read your loves");
    const { data, error } = await client.from("loves").select("song_id").eq("profile_id", uid);
    if (error) throw dbError(error, "your loves");
    return { songIds: (data ?? []).map((row) => String(row.song_id)) };
  },

  /* -------------------------------------------------------------- follows */

  follow: async (artistId: string): Promise<{ following: boolean; artistId: string }> => {
    const { client, uid } = await requireUid("follow a publisher");
    const artistUuid = await profileIdOf(client, artistId);
    if (artistUuid === uid) throw new ApiError("You cannot follow yourself.", 400, "artistId");

    const { data: existing } = await client
      .from("follows")
      .select("artist_id")
      .eq("profile_id", uid)
      .eq("artist_id", artistUuid)
      .maybeSingle();

    if (existing) {
      const { error } = await client.from("follows").delete().eq("profile_id", uid).eq("artist_id", artistUuid);
      if (error) throw dbError(error, "that follow");
    } else {
      const { error } = await client.from("follows").insert({ profile_id: uid, artist_id: artistUuid });
      if (error) throw dbError(error, "that follow");
    }
    return { following: !existing, artistId };
  },

  /** Handles, not uuids: that is what the catalogue keys its publishers by. */
  followedIds: async (): Promise<{ artistIds: string[] }> => {
    const uid = await currentUid();
    if (!uid) return { artistIds: [] };
    const client = sb("read who you follow");
    const { data, error } = await client.from("follows").select("artist_id").eq("profile_id", uid);
    if (error) throw dbError(error, "who you follow");
    const handles = await handlesFor(client, (data ?? []).map((row) => String(row.artist_id)));
    return { artistIds: [...handles.values()] };
  },

  /* ------------------------------------------------------------ playlists */

  playlists: async (): Promise<Playlist[]> => {
    const uid = await currentUid();
    if (!uid) return [];
    const client = sb("read your sets");
    const { data, error } = await client
      .from("playlists")
      .select(PLAYLIST_COLUMNS)
      .eq("owner_id", uid)
      .order("created_at", { ascending: false });
    if (error) throw dbError(error, "your sets");
    return ((data ?? []) as PlaylistRow[]).map(playlistFromRow);
  },

  playlist: async (id: string): Promise<Playlist & { songs: Song[] }> => {
    const client = sb("open a set");
    const row = unwrap(
      await client.from("playlists").select(PLAYLIST_COLUMNS).eq("id", id).maybeSingle(),
      "that set",
    ) as PlaylistRow;
    const playlist = playlistFromRow(row);
    if (playlist.songIds.length === 0) return { ...playlist, songs: [] };

    const rows = list(
      await client.from("songs").select(SONG_COLUMNS).in("id", playlist.songIds).eq("status", "live"),
      "those nasheeds",
    ) as SongRow[];
    const byId = new Map((await withOwnerHandles(client, rows)).map((r) => [r.id, songFromRow(r)]));
    const songs = playlist.songIds.map((songId) => byId.get(songId)).filter((s): s is Song => !!s);
    return { ...playlist, songs };
  },

  createPlaylist: async (input: PlaylistInput): Promise<Playlist> => {
    const { client, uid } = await requireUid("build a set");
    const name = (input.name ?? "").trim();
    if (!name) throw new ApiError("A set needs a name.", 400, "name");

    const row = unwrap(
      await client
        .from("playlists")
        .insert({
          owner_id: uid,
          name: name.slice(0, 80),
          blurb: (input.blurb ?? "").slice(0, 280),
          seed: input.seed || `playlist-${name.toLowerCase().replace(/\s+/g, "-")}-${uid.slice(0, 8)}`,
          accent: input.accent ?? "jade",
          song_ids: (input.songIds ?? []).slice(0, 500),
        })
        .select(PLAYLIST_COLUMNS)
        .single(),
      "that set",
    ) as PlaylistRow;
    return playlistFromRow(row);
  },

  updatePlaylist: async (
    id: string,
    patch: Partial<{ name: string; blurb: string; songIds: string[]; accent: string }>,
  ): Promise<{ playlist: Playlist | null }> => {
    const { client } = await requireUid("edit a set");
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name.trim().slice(0, 80);
    if (patch.blurb !== undefined) update.blurb = patch.blurb.slice(0, 280);
    if (patch.songIds !== undefined) update.song_ids = patch.songIds.slice(0, 500);
    if (patch.accent !== undefined) update.accent = patch.accent;
    if (Object.keys(update).length === 0) throw new ApiError("Nothing to change.", 400);

    const row = unwrapMaybe(
      await client.from("playlists").update(update).eq("id", id).select(PLAYLIST_COLUMNS).maybeSingle(),
      "that set",
    ) as PlaylistRow | null;
    return { playlist: row ? playlistFromRow(row) : null };
  },

  deletePlaylist: async (id: string): Promise<{ ok: boolean }> => {
    const { client } = await requireUid("delete a set");
    const { error } = await client.from("playlists").delete().eq("id", id);
    if (error) throw dbError(error, "that set");
    return { ok: true };
  },

  playlistSong: async (id: string, songId: string, remove = false): Promise<{ playlist: Playlist | null; added: boolean; removed: boolean }> => {
    const { client } = await requireUid(remove ? "take a nasheed out of a set" : "add a nasheed to a set");
    const row = unwrap(
      await client.from("playlists").select(PLAYLIST_COLUMNS).eq("id", id).maybeSingle(),
      "that set",
    ) as PlaylistRow;
    const current = playlistFromRow(row).songIds;
    const has = current.includes(songId);
    const next = remove ? current.filter((x) => x !== songId) : has ? current : [...current, songId];

    const updated = unwrapMaybe(
      await client.from("playlists").update({ song_ids: next }).eq("id", id).select(PLAYLIST_COLUMNS).maybeSingle(),
      "that set",
    ) as PlaylistRow | null;

    return {
      playlist: updated ? playlistFromRow(updated) : null,
      added: !remove && !has,
      removed: remove && has,
    };
  },

  savedCollections: async (): Promise<{ collectionIds: string[] }> => {
    const uid = await currentUid();
    if (!uid) return { collectionIds: [] };
    const client = sb("read your saved shelves");
    const { data, error } = await client.from("saved_collections").select("collection_id").eq("profile_id", uid);
    if (error) throw dbError(error, "your saved shelves");
    return { collectionIds: (data ?? []).map((row) => String(row.collection_id)) };
  },

  saveCollection: async (collectionId: string): Promise<{ saved: boolean; collectionId: string }> => {
    const { client, uid } = await requireUid("save a shelf");
    const { data: existing } = await client
      .from("saved_collections")
      .select("collection_id")
      .eq("profile_id", uid)
      .eq("collection_id", collectionId)
      .maybeSingle();

    if (existing) {
      const { error } = await client
        .from("saved_collections")
        .delete()
        .eq("profile_id", uid)
        .eq("collection_id", collectionId);
      if (error) throw dbError(error, "that shelf");
    } else {
      const { error } = await client.from("saved_collections").insert({ profile_id: uid, collection_id: collectionId });
      if (error) throw dbError(error, "that shelf");
    }
    return { saved: !existing, collectionId };
  },

  /* -------------------------------------------------------------- publish */

  /**
   * Upload first, then publish. The file goes straight from the browser to the
   * bucket with the caller's own token, so it never passes through a function; the
   * function only checks that it landed and writes the row.
   */
  publish: async (
    input: SongInput,
    files?: { audio?: File | null; artwork?: File | null; durationMs?: number | null },
  ): Promise<{ song: Song; audioUrl: string | null; artworkUrl: string | null }> => {
    const { uid } = await requireUid("publish a nasheed");

    let audioPath = input.audioPath ?? null;
    let artworkPath = input.artworkPath ?? null;
    let audioMime = input.audioMime ?? null;
    let audioBytes = input.audioBytes ?? null;

    if (files?.audio) {
      audioPath = await upload(uid, "nasheed", files.audio, { bucket: AUDIO_BUCKET });
      audioMime = files.audio.type || "audio/mpeg";
      audioBytes = files.audio.size;
    }
    if (files?.artwork) {
      artworkPath = await upload(uid, "cover", files.artwork, { bucket: ARTWORK_BUCKET });
    }

    const payload: SongInput = {
      ...input,
      audioPath,
      audioMime,
      audioBytes,
      artworkPath,
      durationMs: files?.durationMs ?? input.durationMs ?? null,
    };

    const result = await viaFunction<{ ok: true; song: Song }>(
      "publish",
      { method: "POST", body: payload },
      async () => {
        // No function deployed: the browser writes the identical row. What decides
        // whether it lands is the same as it ever was — `owner_id = auth.uid()` in
        // the insert policy, and the table's check constraints on every column.
        const client = sb("publish a nasheed");
        const row = songRowFromInput(payload, uid);
        const { data, error } = await client
          .from("songs")
          .insert({ ...row, owner_id: uid })
          .select(SONG_COLUMNS)
          .single();
        if (error) throw dbError(error, "that nasheed");
        const stored = data as SongRow;
        const [withHandle] = await withOwnerHandles(client, [stored]);
        return { ok: true as const, song: songFromRow(withHandle ?? stored) };
      },
    );

    invalidateCatalog();
    return {
      song: result.song,
      audioUrl: audioUrl(result.song.audioPath),
      artworkUrl: artworkUrl(result.song.artworkPath),
    };
  },

  updateSong: async (
    id: string,
    patch: SongPatch,
    files?: { audio?: File | null; artwork?: File | null },
  ): Promise<{ song: Song }> => {
    const { uid } = await requireUid("edit a nasheed");

    const body: SongPatch & { id: string } = { ...patch, id };
    if (files?.audio) {
      body.audioPath = await upload(uid, "nasheed", files.audio, { bucket: AUDIO_BUCKET });
      body.audioMime = files.audio.type || "audio/mpeg";
      body.audioBytes = files.audio.size;
    }
    if (files?.artwork) {
      body.artworkPath = await upload(uid, "cover", files.artwork, { bucket: ARTWORK_BUCKET });
    }

    const result = await viaFunction<{ ok: true; song: Song }>("publish", { method: "PATCH", body }, async () => {
      const client = sb("edit a nasheed");
      const found = unwrapMaybe(
        await client.from("songs").select(SONG_COLUMNS).eq("id", id).maybeSingle(),
        "that nasheed",
      ) as SongRow | null;
      if (!found) throw new ApiError("There is no nasheed by that id.", 404, "id");

      // merge the patch over what is stored, then validate the whole thing once,
      // so an edit cannot quietly blank a field
      const { id: _ignored, status, ...changes } = body;
      const owner = found.owner_id ?? uid;
      const update: Record<string, unknown> = { ...songRowFromInput({ ...songInputFromRow(found), ...changes }, owner) };
      if (status !== undefined) {
        if (status !== "live" && status !== "removed") throw new ApiError("That status does not exist.", 400, "status");
        update.status = status;
      }

      const { data, error } = await client
        .from("songs")
        .update(update)
        .eq("id", id)
        .select(SONG_COLUMNS)
        .single();
      if (error) throw dbError(error, "that edit");
      const stored = data as SongRow;
      const [withHandle] = await withOwnerHandles(client, [stored]);
      return { ok: true as const, song: songFromRow(withHandle ?? stored) };
    });
    invalidateCatalog();
    return { song: result.song };
  },

  removeSong: async (id: string, files = false): Promise<{ ok: boolean }> => {
    await requireUid("take a nasheed down");
    await viaFunction<{ ok: boolean }>(
      "publish",
      { method: "DELETE", query: { id, files: files ? 1 : undefined } },
      async () => {
        const client = sb("take a nasheed down");
        const found = unwrapMaybe(
          await client.from("songs").select("id, audio_path, artwork_path").eq("id", id).maybeSingle(),
          "that nasheed",
        ) as { id: string; audio_path: string | null; artwork_path: string | null } | null;
        if (!found) throw new ApiError("There is no nasheed by that id.", 404, "id");

        // taking a nasheed down hides it; `files` also gives the storage back
        const { error } = await client.from("songs").update({ status: "removed" }).eq("id", id);
        if (error) throw dbError(error, "that nasheed");
        if (files) await removeOwnedFiles(client, found.audio_path, found.artwork_path);
        return { ok: true };
      },
    );
    invalidateCatalog();
    return { ok: true };
  },

  setSongStatus: async (id: string, status: SongStatus): Promise<{ song: Song | null }> => {
    const result = await api.updateSong(id, { status });
    invalidateCatalog();
    return { song: result.song };
  },

  /* -------------------------------------------------------------- analytics */

  /** The play beacon. One RPC, no function invocation, rolls itself up in Postgres. */
  play: async (input: PlayInput): Promise<PlayReceipt> => {
    const client = sb("count a play");
    const { data, error } = await client.rpc("record_play", {
      p_song_id: input.songId,
      p_seconds: Math.max(0, Math.round(input.seconds ?? 0)),
      p_completed: Boolean(input.completed),
      p_client_id: input.clientId ?? deviceId(),
    });
    if (error) throw dbError(error, "that play");
    return (data ?? { ok: true }) as PlayReceipt;
  },

  trending: async (window: TrendingWindow = "7d", limit = 10): Promise<{ window: TrendingWindow; rows: TrendingRow[]; generatedAt: number }> => {
    const client = sb("read the charts");
    const { data, error } = await client.rpc("trending", { p_window: window, p_limit: limit });
    if (error) throw dbError(error, "the charts");
    const rows = ((data ?? []) as unknown as Parameters<typeof trendingFromRow>[0][]).map(trendingFromRow);
    return { window, rows, generatedAt: Date.now() };
  },

  daily: async (days = 14): Promise<DailyPoint[]> => {
    const client = sb("read the site curve");
    const { data, error } = await client.rpc("daily_curve", { p_days: days });
    if (error) throw dbError(error, "the site curve");
    return ((data ?? []) as unknown as Parameters<typeof dailyFromRow>[0][]).map(dailyFromRow);
  },

  history: async (limit = 30): Promise<HistoryRow[]> => {
    const client = sb("read your history");
    const uid = await currentUid();
    const { data, error } = await client.rpc("my_history", {
      p_limit: limit,
      p_client_id: uid ? null : deviceId(),
    });
    if (error) throw dbError(error, "your history");
    return ((data ?? []) as unknown as Partial<HistoryRow>[]).map(historyFromRow);
  },

  playTotals: async (): Promise<{ count: number; seconds: number; firstAt: number | null; days: number }> => {
    const client = sb("read your listening");
    const { data, error } = await client.rpc("my_listening");
    if (error) throw dbError(error, "your listening");
    const totals = (data ?? {}) as { plays?: number; listenSeconds?: number; firstAt?: number | null; days?: number };
    return {
      count: Number(totals.plays ?? 0),
      seconds: Number(totals.listenSeconds ?? 0),
      firstAt: totals.firstAt ?? null,
      days: Number(totals.days ?? 0),
    };
  },

  songStats: async (id: string): Promise<SongStats> => {
    const client = sb("read those numbers");
    const { data, error } = await client.rpc("song_stats", { p_song_id: id });
    if (error) throw dbError(error, "those numbers");
    const stats = (data ?? {}) as Partial<SongStats>;
    return {
      plays: Number(stats.plays ?? 0),
      listeners: Number(stats.listeners ?? 0),
      seconds: Number(stats.seconds ?? 0),
      completed: Number(stats.completed ?? 0),
      daily: (stats.daily ?? []).map((d) => ({ ...d, day: String(d.day).slice(0, 10) })),
    };
  },

  songAnalytics: async (id: string): Promise<{ song: Song; stats: SongStats }> => {
    const detail = await api.song(id);
    return { song: detail.song, stats: detail.stats };
  },

  adminOverview: (days = 14) =>
    viaFunction<AdminSummary>(
      "analytics",
      { method: "GET", query: { view: "admin", days } },
      async () => {
        // `admin_summary()` checks the staff role itself, so calling it straight is
        // not a shortcut past a permission — it is the permission, doing its job
        const client = sb("read the dashboard");
        const { data, error } = await client.rpc("admin_summary", { p_days: days });
        if (error) throw dbError(error, "the dashboard");
        const summary = (data ?? {}) as AdminSummary;
        return { ...summary, daily: (summary.daily ?? []).map((d) => ({ ...d, day: String(d.day).slice(0, 10) })) };
      },
    ),

  adminSongs: async (): Promise<{ items: Song[]; total: number; removed: number }> => {
    const client = sb("read everything, as staff");
    const { data, count, error } = await client
      .from("songs")
      .select(SONG_COLUMNS, { count: "exact" })
      .order("published_at", { ascending: false })
      .limit(200);
    if (error) throw dbError(error, "the whole catalogue");
    const rows = (await withOwnerHandles(client, (data ?? []) as SongRow[])).map(songFromRow);
    return { items: rows, total: count ?? rows.length, removed: rows.filter((s) => s.status === "removed").length };
  },

  moderate: (action: string, payload: Record<string, unknown> = {}) =>
    viaFunction<{ ok: boolean } & Record<string, unknown>>(
      "moderate",
      { method: "POST", body: { action, ...payload } },
      () => moderateDirect(action, payload),
    ),

  /* ------------------------------------------------------------------- auth */

  signup: async (input: SignupInput): Promise<SignupResult> => {
    const client = sb("create an account");
    const email = (input.email ?? "").trim();
    if (!email) {
      throw new ApiError("An email address is required — that is what Supabase signs you in with.", 400, "email");
    }

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

    // confirmations on: there is a user but no session until the link is followed
    if (!data.session) {
      return {
        pending: true,
        message: "Account created. Check your email to confirm it, then sign in here.",
      };
    }
    return { pending: false, ...(await sessionFromClient(client)) };
  },

  signin: async (identity: string, password: string): Promise<SessionUser> => {
    const client = sb("sign in");
    const clean = identity.trim();
    if (!clean.includes("@")) {
      // a handle is how people find you, not how you sign in — and we cannot look the
      // email up for you without handing out addresses to anybody who asks
      const { data } = await client.from("profiles").select("handle").eq("handle", clean.toLowerCase()).maybeSingle();
      throw new ApiError(
        data
          ? `@${data.handle} exists — sign in with the email address you registered it with.`
          : "Sign in with your email address.",
        400,
        "identity",
      );
    }

    const { data, error } = await client.auth.signInWithPassword({ email: clean, password });
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
    return { ok: true };
  },

  /** The signed-in account and its counters, or null. */
  me: async (): Promise<SessionUser | null> => {
    const client = maybeSb();
    if (!client) return null;
    const { data } = await client.auth.getUser();
    if (!data.user) return null;
    try {
      return await sessionFromClient(client, data.user.id, data.user.email ?? null);
    } catch (error) {
      // a profile the trigger has not made yet is not a dead session
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },

  /** Everything about you in one round trip: profile, counters, sets, loves, history. */
  bootstrap: async (): Promise<BootstrapResponse> => {
    const client = sb("load your library");
    const { data, error } = await client.rpc("my_bootstrap");
    if (error) throw dbError(error, "your library");
    const payload = (data ?? {}) as Partial<BootstrapResponse> & { user?: (User & { email?: string | null }) | null };
    return {
      user: payload.user ?? null,
      stats: (payload.stats ?? emptyStats()) as ListenerStats,
      liked: payload.liked ?? [],
      followed: payload.followed ?? [],
      savedCollections: payload.savedCollections ?? [],
      playlists: payload.playlists ?? [],
      songs: payload.songs ?? [],
      history: (payload.history ?? []).map(historyFromRow),
    };
  },

  updateProfile: async (patch: ProfileInput): Promise<SessionUser> => {
    const client = await requireClient("change your profile");
    await viaFunction<{ ok: boolean }>(
      "account",
      { method: "POST", body: { action: "profile", ...patch } },
      async () => {
        const { uid } = await requireUid("change your profile");
        const update = await profileUpdate(client, uid, patch);
        if (Object.keys(update).length === 0) throw new ApiError("Nothing to change.", 400);
        const { error } = await client.from("profiles").update(update).eq("id", uid);
        if (error) throw dbError(error, "your profile");
        return { ok: true };
      },
    );
    return sessionFromClient(client);
  },

  changePassword: async (current: string, next: string): Promise<{ ok: boolean }> => {
    const client = await requireClient("change your password");
    const { data } = await client.auth.getUser();
    const email = data.user?.email;
    if (!email) throw new ApiError("This account has no email to verify against.", 400, "password");

    // Supabase does not ask for the old password, so we ask it ourselves: signing in
    // again with it is the only honest way to check somebody at this keyboard owns it
    if (current) {
      const { error } = await client.auth.signInWithPassword({ email, password: current });
      if (error) throw new ApiError("That is not your current password.", 400, "password");
    }

    const { error } = await client.auth.updateUser({ password: next });
    if (error) {
      const shaped = authMessage(error.message);
      throw new ApiError(shaped.text, 400, shaped.field ?? "password");
    }
    return { ok: true };
  },

  deleteAccount: async (password?: string): Promise<{ ok: boolean; filesRemoved: number }> => {
    const client = await requireClient("delete your account");
    const { data } = await client.auth.getUser();
    const email = data.user?.email;

    if (password && email) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new ApiError("That is not your password.", 400, "password");
    }

    return viaFunction<{ ok: boolean; filesRemoved: number }>(
      "account",
      { method: "POST", body: { action: "delete" } },
      async () => {
        // the one thing a browser genuinely cannot do: `auth.users` needs the secret
        // key, and the secret key must never be in a bundle anybody can download
        throw new ApiError(
          "Closing an account needs the `account` Edge Function — deleting a user in auth.users takes the secret key, which a browser must never hold. Deploy it with `npx supabase functions deploy account`, or remove the user from the dashboard under Authentication → Users.",
          501,
        );
      },
    );
  },

  exportAccount: () =>
    viaFunction<Record<string, unknown>>(
      "account",
      { method: "POST", body: { action: "export" } },
      async () => {
        const { client, uid } = await requireUid("export your account");
        const { data } = await client.auth.getUser();
        const [profile, songs, comments, loves, playlists, follows, plays] = await Promise.all([
          client.from("profiles").select("*").eq("id", uid).maybeSingle(),
          client.from("songs").select("*").eq("owner_id", uid),
          client.from("comments").select("*").eq("author_id", uid),
          client.from("loves").select("*").eq("profile_id", uid),
          client.from("playlists").select("*").eq("owner_id", uid),
          client.from("follows").select("*").eq("profile_id", uid),
          client.from("play_events").select("*").eq("profile_id", uid).limit(1000),
        ]);

        return {
          ok: true,
          exportedAt: new Date().toISOString(),
          account: { id: uid, email: data.user?.email ?? null },
          profile: profile.data ?? null,
          songs: songs.data ?? [],
          comments: comments.data ?? [],
          loves: loves.data ?? [],
          playlists: playlists.data ?? [],
          follows: follows.data ?? [],
          playEvents: plays.data ?? [],
        };
      },
    ),

  /* ------------------------------------------------------------------ files */

  /** What this account has uploaded, across both buckets. */
  files: async (): Promise<{ items: LibraryFile[]; total: number }> => {
    const { client, uid } = await requireUid("list your files");
    const items: LibraryFile[] = [];

    for (const bucket of [AUDIO_BUCKET, ARTWORK_BUCKET]) {
      const { data } = await client.storage.from(bucket).list(uid, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
      for (const file of data ?? []) {
        const path = `${uid}/${file.name}`;
        items.push({
          path,
          bucket,
          bytes: Number((file.metadata as { size?: number } | null)?.size ?? 0),
          mime: String((file.metadata as { mimetype?: string } | null)?.mimetype ?? ""),
          createdAt: epochMs(file.created_at, Date.now()),
          url: bucket === AUDIO_BUCKET ? audioUrl(path) ?? "" : artworkUrl(path) ?? "",
        });
      }
    }

    items.sort((a, b) => b.createdAt - a.createdAt);
    return { items, total: items.length };
  },
};

/* --------------------------------------------------------------- internals */

async function requireClient(action: string): Promise<SupabaseClient> {
  const { client } = await requireUid(action);
  return client;
}

/* --------------------------------------------- the staff room, direct to SQL */

const REPORT_COLUMNS =
  "id, comment_id, reporter_id, reason, resolved, created_at, comment_text, author_handle, song_id, song_title";

async function reportQueue(client: SupabaseClient): Promise<Report[]> {
  const { data, error } = await client
    .from("reports")
    .select(REPORT_COLUMNS)
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw dbError(error, "the queue");
  return ((data ?? []) as unknown as ReportRow[]).map(reportFromRow);
}

/**
 * Moderation without the `moderate` function.
 *
 * Same actions, same order of operations, and no extra authority: the caller's own
 * JWT goes to PostgREST, the staff policies decide what it may touch, and
 * `resolve_report()` re-checks the role inside Postgres. A missing function cannot
 * hand out moderation that Row Level Security would refuse.
 */
async function moderateDirect(
  action: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean } & Record<string, unknown>> {
  const { client } = await requireUid("moderate");
  const str = (key: string): string => {
    const value = payload[key];
    if (typeof value !== "string" || !value) throw new ApiError(`${key} is required.`, 400, key);
    return value;
  };

  switch (action) {
    case "queue":
      return { ok: true, reports: await reportQueue(client) };

    case "resolveReport": {
      const reportId = str("reportId");
      const { data, error } = await client.rpc("resolve_report", {
        p_report_id: reportId,
        p_hide: payload.hide === true,
      });
      if (error) throw dbError(error, "that report");
      return { ok: true, reportId, ...((data ?? {}) as object) };
    }

    case "hideComment":
    case "restoreComment": {
      const commentId = str("commentId");
      const removed = action === "hideComment";
      const { data, error } = await client
        .from("comments")
        .update({ removed })
        .eq("id", commentId)
        .select("id, removed")
        .maybeSingle();
      if (error) throw dbError(error, "that note");
      if (!data) throw new ApiError("There is no note by that id.", 404, "commentId");
      return { ok: true, id: String(data.id), removed: Boolean(data.removed) };
    }

    case "deleteComment": {
      const commentId = str("commentId");
      const { error, count } = await client.from("comments").delete({ count: "exact" }).eq("id", commentId);
      if (error) throw dbError(error, "that note");
      if (!count) throw new ApiError("There is no note by that id.", 404, "commentId");
      return { ok: true, commentId, deleted: true };
    }

    case "removeSong":
    case "restoreSong": {
      const songId = str("songId");
      const status: SongStatus = action === "removeSong" ? "removed" : "live";
      const found = unwrapMaybe(
        await client.from("songs").select("id, audio_path, artwork_path").eq("id", songId).maybeSingle(),
        "that nasheed",
      ) as { id: string; audio_path: string | null; artwork_path: string | null } | null;
      if (!found) throw new ApiError("There is no nasheed by that id.", 404, "songId");

      const { error } = await client.from("songs").update({ status }).eq("id", songId);
      if (error) throw dbError(error, "that nasheed");

      const filesRemoved =
        status === "removed" && payload.files === true
          ? await removeOwnedFiles(client, found.audio_path, found.artwork_path)
          : 0;
      invalidateCatalog();
      return { ok: true, id: songId, status, filesRemoved };
    }

    case "setRole": {
      const profileId = str("profileId");
      const role = payload.role;
      if (role !== "listener" && role !== "staff") {
        throw new ApiError("A role is one of: listener, staff.", 400, "role");
      }
      const { error } = await client.from("profiles").update({ role }).eq("id", profileId);
      if (error) throw dbError(error, "that role");
      return { ok: true, profileId, role };
    }

    case "verify": {
      const profileId = str("profileId");
      const verified = payload.verified !== false;
      const { error } = await client.from("profiles").update({ verified }).eq("id", profileId);
      if (error) throw dbError(error, "that");
      return { ok: true, profileId, verified };
    }

    default:
      throw new ApiError("That action does not exist here.", 404, "action");
  }
}

/* ------------------------------------------------ a profile, direct to SQL */

const PROFILE_ACCENTS: Accent[] = ["jade", "gold", "turq", "madder", "cobalt"];

/** The columns `updateProfile` may write, cleaned the way the `account` function cleans them. */
async function profileUpdate(
  client: SupabaseClient,
  uid: string,
  patch: ProfileInput,
): Promise<Record<string, unknown>> {
  const clean = (value: string | null | undefined, field: string, max: number): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw new ApiError(`${field} must be text.`, 400, field);
    const trimmed = value.trim();
    if (trimmed.length > max) throw new ApiError(`${field} is at most ${max} characters.`, 400, field);
    return trimmed;
  };

  const update: Record<string, unknown> = {};

  const name = clean(patch.name, "name", 48);
  if (name !== undefined) {
    if (name.length < 2) throw new ApiError("A name is at least 2 characters.", 400, "name");
    update.name = name;
  }
  const nameAr = clean(patch.nameAr, "nameAr", 48);
  if (nameAr !== undefined) update.name_ar = nameAr || null;
  const tagline = clean(patch.tagline, "tagline", 120);
  if (tagline !== undefined) update.tagline = tagline;
  const bio = clean(patch.bio, "bio", 280);
  if (bio !== undefined) update.bio = bio;
  const city = clean(patch.city, "city", 60);
  if (city !== undefined) update.city = city;

  if (patch.accent !== undefined) {
    if (!PROFILE_ACCENTS.includes(patch.accent)) {
      throw new ApiError(`An accent is one of: ${PROFILE_ACCENTS.join(", ")}.`, 400, "accent");
    }
    update.accent = patch.accent;
  }

  if (patch.handle !== undefined) {
    const handle = String(patch.handle).trim().toLowerCase();
    if (!/^[a-z0-9._]{3,20}$/.test(handle)) {
      throw new ApiError("A handle is 3–20 characters of a-z, 0-9, dot or underscore.", 400, "handle");
    }
    const { data: taken } = await client
      .from("profiles")
      .select("id")
      .neq("id", uid)
      .eq("handle", handle)
      .maybeSingle();
    if (taken) throw new ApiError("That handle is already spoken for.", 409, "handle");
    update.handle = handle;
  }

  return update;
}

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

/**
 * Profile + counters for whoever holds the current session.
 * One RPC (`my_bootstrap`) carries both, so a sign-in costs one round trip.
 */
async function sessionFromClient(
  client: SupabaseClient,
  uid?: string,
  email?: string | null,
): Promise<SessionUser> {
  const { data: userData } = await client.auth.getUser();
  const id = uid ?? userData.user?.id ?? null;
  const address = email ?? userData.user?.email ?? null;
  if (!id) throw new AuthError();

  const { data, error } = await client.rpc("my_bootstrap");
  if (error) throw dbError(error, "your profile");

  const payload = (data ?? {}) as Partial<BootstrapResponse> & { stats?: Partial<ListenerStats> };
  if (!payload.user) {
    // the trigger has not run yet, or the profile was deleted: read it straight
    const row = unwrapMaybe(
      await client.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle(),
      "your profile",
    ) as ProfileRow | null;
    if (!row) throw new ApiError("Your profile is missing. Sign out and back in to remake it.", 404);
    return { user: userFromRow(row, address), stats: emptyStats() };
  }

  return {
    user: { ...payload.user, email: address },
    stats: { ...emptyStats(), ...(payload.stats ?? {}) },
  };
}

export type { ArtistCard, CatalogCollection, CatalogResponse, Song, SongInput, User };
export { artistFromRow, collectionFromRow, songFromRow, userFromRow };
export type { ArtistRow, CollectionRow };
