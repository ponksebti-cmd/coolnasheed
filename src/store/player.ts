/**
 * The player store.
 *
 * State for the bar, the queue and the immersive view, and the only place that talks
 * to the audio element. What it plays is an mp3 the server knows about: `audioPath` is
 * turned into a CDN URL here, and the duration comes from the file itself rather than
 * from anywhere we might have guessed it.
 *
 * If the catalogue has no nasheeds, nothing plays — there is no generated audio behind
 * this and never will be.
 */

import { create } from "zustand";
import { player } from "../lib/audio/player";
import { audioUrlOf, artworkUrlOf, artistOf, getTrack } from "../data/catalog";
import { clamp } from "../lib/math";
import { useLibrary } from "./library";
import { beaconComplete, beaconStart, beaconTick } from "../lib/beacon";
import type { Song } from "../data/types";

export type Repeat = "off" | "all" | "one";

export type PlayContext = {
  kind: "collection" | "artist" | "search" | "queue" | "liked" | "home" | "studio" | "profile";
  id?: string;
  label: string;
};

export const DEFAULT_CONTEXT: PlayContext = { kind: "home", label: "CoolNasheed" };

type PlayerState = {
  trackId: string | null;
  queue: string[];
  index: number;
  context: PlayContext;
  playing: boolean;
  buffering: boolean;
  time: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  immersive: boolean;
  ready: boolean;
  error: string | null;

  playIds: (ids: string[], startIndex?: number, context?: PlayContext) => void;
  playTrack: (id: string, context?: PlayContext, queue?: string[]) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  nudge: (delta: number) => void;
  jumpTo: (index: number) => void;
  setShuffle: (v: boolean) => void;
  cycleRepeat: () => void;
  setImmersive: (v: boolean) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setMuted: (v: boolean) => void;
  setTime: (t: number) => void;
  addToQueue: (id: string) => void;
  playNext: (id: string) => void;
  removeFromQueue: (i: number) => void;
  reorderQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  dismissError: () => void;
};

let ticker: number | null = null;
let lastPush = 0;
let lastFrame = 0;

type Setter = (patch: Partial<PlayerState>) => void;

function startTicker(set: Setter): void {
  if (ticker !== null) return;
  lastFrame = performance.now();
  const loop = () => {
    const now = performance.now();
    // only time actually spent playing counts towards a listen
    beaconTick(player.isPlaying ? (now - lastFrame) / 1000 : 0);
    lastFrame = now;
    if (now - lastPush > 90) {
      lastPush = now;
      set({ time: player.getTime(), duration: player.getDuration() || undefined });
    }
    ticker = requestAnimationFrame(loop);
  };
  ticker = requestAnimationFrame(loop);
}

function stopTicker(): void {
  if (ticker === null) return;
  cancelAnimationFrame(ticker);
  ticker = null;
  lastFrame = 0;
}

/** Everything the audio element tells us lands back in the store. */
function bindHandlers(set: Setter, get: () => PlayerState): void {
  // `get` is read inside the ended handler, which needs the queue as it is right now
  player.handlers = {
    onTime: (seconds) => set({ time: seconds }),
    onDuration: (seconds) => set({ duration: seconds }),
    onPlayingChange: (playing) => {
      set({ playing });
      if (playing) startTicker(set);
      else stopTicker();
    },
    onWaiting: (waiting) => set({ buffering: waiting }),
    onError: (message) => set({ error: message, playing: false, buffering: false }),
    onEnded: () => {
      beaconComplete();
      const { repeat } = get();
      if (repeat === "one" && get().trackId) {
        void loadAndPlay(get().trackId!, set, { restart: true });
        return;
      }
      get().next(true);
    },
  };
}

/** Where the recording lives, or a message explaining that it does not. */
function sourceFor(id: string): { url: string; song: Song } | { error: string } {
  const song = getTrack(id);
  if (!song) return { error: "That nasheed is not in the catalogue." };
  const url = audioUrlOf(song);
  if (!url) return { error: "That nasheed has no recording behind it." };
  return { url, song };
}

async function loadAndPlay(id: string, set: Setter, options: { restart?: boolean } = {}): Promise<void> {
  const source = sourceFor(id);
  if ("error" in source) {
    set({ error: source.error, playing: false, trackId: id, duration: 0, time: 0 });
    return;
  }

  const { url, song } = source;
  const title = song.title;
  player.setMetadata({ title, artist: artistOf(song).name, artwork: artworkUrlOf(song) });
  beaconStart(id);
  set({
    trackId: id,
    duration: song.durationMs ? song.durationMs / 1000 : 0,
    time: options.restart ? 0 : 0,
    playing: true,
    buffering: true,
    error: null,
    ready: true,
  });

  try {
    await player.load(url, { startAt: 0, autoplay: true });
    if (song.durationMs && song.durationMs > 0) set({ duration: song.durationMs / 1000 });
    else if (player.getDuration()) set({ duration: player.getDuration() });
    startTicker(set);
  } catch {
    set({ playing: false, buffering: false, error: "That recording would not play." });
  }
}

export const usePlayer = create<PlayerState>((set, get) => {
  bindHandlers(set, get);

  return {
    trackId: null,
    queue: [],
    index: -1,
    context: DEFAULT_CONTEXT,
    playing: false,
    buffering: false,
    time: 0,
    duration: 0,
    shuffle: false,
    repeat: "off",
    immersive: false,
    ready: false,
    error: null,

    playIds: (ids, startIndex = 0, context) => {
      const clean = ids.filter(Boolean);
      if (!clean.length) return;
      const { shuffle } = get();
      let queue = clean;
      let index = clamp(startIndex, 0, clean.length - 1);
      if (shuffle) {
        const first = clean[index]!;
        const rest = clean.filter((_, i) => i !== index).sort(() => Math.random() - 0.5);
        queue = [first, ...rest];
        index = 0;
      }
      set({ queue, index, context: context ?? get().context });
      void loadAndPlay(queue[index]!, set);
      useLibrary.getState().recordPlay(queue[index]!);
    },

    playTrack: (id, context, queue) => {
      const list = queue && queue.length ? queue : get().queue.includes(id) ? get().queue : [id];
      const index = Math.max(0, list.indexOf(id));
      set({ queue: list, index, context: context ?? get().context });
      void loadAndPlay(id, set);
      useLibrary.getState().recordPlay(id);
    },

    toggle: () => {
      const { trackId, playing, queue, index } = get();
      if (!trackId) {
        if (queue.length) get().playIds(queue, Math.max(0, index));
        return;
      }
      if (playing) {
        player.pause();
        set({ playing: false });
        return;
      }
      void player.play().then(() => {
        if (player.isPlaying) {
          set({ playing: true });
          startTicker(set);
        }
      });
    },

    next: (auto = false) => {
      const { queue, index, repeat, trackId } = get();
      if (!queue.length) return;
      if (index >= queue.length - 1) {
        if (repeat === "all" || !auto) {
          set({ index: 0 });
          void loadAndPlay(queue[0]!, set);
          useLibrary.getState().recordPlay(queue[0]!);
          return;
        }
        if (trackId) {
          player.pause();
          player.seek(0);
          set({ playing: false, time: 0 });
        }
        stopTicker();
        return;
      }
      const nextIndex = index + 1;
      set({ index: nextIndex });
      void loadAndPlay(queue[nextIndex]!, set);
      useLibrary.getState().recordPlay(queue[nextIndex]!);
    },

    prev: () => {
      const { time, queue, index } = get();
      if (time > 4 || !queue.length) {
        player.seek(0);
        set({ time: 0 });
        return;
      }
      const previous = index <= 0 ? queue.length - 1 : index - 1;
      set({ index: previous });
      void loadAndPlay(queue[previous]!, set);
      useLibrary.getState().recordPlay(queue[previous]!);
    },

    seek: (t) => {
      const limit = get().duration;
      const target = limit > 0 ? clamp(t, 0, limit) : Math.max(0, t);
      player.seek(target);
      set({ time: target });
    },

    nudge: (delta) => get().seek(player.getTime() + delta),

    jumpTo: (index) => {
      const { queue } = get();
      if (index < 0 || index >= queue.length) return;
      set({ index });
      void loadAndPlay(queue[index]!, set);
      useLibrary.getState().recordPlay(queue[index]!);
    },

    setShuffle: (v) => {
      const { queue, trackId } = get();
      if (!v || !trackId) {
        set({ shuffle: v });
        return;
      }
      const rest = queue.filter((id) => id !== trackId).sort(() => Math.random() - 0.5);
      set({ shuffle: v, queue: [trackId, ...rest], index: 0 });
    },

    cycleRepeat: () => {
      const order: Repeat[] = ["off", "all", "one"];
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length]! });
    },

    setImmersive: (v) => set({ immersive: v }),

    setVolume: (v) => {
      const volume = clamp(v, 0, 1);
      player.setVolume(volume);
      set({ error: null });
      void useLibrary.getState().setSetting("volume", volume);
    },

    toggleMute: () => {
      const muted = !player.isMuted;
      player.setMuted(muted);
      set({});
      void useLibrary.getState().setSetting("muted", muted);
    },

    setMuted: (v) => {
      player.setMuted(v);
      void useLibrary.getState().setSetting("muted", v);
    },

    setTime: (t) => set({ time: t }),

    addToQueue: (id) => {
      const { queue, index } = get();
      if (index === -1) {
        set({ queue: [id], index: 0 });
        return;
      }
      set({ queue: [...queue.slice(0, index + 1), id, ...queue.slice(index + 1)] });
    },

    playNext: (id) => {
      const { queue, index } = get();
      if (index === -1) {
        set({ queue: [id], index: 0 });
        return;
      }
      const rest = queue.filter((entry, i) => entry !== id || i === index);
      set({ queue: [...rest.slice(0, index + 1), id, ...rest.slice(index + 1)] });
    },

    removeFromQueue: (i) => {
      const { queue, index } = get();
      if (i === index) return;
      set({ queue: queue.filter((_, idx) => idx !== i), index: i < index ? index - 1 : index });
    },

    reorderQueue: (from, to) => {
      const { queue } = get();
      if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
      const next = queue.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      set({ queue: next });
    },

    clearQueue: () => {
      player.stop();
      stopTicker();
      set({ queue: [], index: -1, trackId: null, playing: false, time: 0, duration: 0 });
    },

    dismissError: () => set({ error: null }),
  };
});

/** Smooth time, read straight from the audio element — for lyric fills and progress bars. */
export function currentTime(): number {
  return player.getTime();
}

export function isPlaying(): boolean {
  return usePlayer.getState().playing;
}
