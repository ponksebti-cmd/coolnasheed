/**
 * Transport controls and the seek row.
 *
 * Everything here reads the recording's own clock: the duration comes from the file,
 * the position comes from the audio element, and seeking moves the element. There is
 * no second clock to drift away from the first one.
 */

import { clsx } from "clsx";
import { useState } from "react";
import { Icon } from "../ui/Icons";
import { SeekBar } from "../ui/Primitives";
import { durationOf, getTrack } from "../../data/catalog";
import { formatTime } from "../../lib/format";
import { usePlayer } from "../../store/player";
import { useLibrary } from "../../store/library";
import { useSmoothTime } from "../../lib/hooks";

export function TransportButtons({ size = 40 }: { size?: number }) {
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const setShuffle = usePlayer((s) => s.setShuffle);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);
  const has = usePlayer((s) => !!s.trackId);

  return (
    <div className="flex items-center gap-1">
      <button
        className={clsx("btn-icon grid place-items-center rounded-full p-2", shuffle && "text-jade")}
        onClick={() => setShuffle(!shuffle)}
        aria-label="Shuffle"
        aria-pressed={shuffle}
      >
        <Icon name="shuffle" size={size * 0.4} />
      </button>
      <button className="btn-icon grid place-items-center rounded-full p-2" onClick={() => prev()} aria-label="Previous" disabled={!has}>
        <Icon name="prev" size={size * 0.46} />
      </button>
      <button
        onClick={() => toggle()}
        aria-label={playing ? "Pause" : "Play"}
        className="btn btn-primary grid place-items-center rounded-full transition-transform hover:scale-105 active:scale-95"
        style={{ width: size * 1.12, height: size * 1.12 }}
      >
        <Icon name={playing ? "pause" : "play"} size={size * 0.44} strokeWidth={2.4} />
      </button>
      <button className="btn-icon grid place-items-center rounded-full p-2" onClick={() => next()} aria-label="Next" disabled={!has}>
        <Icon name="next" size={size * 0.46} />
      </button>
      <button
        className={clsx("btn-icon relative grid place-items-center rounded-full p-2", repeat !== "off" && "text-jade")}
        onClick={cycleRepeat}
        aria-label={`Repeat: ${repeat}`}
      >
        <Icon name={repeat === "one" ? "repeatOne" : "repeat"} size={size * 0.4} />
      </button>
    </div>
  );
}

export function TimeRow({ className }: { className?: string }) {
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const storeTime = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const error = usePlayer((s) => s.error);
  const seek = usePlayer((s) => s.seek);
  const t = useSmoothTime(playing) || storeTime;
  const track = getTrack(trackId);
  const total = duration || (track ? durationOf(track) : 0);

  return (
    <div className={clsx("flex w-full flex-col gap-1", className)}>
      <div className="flex w-full items-center gap-3">
        <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted">{formatTime(t)}</span>
        <SeekBar value={t} max={total} onChange={seek} className="flex-1" label="Seek within the nasheed" />
        <span className="w-10 shrink-0 text-[11px] font-semibold tabular-nums text-muted">{formatTime(total)}</span>
      </div>
      {error ? <div className="text-center text-[11px] text-madder">{error}</div> : null}
    </div>
  );
}

export function VolumeControl({ className }: { className?: string }) {
  const settings = useLibrary((s) => s.settings);
  const setVolume = usePlayer((s) => s.setVolume);
  const setMuted = usePlayer((s) => s.setMuted);
  const [lastNonZero, setLastNonZero] = useState(0.85);
  const muted = settings.muted;
  const v = muted ? 0 : settings.volume;

  const icon = v === 0 ? "volumeMute" : v < 0.45 ? "volumeLow" : "volume";

  return (
    <div className={clsx("group flex items-center gap-2", className)}>
      <button
        className="btn-icon grid place-items-center rounded-full p-1.5"
        aria-label={v === 0 ? "Unmute" : "Mute"}
        onClick={() => {
          if (v === 0) {
            setMuted(false);
            setVolume(lastNonZero || 0.85);
          } else {
            setLastNonZero(v);
            setMuted(true);
          }
        }}
      >
        <Icon name={icon} size={16} />
      </button>
      <div className="relative h-4 w-20">
        <div className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-text/12" />
        <div
          className="absolute left-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-gradient-to-r from-jadedeep to-jade transition-[width] duration-100"
          style={{ width: `${v * 100}%` }}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={v}
          onChange={(e) => {
            if (muted) setMuted(false);
            setVolume(Number(e.target.value));
          }}
          aria-label="Volume"
          className="absolute inset-0 h-full w-full opacity-0"
        />
        <span
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text opacity-0 shadow transition-opacity group-hover:opacity-100"
          style={{ left: `${v * 100}%` }}
        />
      </div>
    </div>
  );
}
