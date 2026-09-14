/**
 * The play beacon.
 *
 * One listen, counted honestly. The player calls `start` when a nasheed begins,
 * `tick` from the animation frame loop that is already running (so only time actually
 * spent playing is counted — a pause stops the ticker, a seek does not add seconds),
 * `complete` when the recording ends, and `flush` when the track changes, the tab is
 * hidden or the page is being unloaded.
 *
 * A flush is one `record_play` RPC: no Edge Function invocation, one transaction in
 * Postgres that writes the event, rolls the day up per nasheed and per site, and moves
 * the play counter only when the listen was real (fifteen seconds, or a completion).
 * A three-second skip is dropped here rather than sent, because a skip is not a listen
 * and should not flatter a track.
 *
 * Failures are swallowed on purpose. Analytics that can break the player are worse
 * than analytics that occasionally miss.
 */

import { api } from "./api";
import { hasSupabase } from "./supabase";

/** Long sessions report in chunks so an hour of one nasheed is not lost on a crash. */
const CHUNK_SECONDS = 300;
/** Under this, it was a skip. */
const MIN_SECONDS = 3;

type Pending = { songId: string; seconds: number; completed: boolean };

let current: Pending | null = null;
let inFlight = 0;

async function send(pending: Pending): Promise<void> {
  if (!hasSupabase) return;
  if (pending.seconds < MIN_SECONDS && !pending.completed) return;
  inFlight += 1;
  try {
    await api.play({
      songId: pending.songId,
      seconds: Math.min(Math.round(pending.seconds), 21600),
      completed: pending.completed,
    });
  } catch {
    // a missed beacon is not worth interrupting anybody for
  } finally {
    inFlight -= 1;
  }
}

/** A nasheed started. Anything still unreported from the last one goes now. */
export function beaconStart(songId: string): void {
  if (current && current.songId !== songId) beaconFlush();
  current = { songId, seconds: 0, completed: false };
}

/** Add wall-clock seconds of actual playback. */
export function beaconTick(deltaSeconds: number): void {
  if (!current || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
  // a tab that was backgrounded can hand back a huge delta; ignore anything silly
  if (deltaSeconds > 5) return;
  current.seconds += deltaSeconds;
  if (current.seconds >= CHUNK_SECONDS) beaconFlush(true);
}

/** The recording finished: this listen definitely counts. */
export function beaconComplete(): void {
  if (!current) return;
  current.completed = true;
  beaconFlush();
}

/**
 * Send what has accumulated. `keepListening` continues the same listen afterwards,
 * which is what the periodic chunk does.
 */
export function beaconFlush(keepListening = false): void {
  const pending = current;
  if (!pending) return;
  current = keepListening ? { songId: pending.songId, seconds: 0, completed: false } : null;
  void send(pending);
}

/** Nothing is waiting to be sent. */
export function beaconIdle(): boolean {
  return current === null && inFlight === 0;
}

let bound = false;

/** Report on the way out: hidden tab, closed tab, phone screen locked. */
export function bindBeacon(): void {
  if (bound || typeof window === "undefined") return;
  bound = true;

  const onHide = () => {
    if (document.visibilityState === "hidden") beaconFlush();
  };
  window.addEventListener("pagehide", () => beaconFlush(), { once: false });
  document.addEventListener("visibilitychange", onHide);
}
