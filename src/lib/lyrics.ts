/**
 * Lyric timing.
 *
 * A nasheed's words come from the database as an ordered list of lines. When the
 * publisher supplied a `t` for each line (seconds from the start of the recording)
 * those are the timings, and the karaoke view is exact. When they did not, the lines
 * are spread evenly across the duration so the words still move with the voice
 * instead of sitting still.
 *
 * Words inside a line share its span — there is no per-word timing to store, and a
 * line sung evenly is close enough to read along with.
 */

import type { LyricLine } from "../../shared/types";

export type LyricWord = {
  /** index of the word inside the line */
  w: number;
  text: string;
  t: number;
  end: number;
};

export type TimedLine = {
  line: LyricLine;
  /** seconds from the start */
  t: number;
  /** seconds until the next line starts */
  dur: number;
  words: LyricWord[];
};

export type TimedLyrics = {
  trackId: string;
  duration: number;
  lines: TimedLine[];
};

/** The text of a line in the script the reader asked for. */
function primaryText(line: LyricLine): string {
  return line.tr ?? line.en ?? line.ar ?? "";
}

function wordsFor(line: LyricLine, t: number, dur: number): LyricWord[] {
  const text = primaryText(line).split(/\s+/).filter(Boolean);
  if (!text.length) return [];
  const span = Math.max(0.05, dur) / text.length;
  return text.map((w, i) => ({ w: i, text: w, t: t + i * span, end: t + (i + 1) * span }));
}

export function timedLyrics(trackId: string, lines: LyricLine[], duration: number): TimedLyrics {
  const total = Math.max(0, duration);
  const timed = typeof lines[0]?.t === "number";

  if (timed) {
    const starts = lines.map((l) => Math.min(total, Math.max(0, l.t ?? 0)));
    return {
      trackId,
      duration: total,
      lines: lines.map((line, i) => {
        const t = starts[i]!;
        const dur = Math.max(0.05, (i + 1 < lines.length ? starts[i + 1]! : total) - t);
        return { line, t, dur, words: wordsFor(line, t, dur) };
      }),
    };
  }

  // no timings: give every line an equal share of the recording
  const span = lines.length ? total / lines.length : 0;
  return {
    trackId,
    duration: total,
    lines: lines.map((line, i) => {
      const t = i * span;
      return { line, t, dur: span, words: wordsFor(line, t, span) };
    }),
  };
}

/** Which line is being sung at `t`. `-1` before the first one. */
export function lineAt(lines: TimedLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t >= lines[mid]!.t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
