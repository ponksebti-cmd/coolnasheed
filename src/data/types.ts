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
