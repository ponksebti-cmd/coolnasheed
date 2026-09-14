import type { MaqamName } from "../lib/theory";

export type Accent = "jade" | "gold" | "turq" | "madder" | "cobalt";

export type Artist = {
  id: string;
  name: string;
  nameAr?: string;
  role: string;
  origin: string;
  bio: string;
  seed: string;
  accent: Accent;
  verified?: boolean;
};

export type LyricLine = {
  /** Transliteration — the line that is actually "sung" by the engine when present. */
  tr?: string;
  /** Arabic script. */
  ar?: string;
  /** English rendering. */
  en?: string;
  /** Attribution or performance note, e.g. "Qur'an 9:128" or "refrain". */
  note?: string;
  /**
   * Seconds from the start. Only meaningful for an uploaded recording whose publisher
   * supplied timings; for a synthesized nasheed the composer derives them, which is
   * why the karaoke view can never drift.
   */
  t?: number;
};

export type Track = {
  id: string;
  title: string;
  titleAr?: string;
  artistId: string;
  collections: string[];
  tags: string[];
  /** maqām (melodic mode) */
  maqam: MaqamName;
  /** tonic as a MIDI note (60 = middle C) */
  root: number;
  bpm: number;
  voices: "solo" | "duet" | "choir";
  /** 16-step frame-drum pattern; omit for a vocals-only nasheed */
  duff?: string;
  /** where the duff enters */
  duffEnter?: "intro" | "verse";
  introBars?: number;
  /** how many times the text is sung; later passes lift and settle */
  passes?: number;
  motifBank?: number[];
  blurb: string;
  year: number;
  seed: string;
  accent: Accent;
  lines: LyricLine[];

  /* --- set when this track came from the server rather than the bundled catalogue --- */

  /** publisher account id on the server */
  ownerId?: string | null;
  /** streamed recording; when absent the browser engine sings the composition */
  audioUrl?: string | null;
  artworkUrl?: string | null;
  /** length of the uploaded recording, ms */
  durationMs?: number | null;
  /** real counters; when present they replace the generated demo numbers */
  stats?: { plays: number; likes: number; notes: number };
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
  accent: Accent;
  tags: string[];
  year: number;
  trackIds: string[];
};

export type Mood = {
  id: string;
  label: string;
  labelAr?: string;
  blurb: string;
  accent: Accent;
  seed: string;
  match: (track: Track) => boolean;
};
