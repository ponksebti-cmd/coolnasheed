import { create } from "zustand";
import { engine } from "../lib/audio/engine";
import type { SpacePreset } from "../lib/audio/engine";
import { getTrack } from "../data/catalog";
import { songFor } from "../lib/song";
import { clamp } from "../lib/prng";
import { useLibrary } from "./library";
import { beaconComplete, beaconStart, beaconTick } from "../lib/beacon";

export type Repeat = "off" | "all" | "one";

export type PlayContext = {
  kind: "collection" | "artist" | "search" | "mix" | "queue" | "liked" | "home" | "studio";
  id?: string;
  label: string;
};

type PlayerState = {
  trackId: string | null;
  queue: string[];
  index: number;
  context: PlayContext;
  playing: boolean;
  time: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  immersive: boolean;
  ready: boolean;

  playIds: (ids: string[], startIndex?: number, context?: PlayContext) => void;
  playTrack: (id: string, context?: PlayContext, queue?: string[]) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  nudge: (delta: number) => void;
  setShuffle: (v: boolean) => void;
  cycleRepeat: () => void;
  setImmersive: (v: boolean) => void;
  setVolume: (v: number) => void;
  setDuff: (v: boolean) => void;
  setSpace: (s: SpacePreset) => void;
  setTime: (t: number) => void;
  addToQueue: (id: string) => void;
  removeFromQueue: (i: number) => void;
  reorderQueue: (from: number, to: number) => void;
};

let ticker: number | null = null;
let lastPush = 0;
/** wall-clock reading of the last frame, so the beacon only counts time actually played */
let lastFrame = 0;

function startTicker(set: (p: Partial<PlayerState>) => void) {
  if (ticker !== null) return;
  lastFrame = performance.now();
  const loop = () => {
    const now = performance.now();
    beaconTick((now - lastFrame) / 1000);
    lastFrame = now;
    if (now - lastPush > 90) {
      lastPush = now;
      set({ time: engine.getTime() });
    }
    ticker = requestAnimationFrame(loop);
  };
  ticker = requestAnimationFrame(loop);
}

function stopTicker() {
  if (ticker !== null) {
    cancelAnimationFrame(ticker);
    ticker = null;
    lastFrame = 0;
  }
}

async function loadAndPlay(id: string, set: (p: Partial<PlayerState>) => void) {
  const track = getTrack(id);
  if (!track) return;
  // whatever was playing has now been listened to as far as it goes: report it
  beaconStart(id);
  const song = songFor(track);
  set({ trackId: id, duration: song.duration, time: 0, playing: true, ready: true });
  try {
    await engine.load(song, 0);
    await engine.play();
  } catch {
    set({ playing: false });
  }
  startTicker(set);
}

export const usePlayer = create<PlayerState>((set, get) => {
  engine.handlers.onStateChange = (playing) => {
    set({ playing });
    if (!playing) stopTicker();
    else startTicker(set);
  };

  engine.handlers.onEnded = () => {
    beaconComplete();
    const { repeat } = get();
    if (repeat === "one" && get().trackId) {
      void loadAndPlay(get().trackId!, set);
      return;
    }
    get().next(true);
  };

  return {
    trackId: null,
    queue: [],
    index: -1,
    context: { kind: "home", label: "CoolNasheed" },
    playing: false,
    time: 0,
    duration: 0,
    shuffle: false,
    repeat: "off",
    immersive: false,
    ready: false,

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
        engine.pause();
        stopTicker();
        set({ playing: false, time: engine.getTime() });
      } else {
        void engine.play().then(() => {
          set({ playing: true });
          startTicker(set);
        });
      }
    },

    next: (auto = false) => {
      const { queue, index, repeat, trackId } = get();
      if (!queue.length) return;
      if (index >= queue.length - 1) {
        if (repeat === "all" || !auto) {
          const ni = 0;
          set({ index: ni });
          void loadAndPlay(queue[ni]!, set);
          useLibrary.getState().recordPlay(queue[ni]!);
          return;
        }
        if (trackId) {
          engine.pause();
          set({ playing: false, time: 0 });
          void engine.seek(0);
        }
        stopTicker();
        return;
      }
      const ni = index + 1;
      set({ index: ni });
      void loadAndPlay(queue[ni]!, set);
      useLibrary.getState().recordPlay(queue[ni]!);
    },

    prev: () => {
      const { time, queue, index } = get();
      if (time > 4 || !queue.length) {
        void engine.seek(0);
        set({ time: 0 });
        return;
      }
      const pi = index <= 0 ? queue.length - 1 : index - 1;
      set({ index: pi });
      void loadAndPlay(queue[pi]!, set);
    },

    seek: (t) => {
      void engine.seek(t);
      set({ time: clamp(t, 0, get().duration) });
    },

    nudge: (delta) => get().seek(clamp(engine.getTime() + delta, 0, get().duration)),

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
      engine.setVolume(v);
      useLibrary.getState().setSetting("volume", v);
    },

    setDuff: (v) => {
      engine.setDuff(v);
      useLibrary.getState().setSetting("duff", v);
    },

    setSpace: (s) => {
      engine.setSpace(s);
      useLibrary.getState().setSetting("space", s);
    },

    setTime: (t) => set({ time: t }),

    addToQueue: (id) => {
      const { queue, index } = get();
      if (index === -1) {
        set({ queue: [id], index: 0 });
        return;
      }
      const nextQueue = [...queue.slice(0, index + 1), id, ...queue.slice(index + 1)];
      set({ queue: nextQueue });
    },

    removeFromQueue: (i) => {
      const { queue, index } = get();
      if (i === index) return;
      const nextQueue = queue.filter((_, idx) => idx !== i);
      set({ queue: nextQueue, index: i < index ? index - 1 : index });
    },

    reorderQueue: (from, to) => {
      const { queue } = get();
      if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
      const next = queue.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      set({ queue: next });
    },
  };
});

/** Smooth time, read straight from the audio clock — for karaoke fills and progress bars. */
export function currentTime(): number {
  return engine.getTime();
}
