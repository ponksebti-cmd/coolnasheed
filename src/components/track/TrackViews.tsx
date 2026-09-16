import { clsx } from "clsx";
import { Link } from "react-router-dom";
import { Icon } from "../ui/Icons";
import { CoverArt } from "../art/CoverArt";
import { Reveal } from "../ui/Primitives";
import { Equalizer, LikeButton, PlayCount, PlayFab, TrackMenu, ArtThumb } from "./TrackBits";
import { artistOf, durationOf, formatCount, statsFor } from "../../data/catalog";
import { formatTime } from "../../lib/format";
import { usePlayer } from "../../store/player";
import type { Track } from "../../data/types";
import type { PlayContext } from "../../store/player";

/* ------------------------------------------------------------------- row */

export function TrackRow({
  track,
  index,
  queue,
  context,
  showArt = true,
  showStats = true,
  onRemove,
  draggable,
  onDragStart,
}: {
  track: Track;
  index: number;
  queue?: string[];
  context?: PlayContext;
  showArt?: boolean;
  showStats?: boolean;
  onRemove?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const { trackId, playing, toggle, playIds } = usePlayer();
  const isCurrent = trackId === track.id;
  const artist = artistOf(track);
  const list = queue ?? [track.id];

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDoubleClick={() => playIds(list, Math.max(0, list.indexOf(track.id)), context)}
      className={clsx(
        "group relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors sm:grid-cols-[24px_auto_minmax(0,1fr)_auto] lg:grid-cols-[24px_auto_minmax(0,3fr)_minmax(0,1.2fr)_auto_auto]",
        isCurrent ? "bg-jade/[0.07] border-jade/20" : "hover:border-line hover:bg-surface2/60",
      )}
    >
      {/* index / play */}
      <div className="relative hidden w-6 justify-center sm:flex">
        <span
          className={clsx(
            "text-[13px] tabular-nums transition-opacity",
            isCurrent ? "text-jade" : "text-muted group-hover:opacity-0",
          )}
        >
          {index + 1}
        </span>
        <button
          className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100"
          aria-label={isCurrent && playing ? `Pause ${track.title}` : `Play ${track.title}`}
          onClick={() => (isCurrent ? toggle() : playIds(list, Math.max(0, list.indexOf(track.id)), context))}
        >
          {isCurrent && playing ? (
            <Equalizer className="text-jade" />
          ) : (
            <Icon name={isCurrent ? "pause" : "play"} size={15} className="text-text" strokeWidth={2} />
          )}
        </button>
      </div>

      {/* artwork */}
      {showArt ? (
        <Link to={`/t/${track.id}`} className="hidden sm:block" tabIndex={-1} aria-hidden>
          <div className="relative">
            <ArtThumb track={track} size={42} />
            <button
              className="over-art absolute inset-0 grid place-items-center rounded-lg bg-[rgba(4,12,9,0.62)] opacity-0 transition-opacity group-hover:opacity-100 sm:hidden lg:grid"
              aria-label={`Play ${track.title}`}
              onClick={() => (isCurrent ? toggle() : playIds(list, Math.max(0, list.indexOf(track.id)), context))}
            >
              <Icon name={isCurrent && playing ? "pause" : "play"} size={15} className="text-text" strokeWidth={2.2} />
            </button>
          </div>
        </Link>
      ) : null}

      {/* title */}
      <div className="min-w-0">
        <Link
          to={`/t/${track.id}`}
          className={clsx(
            "block truncate text-[14px] font-semibold leading-tight transition-colors",
            isCurrent ? "text-jadesoft" : "text-text hover:text-jadesoft",
          )}
        >
          {track.title}
          {track.titleAr ? <span className="arabic ml-2 hidden text-[12px] font-normal text-muted md:inline">{track.titleAr}</span> : null}
        </Link>
        <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted">
          <Link to={`/a/${artist.id}`} className="truncate hover:text-text2 hover:underline underline-offset-2">
            {artist.name}
          </Link>
          {isCurrent && playing ? <Equalizer className="ml-1 text-jade" bars={3} /> : null}
        </div>
      </div>

      {/* mode / tags */}
      <div className="hidden min-w-0 items-center gap-2 lg:flex">
        <span className="truncate text-[11.5px] text-muted">
          {track.tags.slice(0, 3).join(" · ")}
        </span>
      </div>

      {/* plays */}
      {showStats ? (
        <div className="hidden w-20 justify-end lg:flex">
          <PlayCount track={track} />
        </div>
      ) : null}

      {/* actions */}
      <div className="flex items-center justify-end gap-0.5">
        <span className="mr-1 text-[11.5px] tabular-nums text-muted">{formatTime(durationOf(track))}</span>
        <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <LikeButton trackId={track.id} size={15} className="!p-1.5" />
        </div>
        {onRemove ? (
          <button className="btn-icon grid place-items-center rounded-full p-1.5 text-muted" onClick={onRemove} aria-label="Remove">
            <Icon name="close" size={15} />
          </button>
        ) : (
          <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <TrackMenu track={track} />
          </div>
        )}
      </div>

      {/* mobile play */}
      <button
        className="absolute right-14 top-1/2 -translate-y-1/2 text-text sm:hidden"
        onClick={() => (isCurrent ? toggle() : playIds(list, Math.max(0, list.indexOf(track.id)), context))}
        aria-label={`Play ${track.title}`}
      >
        <Icon name={isCurrent && playing ? "pause" : "play"} size={18} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ list */

export function TrackList({
  tracks,
  context,
  showHeader = true,
  headerOffset = 0,
  compact,
  onRemoveAt,
}: {
  tracks: Track[];
  context?: PlayContext;
  showHeader?: boolean;
  headerOffset?: number;
  compact?: boolean;
  onRemoveAt?: (i: number) => void;
}) {
  const ids = tracks.map((t) => t.id);
  return (
    <div className="w-full">
      {showHeader ? (
        <div className="mb-1.5 hidden grid-cols-[24px_auto_minmax(0,3fr)_minmax(0,1.2fr)_auto_auto] items-center gap-3 border-b border-line px-2 pb-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted sm:grid">
          <span className="text-center">#</span>
          <span className="w-[42px]" />
          <span>Title</span>
          <span className="hidden lg:block">Year</span>
          <span className="hidden w-20 justify-end lg:flex">Plays</span>
          <span className="w-[92px] text-right">Time</span>
        </div>
      ) : null}
      <div className={clsx("flex flex-col", compact ? "gap-0" : "gap-0.5")}>
        {tracks.map((track, i) => (
          <TrackRow
            key={`${track.id}-${i}`}
            track={track}
            index={i + headerOffset}
            queue={ids}
            context={context}
            onRemove={onRemoveAt ? () => onRemoveAt(i) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ card */

export function TrackCard({
  track,
  queue,
  context,
  index = 0,
  variant = "square",
}: {
  track: Track;
  queue?: string[];
  context?: PlayContext;
  index?: number;
  variant?: "square" | "wide";
}) {
  const { trackId, playing, toggle, playIds } = usePlayer();
  const isCurrent = trackId === track.id;
  const list = queue ?? [track.id];
  const stats = statsFor(track);
  const artist = artistOf(track);

  return (
    <Reveal delay={index * 26}>
      <article
        className={clsx("card group relative overflow-hidden", variant === "wide" && "sm:col-span-2")}
      >
        <Link to={`/t/${track.id}`} className="block">
          <div className={clsx("over-art relative overflow-hidden", variant === "wide" ? "aspect-[16/9]" : "aspect-square")}>
            <div className="absolute inset-0 transition-transform duration-[900ms] ease-out group-hover:scale-[1.06]">
              <CoverArt path={track.artworkPath} title={track.title} className="h-full w-full" rounded="sm" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(3,10,8,0.86)] via-[rgba(3,10,8,0.12)] to-transparent" />
            <div className="absolute left-3 top-3 flex items-center gap-2">
              {isCurrent ? (
                <span className="flex items-center gap-1.5 rounded-full bg-[rgba(3,10,8,0.7)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-jade backdrop-blur-md">
                  <Equalizer active={playing} bars={3} /> {playing ? "playing" : "paused"}
                </span>
              ) : null}
              {track.lines.some((l) => l.note?.startsWith("Qurʾān")) ? (
                <span className="rounded-full bg-[rgba(3,10,8,0.7)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-goldsoft backdrop-blur-md">
                  āyah
                </span>
              ) : null}
            </div>
            <span className="absolute bottom-3 left-3 rounded-md bg-[rgba(3,10,8,0.66)] px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-text2 backdrop-blur-md">
              {formatTime(durationOf(track))}
            </span>
          </div>
        </Link>

        <div className="p-3.5">
          <Link to={`/t/${track.id}`}>
            <h3 className="truncate text-[15px] font-semibold text-text transition-colors group-hover:text-jadesoft">
              {track.title}
            </h3>
          </Link>
          <div className="mt-1 flex items-center justify-between gap-2">
            <Link to={`/a/${artist.id}`} className="truncate text-xs text-muted hover:text-text2">
              {artist.name}
            </Link>
            <span className="flex shrink-0 items-center gap-2 text-[10.5px] tabular-nums text-muted">
              <span className="flex items-center gap-1">
                <Icon name="waveform" size={11} />
                {formatCount(stats.plays)}
              </span>
              <span className="flex items-center gap-1">
                <Icon name="star" size={11} />
                {formatCount(stats.likes)}
              </span>
            </span>
          </div>
        </div>

        <div className="absolute bottom-[76px] right-3.5 translate-y-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <PlayFab
            playing={isCurrent && playing}
            size={42}
            onClick={(e) => {
              e.preventDefault();
              if (isCurrent) toggle();
              else playIds(list, Math.max(0, list.indexOf(track.id)), context);
            }}
          />
        </div>
        <div className="absolute right-2.5 top-2.5 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="block rounded-full bg-[rgba(3,10,8,0.6)] backdrop-blur-md">
            <LikeButton trackId={track.id} size={15} className="!p-2 !text-goldsoft" />
          </span>
        </div>
      </article>
    </Reveal>
  );
}

export function TrackCardGrid({
  tracks,
  context,
  className,
  variant,
}: {
  tracks: Track[];
  context?: PlayContext;
  className?: string;
  variant?: "square" | "wide";
}) {
  const ids = tracks.map((t) => t.id);
  return (
    <div className={clsx("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", className)}>
      {tracks.map((t, i) => (
        <TrackCard key={t.id} track={t} index={i} queue={ids} context={context} variant={variant} />
      ))}
    </div>
  );
}
