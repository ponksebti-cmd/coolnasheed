/**
 * Maqām theory + a tiny syllabifier.
 *
 * Nasheeds are traditionally sung in a maqām (Arabic melodic mode), several of which
 * use quarter tones. Web Audio can tune to fractional semitones, so we keep them.
 */

import type { Vowel } from "./voice-types";

export const MAQAMAT = {
  rast: { name: "Rāst", ar: "رست", steps: [0, 2, 3.5, 5, 7, 9, 10.5], mood: "grounded, dignified" },
  bayati: { name: "Bayātī", ar: "بياتي", steps: [0, 1.5, 3, 5, 7, 8, 10], mood: "tender, yearning" },
  hijaz: { name: "Ḥijāz", ar: "حجاز", steps: [0, 1, 4, 5, 7, 8, 10], mood: "desert longing" },
  nahawand: { name: "Nahāwand", ar: "نهاوند", steps: [0, 2, 3, 5, 7, 8, 10], mood: "soft, wistful" },
  kurd: { name: "Kurd", ar: "كرد", steps: [0, 1, 3, 5, 7, 8, 10], mood: "quiet ache" },
  ajam: { name: "ʿAjam", ar: "عجم", steps: [0, 2, 4, 5, 7, 9, 11], mood: "bright, open" },
  saba: { name: "Ṣabā", ar: "صبا", steps: [0, 1.5, 3, 4, 7, 8, 10], mood: "melancholy dawn" },
  nikriz: { name: "Nikrīz", ar: "نكريز", steps: [0, 2, 3, 6, 7, 9, 10], mood: "cool, reflective" },
  hijazkar: { name: "Ḥijāzkār", ar: "حجازكار", steps: [0, 1, 4, 5, 7, 8, 11], mood: "ceremonial" },
  ushshaq: { name: "ʿUshshāq", ar: "عشاق", steps: [0, 2, 3, 5, 7, 9, 10], mood: "devotional warmth" },
} as const;

export type MaqamName = keyof typeof MAQAMAT;

export const MAQAM_NAMES = Object.keys(MAQAMAT) as MaqamName[];

const A4 = 440;

export function midiToFreq(midi: number): number {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

/** Scale-degree index (can be negative or beyond an octave) → frequency in Hz. */
export function degreeToFreq(rootMidi: number, maqam: MaqamName, degree: number): number {
  const steps = MAQAMAT[maqam].steps;
  const len = steps.length;
  const octave = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  const semitones = steps[idx]! + 12 * octave;
  return midiToFreq(rootMidi + semitones);
}

export function maqamLabel(maqam: MaqamName): string {
  return MAQAMAT[maqam].name;
}

export function maqamMood(maqam: MaqamName): string {
  return MAQAMAT[maqam].mood;
}

/* ------------------------------------------------------------------ */
/* Syllables & vowels — they drive both the rhythm of the melody and   */
/* the formant colour of the synthesized voice.                        */
/* ------------------------------------------------------------------ */

const LATIN_FOLD: Record<string, string> = {
  ā: "a", á: "a", à: "a", â: "a", ä: "a", ã: "a", ą: "a",
  ī: "i", í: "i", ì: "i", î: "i", ï: "i", ı: "i",
  ū: "u", ú: "u", ù: "u", û: "u", ü: "u",
  ē: "e", é: "e", è: "e", ê: "e", ë: "e",
  ō: "o", ó: "o", ò: "o", ô: "o", ö: "o",
  ṭ: "t", ṯ: "t", ţ: "t",
  ṣ: "s", š: "s", ś: "s",
  ḥ: "h", ḫ: "h", ẖ: "h", ĥ: "h",
  ḍ: "d", ð: "d", ď: "d",
  ẓ: "z", ž: "z", ź: "z",
  ṛ: "r", ř: "r",
  ṇ: "n", ñ: "n",
  ğ: "g", ǧ: "j", č: "c", ć: "c", ç: "c",
  ł: "l", ý: "y", ŷ: "y",
};

export function foldLatin(s: string): string {
  let out = "";
  for (const ch of s) {
    out += LATIN_FOLD[ch] ?? (ch === "ʿ" || ch === "'" || ch === "’" || ch === "ʾ" ? "" : ch);
  }
  return out;
}

const VOWEL_CHARS = new Set(["a", "e", "i", "o", "u"]);

function vowelOf(chunk: string): Vowel {
  for (const ch of chunk.toLowerCase()) {
    if (ch === "y") continue;
    if (VOWEL_CHARS.has(ch)) return ch as Vowel;
  }
  return "a";
}

/* Arabic ---------------------------------------------------------- */

const HARAKAT: Record<string, Vowel> = {
  "\u064e": "a", // fatha
  "\u0650": "i", // kasra
  "\u064f": "u", // damma
  "\u0640": "a", // tatweel (ignored below, kept for safety)
};
const LONG_LETTERS: Record<string, Vowel> = {
  "\u0627": "a", // alif
  "\u0649": "a", // alif maqsūra
  "\u0623": "a", // hamza above alif
  "\u0625": "i", // hamza below alif
  "\u0622": "a", // madda
  "\u0624": "u", // waw with hamza
  "\u0626": "i", // ya with hamza
  "\u0648": "u", // waw
  "\u064a": "i", // ya
};
const HARAKAT_SET = new Set(["\u064e", "\u0650", "\u064f", "\u0652", "\u0651", "\u0653"]);

function arabicSyllables(word: string): Vowel[] {
  const chars = Array.from(word);
  const hasHarakat = chars.some((c) => HARAKAT_SET.has(c));

  if (hasHarakat) {
    const out: Vowel[] = [];
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]!;
      const v = HARAKAT[c];
      if (!v || c === "\u0640") continue;
      // a following long letter extends this same syllable, it does not add one
      out.push(v);
    }
    if (out.length) return out;
  }

  // Unvocalized: count consonant-group + vowel-letter chunks.
  const vowels: Vowel[] = [];
  let open = false;
  for (const c of chars) {
    const long = LONG_LETTERS[c];
    if (long) {
      if (!open) {
        vowels.push(long);
        open = true;
      }
    } else {
      open = false;
    }
  }
  if (!vowels.length) {
    const plain = chars.filter((c) => !HARAKAT_SET.has(c)).length;
    const n = Math.max(1, Math.round(plain / 2.2));
    for (let i = 0; i < n; i++) vowels.push(i % 2 === 0 ? "a" : "i");
  }
  return vowels;
}

/* Latin ----------------------------------------------------------- */

function latinSyllables(word: string): Vowel[] {
  const folded = foldLatin(word.toLowerCase()).replace(/[^a-z]/g, "");
  if (!folded) return [];
  const chunks = folded.match(/[aeiou]+/g);
  if (!chunks || chunks.length === 0) return ["e"]; // e.g. "l-" prefixes
  const vowels = chunks.map(vowelOf);
  // trailing silent e: "made" → 1 syllable, but keep "le/re/ee" endings
  const last = chunks[chunks.length - 1]!;
  if (vowels.length > 1 && last === "e" && !/(le|re|ee|ie)$/.test(folded)) {
    vowels.pop();
  }
  return vowels.length ? vowels : ["a"];
}

/* Public ---------------------------------------------------------- */

export type Syllable = { text: string; vowel: Vowel; word: number };
export type Syllabified = { words: string[]; syllables: Syllable[]; script: "latin" | "arabic" };

/**
 * Split a lyric line into display words + singable syllables.
 * Prefers the transliteration (it carries the true vowel colours), then English,
 * then Arabic. The returned `words` are exactly what the lyric view renders, so
 * syllable → word indices stay aligned for karaoke timing.
 */
export function syllabifyLine(primary: string | undefined, arabic: string | undefined): Syllabified {
  const useArabic = !primary || !primary.trim().length;
  const source = useArabic ? (arabic ?? "") : primary!;
  const words = source.split(/\s+/).filter((w) => w.replace(/[^\p{L}\p{M}\u064b-\u0652]/gu, "").length > 0);
  const syllables: Syllable[] = [];

  words.forEach((word, wi) => {
    const clean = word.replace(/[^\p{L}\p{M}\u064b-\u0652-]/gu, "");
    const vowels = useArabic ? arabicSyllables(clean) : latinSyllables(clean);
    const list: Vowel[] = vowels.length ? vowels : ["a"];
    list.forEach((vowel) => syllables.push({ text: clean, vowel, word: wi }));
  });

  if (syllables.length === 0) syllables.push({ text: "hmm", vowel: "m", word: 0 });
  return { words, syllables, script: useArabic ? "arabic" : "latin" };
}

const NOTE_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

export function noteName(midi: number): string {
  const n = ((Math.round(midi) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return `${NOTE_NAMES[n]}${octave}`;
}

export function hasQuarterTones(maqam: MaqamName): boolean {
  return MAQAMAT[maqam].steps.some((s) => Math.abs(s - Math.round(s)) > 0.01);
}
