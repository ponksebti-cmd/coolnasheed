import { useState } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { EmptyState } from "../ui/Primitives";
import { ArtThumb, Equalizer, PlayFab } from "../track/TrackBits";
import { artistOf, durationOf, getTrack } from "../../data/catalog";
import { formatTime, formatTotal } from "../../lib/format";
import { usePlayer } from "../../store/player";
import type { Track } from "../../data/types";

export function QueuePanel({ compact }: { compact?: boolean }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const context = usePlayer((s) => s.context);
  const playIds = usePlayer((s) => s.playIds);
  const removeFromQueue = usePlayer((s) => s.removeFromQueue);
  const reorderQueue = usePlayer((s) => s.reorderQueue);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const tracks = queue.map((id) => getTrack(id)).filter((t): t is Track => !!t);
  const upNext = queue.slice(index + 1).map((id) => getTrack(id)).filter((t): t is Track => !!t);
  const current = index >= 0 ? getTrack(queue[index]) : undefined;
  const totalLeft = upNext.reduce((s, t) => s + durationOf(t), 0);

  if (!tracks.length) {
    return (
      <EmptyState
        icon="queue"
        title="The queue is empty"
        msg="Play anything and it will gather here."
        action={
          <Link to="/" className="btn btn-primary mt-1 px-4 py-2.5">
            <Icon name="home" size={14} /> Find something
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="label">Now playing from</div>
          <div className="truncate text-sm font-semibold text-text">{context.label}</div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-muted">
          <div className="tabular-nums">{upNext.length} up next</div>
          <div className="tabular-nums">{formatTotal(totalLeft)} left</div>
        </div>
      </div>

      <div className={clsx("scroll-slim min-h-0 flex-1 overflow-y-auto pr-1", compact ? "space-y-1" : "space-y-1.5")}>
        {tracks.map((track, i) => {
          const isCurrent = i === index;
          const isPast = i < index;
          return (
            <div
              key={`${track.id}-${i}`}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null && drag !== i) reorderQueue(drag, i);
                setDrag(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              className={clsx(
                "group flex items-center gap-3 rounded-xl border px-2.5 py-2 transition-all",
                isCurrent ? "border-jade/30 bg-jade/[0.08]" : "border-transparent hover:border-line hover:bg-surface2/60",
                isPast && "opacity-45",
                drag === i && "opacity-40",
                over === i && drag !== null && drag !== i && "border-gold/50",
              )}
            >
              <span className="hidden cursor-grab text-muted/50 group-hover:text-muted sm:block active:cursor-grabbing" aria-hidden>
                <Icon name="drag" size={14} />
              </span>
              <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-muted">
                {isCurrent ? <Equalizer active={playing} bars={3} className="mx-auto text-jade" /> : i + 1}
              </span>
              <ArtThumb track={track} size={38} />
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => playIds(queue, i, context)}
                aria-label={`Play ${track.title}`}
              >
                <div className={clsx("truncate text-[13px] font-semibold", isCurrent ? "text-jadesoft" : "text-text")}>{track.title}</div>
                <div className="truncate text-[11px] text-muted">{artistOf(track).name}</div>
              </button>
              <span className="hidden shrink-0 text-[11px] tabular-nums text-muted sm:block">{formatTime(durationOf(track))}</span>
              {isCurrent ? (
                <PlayFab
                  playing={playing}
                  size={30}
                  tone="glass"
                  onClick={() => usePlayer.getState().toggle()}
                  label={playing ? "Pause" : "Play"}
                />
              ) : (
                <button
                  className="btn-icon shrink-0 rounded-full p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => removeFromQueue(i)}
                  aria-label={`Remove ${track.title} from queue`}
                  disabled={isCurrent}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {current ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface2/40 px-3 py-2 text-[11.5px] text-muted">
          <Icon name="info" size={13} className="shrink-0 text-gold" />
          <span className="min-w-0 truncate">
            Drag to reorder. Removing the playing track is not allowed — finish it, it is only {formatTime(durationOf(current))} long.
          </span>
        </div>
      ) : null}
    </div>
  );
}
