/**
 * The composer.
 *
 * Turns a Track (maqām + tempo + lyric lines) into a concrete performance:
 * a list of vocal notes, frame-drum hits, hum drones — and, crucially, the exact
 * start/end time of every lyric line and every word inside it. Because the lyric
 * timings come *from* the same schedule the audio engine plays, the karaoke view can
 * never drift out of sync.
 */

import { degreeToFreq, syllabifyLine } from "./theory";
import { chance, clamp, pick, rngFrom, type Rng } from "./prng";
import type { Vowel } from "./voice-types";
import type { LyricLine, Track } from "../data/types";

export const BEATS_PER_BAR = 4;

export type NoteRole = "lead" | "harm" | "hum";

export type NoteEvent = {
  t: number;
  dur: number;
  freq: number;
  vowel: Vowel;
  gain: number;
  role: NoteRole;
  /** glide in from this frequency (portamento) */
  from?: number;
  pan?: number;
};

export type DuffEvent = { t: number; kind: "dum" | "tak"; gain: number };

export type WordTime = { w: number; text: string; t: number; end: number };

export type LineTime = {
  i: number;
  /** which repetition of the text this is (0-based) */
  pass: number;
  t: number;
  end: number;
  words: WordTime[];
  line: LyricLine;
  sung: string;
};

export type Song = {
  trackId: string;
  duration: number;
  introEnd: number;
  notes: NoteEvent[];
  duff: DuffEvent[];
  lines: LineTime[];
  bars: number;
};

/** Phrase shapes, expressed as maqām scale degrees relative to the tonic. */
const MOTIFS: number[][] = [
  [0, 1, 2, 3, 4, 3, 2, 0],
  [0, 2, 3, 4, 3, 2, 1, 0],
  [4, 3, 2, 3, 4, 5, 4, 2],
  [2, 3, 4, 5, 7, 5, 4, 2],
  [0, 0, 2, 4, 3, 2, 0, 0],
  [5, 4, 3, 2, 3, 2, 1, 0],
  [0, 2, 4, 3, 2, 4, 5, 4],
  [7, 5, 4, 3, 2, 3, 2, 0],
];

const RHYTHMS: number[][] = [
  [1, 1, 1, 1],
  [1, 0.5, 0.5, 1, 1],
  [0.5, 0.5, 1, 1, 1],
  [1, 1, 0.5, 0.5, 1, 1],
  [1.5, 0.5, 1, 1],
  [1, 1, 1, 0.5, 0.5, 1],
  [0.75, 0.75, 1, 1.5],
];

const MELODIA = [
  { steps: [1, 0], w: 1 },
  { steps: [1, 2, 0], w: 1 },
  { steps: [-1, 0], w: 1 },
  { steps: [2, 1, 0], w: 0.8 },
  { steps: [0, 1, 0], w: 0.7 },
];

export function motifLabel(i: number): string {
  return `phrase ${i + 1}`;
}

function cadenceFor(lineIndex: number, total: number): number {
  if (lineIndex === total - 1) return 0;
  switch (lineIndex % 4) {
    case 0:
      return 4;
    case 1:
      return 2;
    case 2:
      return 4;
    default:
      return 0;
  }
}

function phraseDurations(n: number, rng: Rng): number[] {
  const pattern = pick(rng, RHYTHMS);
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    let d = pattern[i % pattern.length]!;
    if (i === n - 1) d *= 1.9; // hold the last syllable
    else if (i === 0) d *= 1.1;
    raw.push(d);
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  // snap the phrase to whole bars so vocals and duff stay together
  let bars = clamp(Math.round(sum / BEATS_PER_BAR), 1, 4);
  let scale = (bars * BEATS_PER_BAR) / sum;
  if (scale > 1.6 || scale < 0.62) {
    bars = clamp(Math.round(sum * (scale > 1.6 ? 1.7 : 0.8) / BEATS_PER_BAR), 1, 5);
    scale = (bars * BEATS_PER_BAR) / sum;
  }
  return raw.map((d) => d * scale);
}

function addDuff(notes: DuffEvent[], pattern: string, t: number, spb: number, accent: number, limit: number) {
  const step = spb / 4;
  for (let i = 0; i < 16; i++) {
    const ch = pattern[i] ?? ".";
    if (ch === ".") continue;
    const at = t + i * step;
    if (at > limit) continue; // never ring past the final bar
    const kind: "dum" | "tak" = ch === "D" || ch === "d" ? "dum" : "tak";
    const base = ch === "D" ? 1 : ch === "d" ? 0.55 : ch === "T" ? 0.72 : 0.36;
    notes.push({ t: at, kind, gain: base * accent });
  }
}

export function buildSong(track: Track): Song {
  const rng = rngFrom(`${track.seed}|${track.id}`);
  const spb = 60 / track.bpm;
  const introBars = track.introBars ?? 2;
  const introEnd = introBars * BEATS_PER_BAR * spb;

  const notes: NoteEvent[] = [];
  const duff: DuffEvent[] = [];
  const lines: LineTime[] = [];

  const choir = track.voices === "choir";
  const duet = track.voices !== "solo";
  const bank = track.motifBank && track.motifBank.length ? track.motifBank : [0, 1, 2, 3, 4, 5, 6, 7];

  /* Nasheeds repeat: the same words come back lifted a step, then settle home.
     Each pass is re-composed from the same lines with fresh motifs, so the lyric
     timings keep following the voice instead of looping a fixed recording. */
  const passes = Math.max(1, track.passes ?? 2);
  const liftByPass = [0, 2, 0, -2];

  let cursor = introEnd;

  for (let pass = 0; pass < passes; pass++) {
    const lift = liftByPass[pass % liftByPass.length]!;
    const isFinalPass = pass === passes - 1;

  track.lines.forEach((line, li) => {
    const isLast = li === track.lines.length - 1;
    const lineStart = cursor;
    const { words, syllables } = syllabifyLine(line.tr ?? line.en, line.ar);
    const sung = words.join(" ");
    const n = syllables.length;

    const motif = MOTIFS[pick(rng, bank) % MOTIFS.length]!;
    const durs = phraseDurations(n, rng);
    const cadence = cadenceFor(li, track.lines.length);

    const wordTimes: WordTime[] = words.map((text, w) => ({
      text,
      w,
      t: Number.POSITIVE_INFINITY,
      end: Number.NEGATIVE_INFINITY,
    }));
    let prevFreq: number | undefined;

    let nt = lineStart;
    for (let s = 0; s < n; s++) {
      const syl = syllables[s]!;
      const beats = durs[s]!;
      const isFinalSyl = s === n - 1;

      let deg: number;
      if (isFinalSyl) deg = cadence;
      else if (li === 0 && s === 0) deg = 0;
      else {
        const mi = Math.floor((s / n) * motif.length) % motif.length;
        deg = motif[mi]!;
        if (chance(rng, 0.16)) deg += pick(rng, [-1, 1]);
      }
      deg = clamp(deg + (isFinalSyl && isLast ? 0 : lift), -2, 9);

      const freq = degreeToFreq(track.root, track.maqam, deg);
      const sylStart = nt;
      const sylBeats = beats;

      // melisma: a short ornamental run on one syllable
      const canMelisma = !isFinalSyl && beats >= 1 && chance(rng, 0.24);
      if (canMelisma) {
        const m = pick(rng, MELODIA);
        const parts = m.steps.length;
        const per = (sylBeats / (parts + 0.6)) * spb;
        let mt = nt;
        m.steps.forEach((off, k) => {
          const d = k === parts - 1 ? per * 1.6 : per;
          const f = degreeToFreq(track.root, track.maqam, clamp(deg + off, -2, 10));
          notes.push({
            t: mt,
            dur: d * 0.96,
            freq: f,
            vowel: syl.vowel,
            gain: (k === 0 ? 1 : 0.82) * (0.94 + pass * 0.03),
            role: "lead",
            from: prevFreq,
          });
          prevFreq = f;
          mt += d;
        });
        nt = sylStart + sylBeats * spb;
      } else {
        const d = sylBeats * spb;
        notes.push({
          t: nt,
          dur: d * (isFinalSyl ? 1.02 : 0.88),
          freq,
          vowel: syl.vowel,
          gain: (isFinalSyl ? 1 : 0.94) * (0.94 + pass * 0.03),
          role: "lead",
          from: chance(rng, 0.35) ? prevFreq : undefined,
        });
        prevFreq = freq;
        nt = sylStart + d;
      }

      const wt = wordTimes[syl.word];
      if (wt) {
        wt.t = Math.min(wt.t, sylStart);
        wt.end = Math.max(wt.end, nt);
      }
    }

    const lineEnd = nt;

    // any word that received no syllable (punctuation, stray tokens) sits in the gap
    let fill = lineStart;
    for (const wt of wordTimes) {
      if (!Number.isFinite(wt.t)) {
        wt.t = fill;
        wt.end = fill;
      } else {
        fill = wt.end;
      }
    }
    if (wordTimes.length) wordTimes[wordTimes.length - 1]!.end = lineEnd;

    // harmony voices answer the lead line with sustained "ooh"s
    if (duet) {
      const steps = Math.max(2, Math.round((lineEnd - lineStart) / (spb * 2)));
      for (let h = 0; h < steps; h++) {
        const ht = lineStart + ((lineEnd - lineStart) * h) / steps;
        const hd = (lineEnd - lineStart) / steps;
        const deg = clamp(cadenceFor(li, track.lines.length) - (h % 2 === 0 ? 2 : 3), -5, 7);
        notes.push({
          t: ht + 0.03,
          dur: hd * 1.02,
          freq: degreeToFreq(track.root, track.maqam, deg),
          vowel: "u",
          gain: 0.3 + pass * 0.03,
          role: "harm",
          pan: -0.28,
        });
        if (choir) {
          notes.push({
            t: ht + 0.05,
            dur: hd * 1.02,
            freq: degreeToFreq(track.root, track.maqam, deg + 2),
            vowel: "o",
            gain: 0.2,
            role: "harm",
            pan: 0.3,
          });
        }
      }
    }

    // low hum drone under each phrase (tonic + fifth below)
    notes.push({
      t: lineStart,
      dur: (lineEnd - lineStart) * 1.06,
      freq: degreeToFreq(track.root, track.maqam, -7),
      vowel: "m",
      gain: choir ? 0.13 : 0.09,
      role: "hum",
    });
    if (choir) {
      notes.push({
        t: lineStart + (lineEnd - lineStart) * 0.5,
        dur: (lineEnd - lineStart) * 0.56,
        freq: degreeToFreq(track.root, track.maqam, -4),
        vowel: "m",
        gain: 0.07,
        role: "hum",
        pan: 0.2,
      });
    }

    lines.push({ i: lines.length, t: lineStart, end: lineEnd, words: wordTimes, line, sung, pass });

    // breath — longer between passes, and the final line of the final pass runs into the outro
    const breath = (isLast ? (isFinalPass ? 0 : 2.4) : (li + 1) % 4 === 0 ? 1.7 : 0.8) * spb;
    cursor = lineEnd + breath;
  });
  }

  // outro: a settling drone
  const outroBars = passes > 2 ? 3 : 2;
  const outroStart = cursor;
  notes.push({
    t: outroStart,
    dur: outroBars * BEATS_PER_BAR * spb,
    freq: degreeToFreq(track.root, track.maqam, -7),
    vowel: "m",
    gain: 0.1,
    role: "hum",
  });
  notes.push({
    t: outroStart,
    dur: outroBars * BEATS_PER_BAR * spb * 0.9,
    freq: degreeToFreq(track.root, track.maqam, 0),
    vowel: "u",
    gain: duet ? 0.22 : 0.14,
    role: "harm",
  });
  const totalDuration = outroStart + outroBars * BEATS_PER_BAR * spb;

  // intro hum so the track never opens on silence
  notes.push({
    t: 0,
    dur: introEnd,
    freq: degreeToFreq(track.root, track.maqam, -7),
    vowel: "m",
    gain: 0.1,
    role: "hum",
  });

  // frame drum
  if (track.duff) {
    const bars = Math.ceil(totalDuration / (BEATS_PER_BAR * spb));
    const verseBar = track.duffEnter === "verse" ? introBars : 0;
    for (let b = 0; b < bars; b++) {
      const accent = b % 4 === 0 ? 1 : 0.86;
      const t = b * BEATS_PER_BAR * spb;
      if (t > totalDuration) break;
      if (b < verseBar) {
        duff.push({ t, kind: "dum", gain: 0.5 });
      } else {
        addDuff(duff, track.duff, t, spb, accent, totalDuration);
      }
    }
  }

  notes.sort((a, b) => a.t - b.t);

  return {
    trackId: track.id,
    duration: totalDuration,
    introEnd,
    notes,
    duff,
    lines,
    bars: Math.ceil(totalDuration / (BEATS_PER_BAR * spb)),
  };
}

const cache = new Map<string, Song>();

export function songFor(track: Track): Song {
  const hit = cache.get(track.id);
  if (hit) return hit;
  const built = buildSong(track);
  cache.set(track.id, built);
  return built;
}
