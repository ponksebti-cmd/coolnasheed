/**
 * What the app reads.
 *
 * These are the shapes the interface renders. They are filled from the server —
 * `hydrateCatalog()` pours a `catalog` payload into the registry in
 * `data/catalog.ts` — so an empty catalogue means an empty app until a nasheed is
 * published. Nothing here is bundled with the client any more.
 */

import type { MaqamName } from "../lib/theory";

export type Artist = {
  /** the handle — this is what a URL carries (/yusuf), so it is the public id */
  id: string;
  name: string;
  nameAr?: string;
  /** the profile tagline, e.g. "voice, no instruments" */
  role: string;
  origin: string;
  bio: string;
  /** seed for the generated avatar pattern */
  seed: string;
  verified?: boolean;
};

export type LyricLine = {
  /** transliteration */
  tr?: string;
  /** Arabic script */
  ar?: string;
  /** English rendering of the meaning */
  en?: string;
  /** attribution, e.g. "Qur'an 9:128" or "refrain" */
  note?: string;
  /** seconds from the start, when the publisher supplied timings */
  t?: number;
};

export type Track = {
  id: string;
  title: string;
  titleAr?: string;
  /** publisher handle */
  artistId: string;
  collections: string[];
  tags: string[];
  /** maqām (melodic mode) */
  maqam: MaqamName;
  /** the note on the sleeve: what this is, where it comes from */
  note: string;
  year: number;
  /** seed for the generated cover */
  seed: string;
  lines: LyricLine[];

  /* --- everything below here comes from the server --- */

  /** storage path turned into a URL: streamed from Supabase Storage */
  audioUrl: string | null;
  artworkUrl: string | null;
  /** length of the recording, ms; null until it is known */
  durationMs: number | null;
  /** real counters, straight from the database */
  stats: { plays: number; likes: number; notes: number };
  ownerId?: string | null;
  status?: "live" | "removed";
  publishedAt?: number;
};

export type CollectionKind = "album" | "mukhtarat" | "mix";

export type Collection = {
  id: string;
  kind: CollectionKind;
  title: string;
  titleAr?: string;
  curator: string;
  blurb: string;
  seed: string;
  tags: string[];
  year: number;
  trackIds: string[];
};
