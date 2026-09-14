/**
 * Listener notes.
 *
 * Synthetic but stable: seeded per track so the same nasheed always has the same
 * little community under it. Clearly labelled as generated in the UI — we are not
 * going to pretend imaginary people said imaginary things about imaginary singers
 * without telling you.
 */

import { hashString, mulberry32, pick, intRange } from "./prng";
import type { Track } from "../data/types";

const HANDLES = [
  "umm_sumayya",
  "fajr_walker",
  "ibn_al_bahr",
  "quiet_minaret",
  "sabr_and_coffee",
  "muhajir_1998",
  "layla.k",
  "abu_yusuf",
  "zaytuna_22",
  "night_of_qadr",
  "halabi_in_exile",
  "dust_and_light",
  "rawda_listener",
  "third_of_the_night",
  "sokoto_sings",
  "madrassa_dad",
];

const NOTES = [
  "Played this driving to Fajr and had to sit in the car park for the last line.",
  "That quarter tone in the second phrase is doing something I cannot explain to my family.",
  "My grandmother sang exactly this refrain. I have never heard it recorded properly until now.",
  "Vocals only is the correct version. No notes.",
  "Put it on for the baby, the baby put me to sleep. Ten out of ten.",
  "The hum under the third verse — somebody teach me how that is being made.",
  "Forty listens and the same line still gets me at the same second.",
  "The drum enters late and it is absolutely the right decision.",
  "My whole office is now quietly listening to this. Sorry. Not sorry.",
  "Following the transliteration finally fixed how I have been pronouncing this for years.",
  "Straight into the Ramadan playlist.",
  "Whoever arranged this understood that the silence between lines is part of the song.",
  "I cried at work. Professionally, though. Very professionally.",
  "The reverb sounds like a courtyard, not a studio. That is the whole trick.",
  "Sang this with my brother over the phone in two time zones. Recommended.",
  "The choir drops to one voice on the last line and I have to lie down.",
  "I have searched for a version this slow for six years.",
  "My father asked what was playing and then did not speak for the whole track.",
  "Looped it eleven times during a deadline. The deadline lost.",
  "The English translation made me go and learn the Arabic. So it worked.",
];

export type ListenerNote = {
  id: string;
  handle: string;
  text: string;
  daysAgo: number;
  likes: number;
  verified: boolean;
  atLine?: number;
};

export function notesFor(track: Track, count = 5): ListenerNote[] {
  const rng = mulberry32(hashString(`notes-${track.id}`));
  const n = Math.min(count, 6);
  const out: ListenerNote[] = [];
  const usedHandles = new Set<string>();
  const usedNotes = new Set<string>();

  for (let i = 0; i < n; i++) {
    let handle = pick(rng, HANDLES);
    let guard = 0;
    while (usedHandles.has(handle) && guard++ < 12) handle = pick(rng, HANDLES);
    usedHandles.add(handle);

    let text = pick(rng, NOTES);
    guard = 0;
    while (usedNotes.has(text) && guard++ < 16) text = pick(rng, NOTES);
    usedNotes.add(text);

    out.push({
      id: `${track.id}-${i}`,
      handle,
      text,
      daysAgo: intRange(rng, 0, 96),
      likes: intRange(rng, 1, 480),
      verified: rng() < 0.28,
      atLine: rng() < 0.45 ? intRange(rng, 1, Math.max(1, track.lines.length)) : undefined,
    });
  }

  return out.sort((a, b) => a.daysAgo - b.daysAgo);
}

export function daysAgoLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 31) return `${Math.round(days / 7)} wk ago`;
  return `${Math.round(days / 30)} mo ago`;
}
