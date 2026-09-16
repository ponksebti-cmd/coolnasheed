/**
 * The live catalogue.
 *
 * One in-memory registry, filled by exactly one thing: the server. `hydrateCatalog()`
 * pours a `catalog_payload` answer into the three arrays in place, so every reader —
 * the shelves, search, the player, an artist page — sees what the database has without
 * knowing or caring where it came from.
 *
 * There is no bundled catalogue and no generated fallback. Before the server answers,
 * the registry is empty and the app says the catalogue is empty; a project with nothing
 * published is a project with nothing published.
 */

import type { ArtistCard, CatalogCollection, CatalogResponse, Song, TagCount } from "../../shared/types";
import { artworkUrl, audioUrl } from "../lib/supabase";
import { getPreview } from "./preview";

export const TRACKS: Song[] = [];
export const ARTISTS: ArtistCard[] = [];
export const COLLECTIONS: CatalogCollection[] = [];
export const TAGS: TagCount[] = [];

let trackById = new Map<string, Song>();
let artistById = new Map<string, ArtistCard>();
let artistByProfileId = new Map<string, ArtistCard>();
let collectionById = new Map<string, CatalogCollection>();
let syncedAt = 0;
let version = 0;

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Subscribe to catalogue changes. Every component that iterates `TRACKS` should also
 * read `useCatalogVersion()`: the arrays are mutated in place so that a dozen modules
 * can hold a reference to them, and in-place mutation is invisible to React.
 */
export function subscribeCatalog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Bumped on every hydrate, so memoised lists can invalidate. */
export function catalogVersion(): number {
  return version;
}

/** When the catalogue last came from the server; 0 means it never did. */
export function catalogSyncedAt(): number {
  return syncedAt;
}

function reindex(): void {
  trackById = new Map(TRACKS.map((song) => [song.id, song]));
  artistById = new Map(ARTISTS.map((artist) => [artist.id, artist]));
  artistByProfileId = new Map(ARTISTS.map((artist) => [artist.profileId, artist]));
  collectionById = new Map(COLLECTIONS.map((collection) => [collection.id, collection]));
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Replace the registry with a server payload — in place, because a dozen modules hold
 * a reference to these arrays.
 */
export function hydrateCatalog(payload: Partial<CatalogResponse>): number {
  TRACKS.splice(0, TRACKS.length, ...(payload.songs ?? []));
  ARTISTS.splice(0, ARTISTS.length, ...(payload.artists ?? []));
  COLLECTIONS.splice(0, COLLECTIONS.length, ...(payload.collections ?? []));
  TAGS.splice(0, TAGS.length, ...(payload.tags ?? []));
  syncedAt = Number(payload.generatedAt ?? Date.now()) || Date.now();
  reindex();
  return TRACKS.length;
}

/**
 * Add songs the server handed over later, without disturbing what is already here.
 *
 * The boot payload is a window — the newest few hundred nasheeds, not necessarily the
 * whole library of the world — so a page that needs an older one (a loved nasheed from
 * last year, the back catalogue of a reciter) asks for it and folds the answer in.
 * Order is kept: the booted window first, the adopted ones appended in arrival order.
 */
export function adoptSongs(songs: Song[]): number {
  if (!songs.length) return version;
  let added = 0;
  for (const song of songs) {
    const at = TRACKS.findIndex((existing) => existing.id === song.id);
    if (at >= 0) TRACKS[at] = song;
    else {
      TRACKS.push(song);
      added += 1;
    }
  }
  if (added) reindex();
  return added;
}

/** Add reciters the server handed over later (an artist page for somebody off-window). */
export function adoptArtists(artists: ArtistCard[]): number {
  if (!artists.length) return version;
  let added = 0;
  for (const artist of artists) {
    const at = ARTISTS.findIndex((existing) => existing.id === artist.id);
    if (at >= 0) ARTISTS[at] = artist;
    else {
      ARTISTS.push(artist);
      added += 1;
    }
  }
  if (added) reindex();
  return added;
}

/** Empty the registry — what signing out, or losing the connection, does not do. */
export function resetCatalog(): void {
  hydrateCatalog({ songs: [], artists: [], collections: [], tags: [], generatedAt: Date.now() });
  syncedAt = 0;
}

export function catalogIsEmpty(): boolean {
  return TRACKS.length === 0;
}

/* ---------------------------------------------------------------- lookups */

export function getTrack(id: string | null | undefined): Song | undefined {
  if (!id) return undefined;
  return trackById.get(id) ?? getPreview(id);
}

export function getArtist(id: string | null | undefined): ArtistCard | undefined {
  return id ? (artistById.get(id) ?? artistByProfileId.get(id)) : undefined;
}

export function getCollection(id: string | null | undefined): CatalogCollection | undefined {
  return id ? collectionById.get(id) : undefined;
}

/** The publisher of a nasheed, from the row itself when the artist list is behind. */
export function artistOf(song: Song): ArtistCard {
  const known =
    (song.ownerId ? artistByProfileId.get(song.ownerId) : undefined) ??
    (song.ownerHandle ? artistById.get(song.ownerHandle) : undefined);
  if (known) return known;

  const handle = song.ownerHandle ?? "unknown";
  return {
    id: handle,
    profileId: song.ownerId ?? "",
    handle,
    name: song.ownerName ?? handle,
    nameAr: null,
    role: "Publisher",
    origin: "—",
    bio: "",
    accent: "jade",
    verified: false,
    kind: "artist",
    avatarPath: null,
    songs: 0,
    followers: 0,
  };
}

export function tracksOf(collection: CatalogCollection): Song[] {
  return collection.songIds.map((id) => trackById.get(id)).filter((song): song is Song => !!song);
}

export function tracksByArtist(artistId: string): Song[] {
  const artist = getArtist(artistId);
  return TRACKS.filter(
    (song) => song.ownerHandle === artistId || (!!artist && song.ownerId === artist.profileId),
  );
}

export function collectionsOf(song: Song): CatalogCollection[] {
  return COLLECTIONS.filter((collection) => collection.songIds.includes(song.id));
}

export function songsByIds(ids: string[]): Song[] {
  return ids.map((id) => trackById.get(id)).filter((song): song is Song => !!song);
}

/* ------------------------------------------------------------- presentation */

export function audioUrlOf(song: Song): string | null {
  return audioUrl(song.audioPath);
}

export function artworkUrlOf(song: Song): string | null {
  return artworkUrl(song.artworkPath);
}

/** Known length in seconds; 0 when the publisher never recorded one. */
export function durationOf(song: Song): number {
  return song.durationMs && song.durationMs > 0 ? song.durationMs / 1000 : 0;
}

export function totalDuration(songs: Song[]): number {
  return songs.reduce((sum, song) => sum + durationOf(song), 0);
}

/** Real counters, straight off the row. Nothing here is estimated. */
export function statsFor(song: Song): { plays: number; likes: number; reposts: number; comments: number } {
  return { plays: song.plays, likes: song.likes, reposts: 0, comments: song.notes };
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `${n}`;
}

export function formatListens(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Every tag in the live catalogue, with how many nasheeds carry it. */
export function tagCounts(): TagCount[] {
  if (TAGS.length) return TAGS;
  const counts = new Map<string, number>();
  for (const song of TRACKS) for (const tag of song.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function allTags(): string[] {
  return tagCounts().map((entry) => entry.tag);
}

/* ------------------------------------------------------------------ search */

function haystack(song: Song): string {
  const artist = artistOf(song);
  return [
    song.title,
    song.titleAr ?? "",
    song.note,
    artist.name,
    artist.nameAr ?? "",
    artist.origin,
    ...song.tags,
    ...song.lines.map((line) => `${line.tr ?? ""} ${line.en ?? ""} ${line.ar ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();
}

export function searchTracks(query: string): Song[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);

  return TRACKS.map((song) => {
    const hay = haystack(song);
    const title = song.title.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!hay.includes(term)) return { song, score: 0 };
      score += 3;
      if (title.includes(term)) score += 6;
      if (title.startsWith(term)) score += 4;
      if (artistOf(song).name.toLowerCase().includes(term)) score += 4;
      if (song.tags.some((tag) => tag.startsWith(term))) score += 3;
    }
    return { song, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.song);
}

export function searchArtists(query: string): ArtistCard[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ARTISTS.filter((artist) =>
    `${artist.name} ${artist.nameAr ?? ""} ${artist.origin} ${artist.role} ${artist.bio}`.toLowerCase().includes(q),
  );
}

export function searchCollections(query: string): CatalogCollection[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return COLLECTIONS.filter((collection) =>
    `${collection.title} ${collection.titleAr ?? ""} ${collection.blurb} ${collection.tags.join(" ")}`
      .toLowerCase()
      .includes(q),
  );
}

export function searchTags(query: string): TagCount[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return tagCounts().filter((entry) => entry.tag.includes(q));
}

/* ------------------------------------------------------- derived shelves */

/** The catalogue as it arrives: newest first, which is the order the payload uses. */
export function latestSongs(limit = 12): Song[] {
  return [...TRACKS].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, limit);
}

export function popularSongs(limit = 12): Song[] {
  return [...TRACKS].sort((a, b) => b.plays - a.plays || b.likes - a.likes).slice(0, limit);
}

/** Tags with more than one nasheed, for the browse rail. */
export function busyTags(limit = 12): TagCount[] {
  return tagCounts().filter((entry) => entry.count > 0).slice(0, limit);
}
