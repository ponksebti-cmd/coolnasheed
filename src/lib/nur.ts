/**
 * Nūr — the on-device curator.
 *
 * A small, honest recommender: it builds a taste vector from your likes and
 * recent plays (tags, maqām, publisher), scores the catalogue against it,
 * then greedily picks a mix with diversity constraints and writes a reason for
 * every choice. Everything runs locally and deterministically from a seed, so
 * the same night produces the same mix.
 *
 * The prose is generated from templates. It is meant to be a little pleased with
 * itself. It is not a person.
 */

import { TRACKS, artistOf, durationOf, getTrack, statsFor } from "../data/catalog";
import type { Track } from "../data/types";
import type { HistoryEntry } from "../store/library";
import { MAQAMAT, maqamLabel, type MaqamName } from "./theory";
import { hashString, mulberry32, pick, shuffle } from "./prng";
import { formatTime } from "./format";

export type NurPick = { track: Track; reason: string; score: number };

export type NurMix = {
  id: string;
  title: string;
  titleAr: string;
  blurb: string;
  mood: string;
  seed: string;
  picks: NurPick[];
  trackIds: string[];
  duration: number;
  generatedAt: number;
};

const TITLES = [
  { en: "Light After ʿIshāʾ", ar: "نور بعد العشاء" },
  { en: "Between Two Adhāns", ar: "بين أذانين" },
  { en: "A Room With One Window", ar: "غرفة بنافذة واحدة" },
  { en: "Slow Mercy", ar: "رحمة بطيئة" },
  { en: "The Courtyard at 4am", ar: "الفناء في الرابعة فجرًا" },
  { en: "Rain on Stone", ar: "مطر على حجر" },
  { en: "Letters Not Sent", ar: "رسائل لم تُرسل" },
  { en: "The Long Sajda", ar: "السجدة الطويلة" },
  { en: "Green Hour", ar: "الساعة الخضراء" },
  { en: "After the Guests Leave", ar: "بعد أن يغادر الضيوف" },
  { en: "Ninety-Nine Quiet Things", ar: "تسعة وتسعون شيئًا هادئًا" },
  { en: "Voices Only", ar: "أصوات فقط" },
];

const MOODS = [
  { id: "still", label: "stillness", want: (t: Track) => t.tags.includes("stillness") || t.tags.includes("calm") },
  { id: "longing", label: "longing", want: (t: Track) => ["hijaz", "bayati", "saba", "kurd"].includes(t.maqam) },
  { id: "praise", label: "praise", want: (t: Track) => t.tags.includes("salawat") || t.tags.includes("praise") },
  { id: "dhikr", label: "repetition", want: (t: Track) => t.tags.includes("dhikr") },
  { id: "dawn", label: "dawn", want: (t: Track) => t.tags.includes("dawn") || t.tags.includes("morning") },
  { id: "night", label: "night", want: (t: Track) => t.tags.includes("night") || t.tags.includes("sleep") },
  { id: "joy", label: "ʿīd energy", want: (t: Track) => t.tags.includes("celebration") || t.tags.includes("eid") },
  { id: "quran", label: "āyāt", want: (t: Track) => t.tags.includes("quran") },
];

export type Taste = {
  tags: Record<string, number>;
  maqam: Record<string, number>;
  artists: Record<string, number>;
  plays: number;
};

export function buildTaste(liked: string[], history: HistoryEntry[]): Taste {
  const taste: Taste = { tags: {}, maqam: {}, artists: {}, plays: 0 };
  const bump = (map: Record<string, number>, key: string, amount: number) => {
    map[key] = (map[key] ?? 0) + amount;
  };

  liked.forEach((id) => {
    const t = getTrack(id);
    if (!t) return;
    bump(taste.artists, t.artistId, 1.6);
    bump(taste.maqam, t.maqam, 1.4);
    t.tags.forEach((tag) => bump(taste.tags, tag, 1));
    taste.plays += 1.2;
  });

  const now = Date.now();
  history.forEach((h) => {
    const t = getTrack(h.id);
    if (!t) return;
    const age = (now - h.at) / 86_400_000;
    const recency = 1 / (1 + age / 6);
    const w = Math.min(3, h.count) * recency;
    bump(taste.artists, t.artistId, w * 0.9);
    bump(taste.maqam, t.maqam, w);
    t.tags.forEach((tag) => bump(taste.tags, tag, w * 0.7));
    taste.plays += w;
  });

  return taste;
}

export function dominantMood(taste: Taste): (typeof MOODS)[number] {
  if (taste.plays < 0.5) return pick(mulberry32(Date.now() >> 22), MOODS);
  const scored = MOODS.map((m) => {
    let s = 0;
    TRACKS.forEach((t) => {
      const w = (taste.tags[t.tags[0] ?? ""] ?? 0) + (taste.maqam[t.maqam] ?? 0);
      if (m.want(t)) s += w;
    });
    return { m, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0]!.m;
}

function scoreTrack(t: Track, taste: Taste, mood: (typeof MOODS)[number]): number {
  let score = 0.35; // base curiosity
  const tagScore = t.tags.reduce((sum, tag) => sum + (taste.tags[tag] ?? 0), 0);
  score += tagScore * 0.55;
  score += (taste.maqam[t.maqam] ?? 0) * 0.85;
  score += (taste.artists[t.artistId] ?? 0) * 0.45;

  if (mood.want(t)) score += 1.9;

  // a little novelty: unheard artists get a nudge, mega-heard ones get a rest
  const artistWeight = taste.artists[t.artistId] ?? 0;
  if (artistWeight === 0) score += 1.1;
  if (artistWeight > 6) score -= 1.2;

  const stats = statsFor(t);
  score += Math.log10((stats.plays + 10) / 10_000) * 0.22;
  return score;
}

function reasonFor(t: Track, taste: Taste, mood: (typeof MOODS)[number], rng: () => number, prev?: Track): string {
  const artist = artistOf(t);
  const maqam = maqamLabel(t.maqam);
  const heard = (taste.artists[t.artistId] ?? 0) > 0;
  const options: string[] = [];

  if (!heard) {
    options.push(
      `You have not played ${artist.name} before. ${artist.origin.split(" → ")[0]} deserves one evening.`,
      `New voice for you: ${artist.name}, ${artist.role}. Filed under “should have found this sooner”.`,
    );
  }
  if (t.maqam === prev?.maqam) {
    options.push(`Stays in ${maqam} — the mode you keep returning to, ${Math.round((taste.maqam[t.maqam] ?? 0) * 10) / 10} points of it.`);
  } else {
    options.push(`Your listening leans ${maqam}; this is ${MAQAMAT[t.maqam].mood}.`);
  }
  if (mood.want(t)) options.push(`Matches the ${mood.label} you have been circling all week.`);
  if (durationOf(t) > 0 && durationOf(t) < 180) options.push(`Short enough to repeat — ${formatTime(durationOf(t))} from ${artist.name}.`);
  if (durationOf(t) >= 360) options.push(`Long enough to sit inside: ${formatTime(durationOf(t))}.`);
  const line = t.lines.find((l) => l.note?.startsWith("Qurʾān"));
  if (line) options.push(`Line ${t.lines.indexOf(line) + 1} is ${line.note}, sung rather than recited.`);
  options.push(`Because ${pick(rng, t.tags)} is doing a lot of work in your history right now.`);

  return pick(rng, options);
}

function mixBlurb(mood: (typeof MOODS)[number], taste: Taste, count: number, rng: () => number): string {
  const topTag = Object.entries(taste.tags).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "quiet";
  const topMaqam = Object.entries(taste.maqam).sort((a, b) => b[1] - a[1])[0]?.[0];
  const maqamText = topMaqam && topMaqam in MAQAMAT ? MAQAMAT[topMaqam as MaqamName].name : "several modes";
  const openers = [
    `${count} tracks leaning ${mood.label}, built from ${taste.plays < 1 ? "almost nothing — you are new here" : `a taste that keeps choosing ${topTag}`}.`,
    `Assembled around ${mood.label} and ${maqamText}. Nothing here is loud about itself.`,
    `A ${mood.label} set in ${maqamText}.`,
  ];
  const closers = [
    "Play it while the house is still awake.",
    "Best after ʿIshāʾ, worse while driving.",
    "Ordered so the quiet ones land last.",
    "Nothing here needs you to feel something on schedule.",
  ];
  return `${pick(rng, openers)} ${pick(rng, closers)}`;
}

export function generateNurMix(opts: {
  liked: string[];
  history: HistoryEntry[];
  moodId?: string;
  size?: number;
  seedKey?: string;
}): NurMix {
  const size = opts.size ?? 8;
  const taste = buildTaste(opts.liked, opts.history);
  const mood = opts.moodId ? (MOODS.find((m) => m.id === opts.moodId) ?? dominantMood(taste)) : dominantMood(taste);
  const seedKey = opts.seedKey ?? `${mood.id}-${new Date().toISOString().slice(0, 10)}`;
  const rng = mulberry32(hashString(`nur:${seedKey}:${opts.liked.length}:${opts.history.length}`));

  const scored = TRACKS.map((track) => ({ track, score: scoreTrack(track, taste, mood) + rng() * 0.55 }));
  scored.sort((a, b) => b.score - a.score);

  const picks: NurPick[] = [];
  let prev: Track | undefined;
  let sameArtistRun = 0;
  let sameMaqamRun = 0;

  for (const candidate of scored) {
    if (picks.length >= size) break;
    const t = candidate.track;
    if (prev && t.artistId === prev.artistId) {
      sameArtistRun++;
      if (sameArtistRun > 1) continue;
    } else sameArtistRun = 0;
    if (prev && t.maqam === prev.maqam) {
      sameMaqamRun++;
      if (sameMaqamRun > 2) continue;
    } else sameMaqamRun = 0;

    picks.push({ track: t, score: candidate.score, reason: reasonFor(t, taste, mood, rng, prev) });
    prev = t;
  }

  while (picks.length < size) {
    const rest = shuffle(rng, TRACKS.filter((t) => !picks.some((p) => p.track.id === t.id)));
    const t = rest[0];
    if (!t) break;
    picks.push({ track: t, score: 0.4, reason: "One wildcard. I am a small model and I like surprises." });
  }

  const ordered = picks;

  const title = pick(rng, TITLES);
  const duration = ordered.reduce((sum, p) => sum + durationOf(p.track), 0);

  return {
    id: `nur-${hashString(seedKey).toString(36)}`,
    title: title.en,
    titleAr: title.ar,
    blurb: mixBlurb(mood, taste, ordered.length, rng),
    mood: mood.label,
    seed: `nur-${seedKey}`,
    picks: ordered,
    trackIds: ordered.map((p) => p.track.id),
    duration,
    generatedAt: Date.now(),
  };
}

/** One-line "why this is here" for any track, used across the app. */
export function whyThis(track: Track, liked: string[], history: HistoryEntry[]): string {
  const rng = mulberry32(hashString(`why:${track.id}`));
  const taste = buildTaste(liked, history);
  return reasonFor(track, taste, dominantMood(taste), rng);
}

export const NUR_MOODS = MOODS.map((m) => ({ id: m.id, label: m.label }));

export const NUR_VOICE = [
  "I am Nūr. I keep your listening in a small notebook and I am very pleased with it.",
  "Everything I know about your taste lives in this browser. It is not much. It is enough.",
  "I only know what you have played, what you loved, and the maqām of each of them.",
];
