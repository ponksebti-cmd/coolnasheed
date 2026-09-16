/**
 * Making an upload fit, before it leaves the browser.
 *
 *   artwork   2 MB   an image over the line is scaled down and re-encoded until it fits
 *   audio     5 MB   an mp3 over the line is transcoded to the highest bitrate that fits
 *
 * Three rules, in order of importance:
 *
 *   1. **Nothing is touched unless it is over the limit.** A recording that already fits
 *      is uploaded byte for byte, because what a listener hears should be exactly what
 *      the publisher recorded. Re-encoding costs quality; nobody should pay it twice.
 *   2. **Nothing is invented.** This is a decoder and an encoder — the same recording,
 *      more compactly stored. There is no synthesiser here and there is not going to be.
 *   3. **If it cannot be done, say so.** A forty-minute recording cannot honestly be
 *      squeezed into 5 MB at a bitrate worth listening to, and pretending otherwise
 *      would produce something the publisher never approved. It is refused, in words,
 *      with what to do about it.
 *
 * The same two numbers live in `shared/types.ts` (what the browser enforces) and in the
 * migrations (what the bucket and the table enforce). A limit that only exists in the
 * interface is a suggestion.
 */

import { MAX_ARTWORK_BYTES, MAX_AUDIO_BYTES } from "../../shared/types";
import { ApiError } from "./errors";

/** The most an mp3 may be after transcoding, padded for container overhead. */
const AUDIO_TARGET = Math.floor(MAX_AUDIO_BYTES * 0.96);
/** Bitrates we are willing to call a recording: below 48 kbps a voice stops being one. */
const MIN_KBPS = 48;
const MAX_KBPS = 160;
/** The largest edge of cover art, in pixels. Bigger than this is not visible on any tile. */
const MAX_IMAGE_EDGE = 1600;

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes % 1048576 === 0 ? 0 : 1)} MB`;

/* ------------------------------------------------------------------- planning */

export function overLimit(bytes: number, limit: number): boolean {
  return bytes > limit;
}

export type AudioPlan =
  /** it already fits — upload the original */
  | { action: "keep" }
  /** re-encode at this bitrate */
  | { action: "encode"; kbps: number; mono: boolean }
  /** no bitrate that is still music would fit */
  | { action: "impossible" };

/**
 * What to do with a recording of `seconds` that currently weighs `bytes`.
 *
 * Pure arithmetic, so it can be reasoned about (and tested) without an encoder: pick the
 * bitrate that puts the file inside the budget, rounded down to a step encoders like, and
 * refuse the impossible rather than ruin it.
 */
export function planAudio(bytes: number, seconds: number, limit = MAX_AUDIO_BYTES): AudioPlan {
  if (!overLimit(bytes, limit)) return { action: "keep" };
  if (!Number.isFinite(seconds) || seconds <= 0) return { action: "impossible" };

  const budget = limit === MAX_AUDIO_BYTES ? AUDIO_TARGET : Math.floor(limit * 0.96);
  const raw = (budget * 8) / seconds / 1000;
  const kbps = Math.floor(raw / 8) * 8;
  if (kbps < MIN_KBPS) return { action: "impossible" };

  return { action: "encode", kbps: Math.min(kbps, MAX_KBPS), mono: kbps <= 96 };
}

/** Scale a rectangle down to fit a box, keeping its shape. Never scales up. */
export function fitWithin(width: number, height: number, box: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > box)) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = box / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/* -------------------------------------------------------------------- helpers */

function renamed(blob: Blob, original: string, extension: string): File {
  const base = (original.replace(/\.[a-z0-9]+$/i, "") || "upload").slice(0, 80);
  return new File([blob], `${base}${extension}`, { type: blob.type, lastModified: Date.now() });
}

const nextFrame = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] ?? 0;
    out[i] = Math.max(-1, Math.min(1, v)) * (v < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close?.() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ApiError("That image could not be read.", 400, "artwork"));
      el.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : null), type, quality);
  });
}

/* --------------------------------------------------------------------- image */

/**
 * Bring an image under `limit`, or explain why it cannot be.
 *
 * Walks a ladder — quality first, then resolution — because that is the order a
 * photographer would choose: squeeze the pixels you have before throwing them away.
 * Output is WebP where the browser can write it (smaller at the same quality, and it
 * keeps transparency, which the artwork bucket accepts), JPEG otherwise.
 */
export async function shrinkImage(file: File, limit = MAX_ARTWORK_BYTES): Promise<File> {
  if (!overLimit(file.size, limit)) return file;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ApiError("This browser cannot resize images, so that upload cannot be made to fit.", 503, "artwork");

  const decoded = await decodeImage(file);
  try {
    const qualities = [0.86, 0.74, 0.62, 0.5, 0.42];
    const edges = [MAX_IMAGE_EDGE, 1280, 1024, 800, 640, 480];
    let best: { blob: Blob; type: string } | null = null;

    for (const edge of edges) {
      const { width, height } = fitWithin(decoded.width, decoded.height, edge);
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(decoded.source, 0, 0, width, height);

      for (const quality of qualities) {
        const blob = await canvasBlob(canvas, "image/webp", quality);
        if (!blob) break;
        const type = blob.type === "image/webp" ? "image/webp" : "image/jpeg";
        if (!best || blob.size < best.blob.size) best = { blob, type };
        if (!overLimit(blob.size, limit)) return renamed(blob, file.name, type === "image/webp" ? ".webp" : ".jpg");
        if (edge === edges[edges.length - 1] && quality === qualities[qualities.length - 1]) break;
      }
    }

    if (!best) throw new ApiError("That image could not be re-encoded.", 400, "artwork");
    if (overLimit(best.blob.size, limit)) {
      throw new ApiError(`That image stays over ${mb(limit)} even at ${best.type === "image/webp" ? "640" : "the smallest"} pixels. Crop it, or export it smaller.`, 413, "artwork");
    }
    return renamed(best.blob, file.name, best.type === "image/webp" ? ".webp" : ".jpg");
  } finally {
    decoded.done();
  }
}

/* --------------------------------------------------------------------- audio */

/**
 * Bring an mp3 under `limit` by transcoding it, or refuse honestly.
 *
 * `onStage` is called with a rough 0‥1 so the interface can say "compressing" rather
 * than appear to have frozen; the loop hands the main thread back periodically, so a
 * one-minute recording does not lock the tab while it works.
 */
export async function shrinkAudio(
  file: File,
  limit = MAX_AUDIO_BYTES,
  onStage?: (progress: number) => void,
): Promise<File> {
  if (!overLimit(file.size, limit)) return file;

  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    throw new ApiError(`That recording is over ${mb(limit)} and this browser cannot re-encode audio. Export it smaller and upload that.`, 413, "audio");
  }

  const context = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new ApiError("That file could not be decoded as audio — it may not be an mp3 at all.", 400, "audio");
  } finally {
    void context.close?.();
  }

  const plan = planAudio(file.size, decoded.duration, limit);
  if (plan.action === "impossible") {
    const minutes = Math.round(decoded.duration / 60);
    throw new ApiError(
      `That recording is about ${minutes} ${minutes === 1 ? "minute" : "minutes"} long, which cannot fit in ${mb(limit)} at a bitrate worth hearing. Export it at a lower bitrate (or split it) and upload that.`,
      413,
      "audio",
    );
  }
  if (plan.action === "keep") return file;

  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const channels = plan.mono || decoded.numberOfChannels < 2 ? 1 : 2;
  const encoder = new Mp3Encoder(channels, decoded.sampleRate, plan.kbps);
  const left = toInt16(decoded.getChannelData(0));
  const right = channels === 2 ? toInt16(decoded.getChannelData(1)) : null;

  const parts: BlobPart[] = [];
  const FRAME = 1152;
  const total = left.length;
  for (let offset = 0; offset < total; offset += FRAME) {
    const end = Math.min(offset + FRAME, total);
    const block = encoder.encodeBuffer(left.subarray(offset, end), right ? right.subarray(offset, end) : undefined);
    if (block.length) parts.push(block.slice());
    if ((offset / FRAME) % 512 === 0) {
      onStage?.(total ? offset / total : 1);
      await nextFrame();
    }
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(tail.slice());

  const out = new Blob(parts, { type: "audio/mpeg" });
  if (overLimit(out.size, limit)) {
    throw new ApiError(`That recording is still over ${mb(limit)} after re-encoding at ${plan.kbps} kbps. Export it smaller and upload that.`, 413, "audio");
  }
  onStage?.(1);
  return renamed(out, file.name, ".mp3");
}

/** Total sizes, for the interface to compare against. */
export const ARTWORK_LIMIT = MAX_ARTWORK_BYTES;
export const AUDIO_LIMIT = MAX_AUDIO_BYTES;
