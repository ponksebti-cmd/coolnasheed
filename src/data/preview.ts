/**
 * The studio's preview.
 *
 * While a nasheed is being written it is not in the catalogue, but its mp3 is already
 * in storage (or still a local file) and the person writing it should hear exactly what
 * a listener will hear — the same player, the same lyrics view, the same progress bar.
 *
 * So a preview is registered here and resolves like a track, but it never appears in a
 * list, a search result or a shelf: it is one row the player can look up, and nothing
 * else. It is not mock data — it is the publisher's own unpublished upload.
 */

import type { Song } from "../../shared/types";

let preview: Song | null = null;

export function registerPreview(song: Song | null): void {
  preview = song;
}

export function getPreview(id: string | null | undefined): Song | undefined {
  return id && preview?.id === id ? preview : undefined;
}

export function isPreview(id: string | null | undefined): boolean {
  return !!id && preview?.id === id;
}

export function clearPreview(): void {
  preview = null;
}
