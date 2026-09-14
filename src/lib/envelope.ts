/** Peak envelope for the waveform seek bar, derived from the performance schedule. */

import type { Song } from "./song";

const cache = new Map<string, number[]>;

export function peaksFor(song: Song, buckets = 190): number[] {
  const key = `${song.trackId}:${buckets}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const peaks = new Float32Array(buckets);
  const span = song.duration / buckets;

  const add = (t: number, dur: number, amount: number) => {
    const from = Math.max(0, Math.floor(t / span));
    const to = Math.min(buckets - 1, Math.ceil((t + dur) / span));
    for (let i = from; i <= to; i++) peaks[i] = Math.max(peaks[i]!, amount);
  };

  song.notes.forEach((n) => {
    const weight = n.role === "lead" ? n.gain : n.role === "harm" ? n.gain * 0.7 : n.gain * 0.55;
    add(n.t, n.dur, weight);
  });
  song.duff.forEach((d) => add(d.t, 0.09, d.kind === "dum" ? d.gain * 0.95 : d.gain * 0.6));

  let max = 0.0001;
  for (let i = 0; i < buckets; i++) max = Math.max(max, peaks[i]!);

  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    // perceptual curve + a floor so the intro hum still reads
    out.push(Math.min(1, 0.08 + Math.pow(peaks[i]! / max, 0.62) * 0.92));
  }
  cache.set(key, out);
  return out;
}
