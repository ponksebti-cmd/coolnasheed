/**
 * Maqām reference.
 *
 * A nasheed is sung in a maqām (an Arabic melodic mode), and several of them use
 * quarter tones. That is the whole of what this file knows: the modes, their names,
 * and the mood each one is known for. Nothing here makes a sound — a nasheed in this
 * app is a recording, and the mode is metadata a listener browses by.
 */

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

export function maqamLabel(maqam: MaqamName): string {
  return MAQAMAT[maqam].name;
}

export function maqamMood(maqam: MaqamName): string {
  return MAQAMAT[maqam].mood;
}

/** Some maqāmāt step in quarter tones rather than semitones. */
export function hasQuarterTones(maqam: MaqamName): boolean {
  return MAQAMAT[maqam].steps.some((s) => Math.abs(s - Math.round(s)) > 0.01);
}
