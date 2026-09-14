export type Vowel = "a" | "e" | "i" | "o" | "u" | "m";

/** Approximate singing-formant targets (F1, F2, F3) in Hz with Q + relative gain. */
export const FORMANTS: Record<Vowel, { f: [number, number, number]; q: [number, number, number]; g: [number, number, number] }> = {
  a: { f: [760, 1200, 2600], q: [9, 11, 13], g: [1, 0.52, 0.26] },
  e: { f: [520, 1820, 2500], q: [9, 12, 13], g: [1, 0.46, 0.2] },
  i: { f: [300, 2200, 3000], q: [10, 13, 14], g: [1, 0.4, 0.16] },
  o: { f: [520, 900, 2450], q: [9, 11, 13], g: [1, 0.5, 0.22] },
  u: { f: [330, 860, 2300], q: [9, 11, 14], g: [1, 0.42, 0.18] },
  // closed-lip hum: low, dark, almost no F2/F3
  m: { f: [260, 900, 1900], q: [6, 10, 12], g: [1, 0.2, 0.08] },
};
