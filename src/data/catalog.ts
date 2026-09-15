/**
 * The catalogue registry.
 *
 * These three arrays *are* the catalogue as far as the app is concerned: every
 * shelf, every search result, the player and the library read them. They start
 * empty and are filled in place by `hydrateCatalog()` the moment the server
 * answers — so there is no bundled set of nasheeds pretending to be a library, and
 * an unconfigured app shows an empty room rather than an invented one.
 *
 * Mutating in place (rather than reassigning) is what keeps the dozen modules that
 * import these working without a re-render dance.
 */

import { artworkUrl, audioUrl } from "../lib/supabase";
import type { Artist, Collection, Track } from "./types";
import type { ArtistCard, CatalogCollection, Song } from "../../shared/types";

export const TRACKS: Track[] = [];
export const ARTISTS: Artist[] = [];
export const COLLECTIONS: Collection[] = [];

/* ------------------------------------------------------------ derived data */

const trackById = new Map<string, Track>();
const artistById = new Map<string, Artist>();
const collectionById = new Map<string, Collection>();

function reindex(): void {
  trackById.clear();
  TRACKS.forEach((t) => trackById.set(t.id, t));
  artistById.clear();
  ARTISTS.forEach((a) => artistById.set(a.id, a));
  collectionById.clear();
  COLLECTIONS.forEach((c) => collectionById.set(c.id, c));
}

/* ------------------------------------------------------- server hydration

   Song → Track, ArtistCard → Artist, CatalogCollection → Collection. The server
   owns the truth about what exists; these mappers are the only place that knows
   the two vocabularies are different. */

export function trackFromSong(song: Song): Track {
  return {
    id: song.id,
    title: song.title,
    titleAr: song.titleAr ?? undefined,
    // the catalogue keys its publishers by handle, which is what a URL carries
    artistId: song.ownerHandle ?? song.ownerId ?? "",
    collections: [],
    tags: song.tags,
    maqam: song.maqam,
    note: song.note,
    year: song.year ?? new Date(song.publishedAt).getFullYear(),
    seed: `${song.id}-${song.maqam}`,
    lines: song.lines.map((l) => ({ ...l })),
    ownerId: song.ownerId,
    audioUrl: audioUrl(song.audioPath),
    artworkUrl: artworkUrl(song.artworkPath),
    durationMs: song.durationMs ?? null,
    stats: { plays: song.plays, likes: song.likes, notes: song.notes },
    status: song.status,
    publishedAt: song.publishedAt,
  };
}

export function artistFromCard(card: ArtistCard): Artist {
  return {
    id: card.id,
    name: card.name,
    nameAr: card.nameAr ?? undefined,
    role: card.role,
    origin: card.origin,
    bio: card.bio,
    seed: card.seed,
    verified: card.verified,
  };
}

export function collectionFromServer(collection: CatalogCollection): Collection {
  return {
    id: collection.id,
    kind: collection.kind,
    title: collection.title,
    titleAr: collection.titleAr ?? undefined,
    curator: collection.curator,
    blurb: collection.blurb,
    seed: collection.seed,
    tags: collection.tags,
    year: collection.year,
    trackIds: collection.songIds,
  };
}

let serverCatalogAt = 0;

/**
 * Replace the in-memory catalogue with what the server sent.
 * Returns the number of nasheeds it now holds, so the boot log can say what happened.
 */
export function hydrateCatalog(payload: { artists: ArtistCard[]; songs: Song[]; collections: CatalogCollection[] }): number {
  ARTISTS.length = 0;
  ARTISTS.push(...payload.artists.map(artistFromCard));
  TRACKS.length = 0;
  TRACKS.push(...payload.songs.map(trackFromSong));
  COLLECTIONS.length = 0;
  COLLECTIONS.push(...payload.collections.map(collectionFromServer));

  // a track's collections are the ones that list it
  for (const track of TRACKS) {
    track.collections = COLLECTIONS.filter((c) => c.trackIds.includes(track.id)).map((c) => c.id);
  }

  serverCatalogAt = Date.now();
  registryVersion++;
  reindex();
  return TRACKS.length;
}

/** Swap in (or update) a single nasheed — used right after publishing or editing. */
export function applySong(song: Song): Track {
  const track = trackFromSong(song);
  const index = TRACKS.findIndex((t) => t.id === track.id);
  if (index >= 0) TRACKS[index] = track;
  else TRACKS.push(track);
  track.collections = COLLECTIONS.filter((c) => c.trackIds.includes(track.id)).map((c) => c.id);
  registryVersion++;
  reindex();
  return track;
}

/** Drop a nasheed that was taken down or deleted. */
export function forgetSong(id: string): void {
  const index = TRACKS.findIndex((t) => t.id === id);
  if (index >= 0) TRACKS.splice(index, 1);
  registryVersion++;
  reindex();
}

/** When the catalogue last came from the server; 0 means it never did. */
export function catalogSyncedAt(): number {
  return serverCatalogAt;
}

/* -------------------------------------------------- work in progress

   The studio's draft resolves like a track, so you can hear it in the real player
   before publishing — but it never appears in a list, a search result or a shelf. */

let previewTrack: Track | null = null;
let registryVersion = 0;

export function registerPreview(track: Track | null): void {
  previewTrack = track;
  registryVersion++;
}

export function isPreview(id: string | null | undefined): boolean {
  return !!id && previewTrack?.id === id;
}

/** Bumped whenever the registry changes, so memoised lists can invalidate. */
export function catalogVersion(): number {
  return registryVersion;
}

export function getTrack(id: string | null | undefined): Track | undefined {
  if (!id) return undefined;
  return trackById.get(id) ?? (previewTrack?.id === id ? previewTrack : undefined);
}

export function getArtist(id: string | null | undefined): Artist | undefined {
  return id ? artistById.get(id) : undefined;
}

export function getCollection(id: string | null | undefined): Collection | undefined {
  return id ? collectionById.get(id) : undefined;
}

export function artistOf(track: Track): Artist {
  return getArtist(track.artistId) ?? { id: track.artistId, name: "Unknown publisher", role: "", origin: "", bio: "", seed: track.id };
}

export function tracksOf(collection: Collection): Track[] {
  return collection.trackIds.map((id) => trackById.get(id)).filter((t): t is Track => !!t);
}

export function tracksByArtist(artistId: string): Track[] {
  return TRACKS.filter((t) => t.artistId === artistId);
}

export function collectionsOf(track: Track): Collection[] {
  return COLLECTIONS.filter((c) => c.trackIds.includes(track.id));
}

/** Seconds. A recording knows its own length; without one there is nothing to show. */
export function durationOf(track: Track): number {
  return track.durationMs && track.durationMs > 0 ? track.durationMs / 1000 : 0;
}

export function totalDuration(tracks: Track[]): number {
  return tracks.reduce((sum, t) => sum + durationOf(t), 0);
}

/**
 * The counters the database keeps. There are no invented numbers here: a nasheed
 * that has not been played has been played zero times.
 */
export function statsFor(track: Track): { plays: number; likes: number; notes: number } {
  return { plays: track.stats?.plays ?? 0, likes: track.stats?.likes ?? 0, notes: track.stats?.notes ?? 0 };
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `${n}`;
}

/** Every tag in the live catalogue, with how many nasheeds carry it. */
export function tagCounts(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const track of TRACKS) for (const tag of track.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function searchTracks(query: string): Track[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const scored = TRACKS.map((track) => {
    const artist = artistOf(track);
    const hay = [
      track.title,
      track.titleAr ?? "",
      track.note,
      artist.name,
      artist.nameAr ?? "",
      artist.origin,
      track.maqam,
      String(track.year),
      ...track.tags,
      ...track.lines.map((l) => `${l.tr ?? ""} ${l.en ?? ""} ${l.ar ?? ""}`),
    ]
      .join(" ")
      .toLowerCase();
    let score = 0;
    terms.forEach((term) => {
      if (!hay.includes(term)) {
        score -= 10;
        return;
      }
      score += 3;
      if (track.title.toLowerCase().includes(term)) score += 6;
      if (track.title.toLowerCase().startsWith(term)) score += 4;
      if (artist.name.toLowerCase().includes(term)) score += 4;
      if (track.tags.some((t) => t.startsWith(term))) score += 3;
    });
    return { track, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.track);
}

export function searchArtists(query: string): Artist[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ARTISTS.filter((a) => `${a.name} ${a.nameAr ?? ""} ${a.origin} ${a.role} ${a.bio}`.toLowerCase().includes(q));
}

export function searchCollections(query: string): Collection[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return COLLECTIONS.filter((c) => `${c.title} ${c.titleAr ?? ""} ${c.blurb} ${c.tags.join(" ")}`.toLowerCase().includes(q));
}

export const CATALOG = {
  tracks: TRACKS,
  artists: ARTISTS,
  collections: COLLECTIONS,
};
