/**
 * The shapes the UI works with.
 *
 * They come from `shared/types.ts` — the same file the Edge Functions compile against,
 * so a nasheed means the same thing in the browser, in Deno and in the tests. This
 * module exists only so components can `import type { Song } from "../data/types"`
 * without reaching two directories up, and so the few purely-presentational aliases
 * live somewhere sensible.
 */

export type {
  Accent,
  AdminSummary,
  ArtistCard,
  CatalogCollection,
  CatalogResponse,
  CollectionKind,
  Comment,
  CommentRow,
  DailyPoint,
  DhikrState,
  DraftLine,
  HistoryRow,
  ListenerStats,
  LyricLine,
  LyricScript,
  PlayerPrefs,
  Playlist,
  PlaylistInput,
  PlaylistRow,
  ProfileInput,
  PublisherProfile,
  Report,
  SessionUser,
  Song,
  SongDraft,
  SongInput,
  SongPatch,
  SongStats,
  SongStatus,
  TagCount,
  TrendingRow,
  TrendingWindow,
  User,
  UserKind,
  UserRole,
} from "../../shared/types";

import type { Accent, CatalogCollection, Song, SongStatus } from "../../shared/types";

/** A nasheed as a list row: everything the row needs, nothing it does not. */
export type TrackRef = Pick<Song, "id" | "title">;

export type Shelf = {
  id: string;
  title: string;
  blurb: string;
  accent: Accent;
  songs: Song[];
};

export type { CatalogCollection as Collection };
export type { Song as Track };
export type { SongStatus as Status };
