/**
 * The immersive view: the whole screen for one recording.
 *
 * Cover art, the words, the queue and the credits. Everything on it comes from the
 * row and from the file — the length is the file's, the position is the audio
 * element's, the plays and loves are the counters the database keeps.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { CoverArt } from "../art/CoverArt";
import { TimeRow, TransportButtons, VolumeControl } from "./Transport";
import { QueuePanel } from "./QueuePanel";
import { Lyrics } from "./Lyrics";
import { LyricStage } from "./LyricStage";
import { Equalizer, LikeButton, TrackMenu } from "../track/TrackBits";
import {
  artistOf,
  collectionsOf,
  durationOf,
  formatCount,
  getTrack,
  statsFor,
} from "../../data/catalog";
import { formatTime, relativeTime } from "../../lib/format";
import { useBodyScrollLock, useKeyboard } from "../../lib/hooks";
import { usePlayer } from "../../store/player";

type Tab = "lyrics" | "queue" | "details";

export function ImmersivePlayer() {
  const open = usePlayer((s) => s.immersive);
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const duration = usePlayer((s) => s.duration);
  const context = usePlayer((s) => s.context);
  const error = usePlayer((s) => s.error);
  const dismissError = usePlayer((s) => s.dismissError);
  const setImmersive = usePlayer((s) => s.setImmersive);
  const [tab, setTab] = useState<Tab>("lyrics");
  /* the words over the cover: the stage takes the sheet's place rather than sitting in it */
  const [stage, setStage] = useState(false);

  useBodyScrollLock(open);
  useKeyboard(
    {
      /* one step at a time: from the stage, Escape gives the player back */
      escape: () => (stage ? setStage(false) : setImmersive(false)),
      l: () => setTab("lyrics"),
      q: () => setTab("queue"),
    },
    open,
  );

  const track = getTrack(trackId);

  useEffect(() => {
    if (open) setTab("lyrics");
  }, [open, trackId]);

  /* a new recording starts with the sheet, not with the stage */
  useEffect(() => {
    setStage(false);
  }, [trackId]);

  if (!open || !track) return null;

  const artist = artistOf(track);
  const stats = statsFor(track);
  const sets = collectionsOf(track);
  const total = duration || durationOf(track);

  return createPortal(
    /* The full-screen player is a stage, not a page: the backdrop is the cover blown up
       and blurred, and the whole thing stays dark in both themes so the chrome over it
       is legible. `over-art` pins every token inside to the night book. */
    <div
      className="sheet-in over-art fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#07110e]"
      role="dialog"
      aria-modal="true"
      aria-label="Immersive player"
    >
      {/* the cover, enlarged and blurred, is the backdrop */}
      <div
        className="absolute inset-0 scale-[1.5] opacity-[0.45] blur-[52px]"
        aria-hidden
      >
        {track.artworkPath ? (
          <CoverArt
            path={track.artworkPath}
            title={track.title}
            className="h-full w-full"
            rounded="sm"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{
              background: `radial-gradient(90% 90% at 30% 20%, color-mix(in oklab, var(--c-jade) 55%, transparent), transparent 70%)`,
            }}
          />
        )}
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(4,10,8,0.86)] via-[rgba(4,10,8,0.9)] to-[rgba(6,14,11,1)]" />
      <div className="grain absolute inset-0" />

      {stage ? <LyricStage song={track} onClose={() => setStage(false)} /> : null}

      {/* header */}
      <header className="relative z-10 flex items-center justify-between gap-4 px-4 py-3 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => setImmersive(false)}
            className="btn-icon grid h-9 w-9 place-items-center rounded-full border border-line2 text-text2 hover:text-text"
            aria-label="Close immersive player"
          >
            <Icon name="chevronDown" size={18} />
          </button>
          <div className="min-w-0">
            <div className="label flex items-center gap-2">
              {playing ? (
                <Equalizer bars={3} className="text-jade" />
              ) : (
                <Icon name="waveform" size={11} />
              )}
              now playing · {context.label}
            </div>
            <div className="truncate text-[13px] font-semibold text-text">
              {track.title}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {track.lines.length ? (
            <button
              onClick={() => setStage(true)}
              className="btn-icon flex items-center gap-1.5 rounded-full border border-line2 px-2.5 py-1.5 text-[11px] text-text2 hover:text-text"
              aria-label="Show the lyrics over the cover"
              title="Words over the cover"
            >
              <Icon name="expand" size={14} />
              <span className="hidden sm:inline">Over the cover</span>
            </button>
          ) : null}
          <div className="hidden sm:block">
            <VolumeControl />
          </div>
          <LikeButton trackId={track.id} size={16} />
          <TrackMenu track={track} />
        </div>
      </header>

      {/* body */}
      <div className="relative z-10 grid min-h-0 flex-1 gap-6 overflow-y-auto px-4 pb-4 sm:overflow-hidden sm:px-7 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-10">
        {/* left: artwork + transport */}
        <div className="scroll-slim flex min-h-0 flex-col items-center justify-center gap-5 sm:overflow-y-auto lg:pr-2">
          <div className="relative w-full max-w-[min(78vw,430px)]">
            {/* tapping the cover is the other way into the stage, which is how people
                already expect a now-playing cover to behave */}
            <button
              onClick={() => (track.lines.length ? setStage(true) : undefined)}
              className={clsx(
                "over-art shadow-art group relative block aspect-square w-full overflow-hidden rounded-2xl border border-line2 text-left",
                track.lines.length ? "cursor-pointer" : "cursor-default",
              )}
              aria-label={track.lines.length ? "Show the lyrics over the cover" : track.title}
            >
              <span className="pointer-events-none absolute inset-0 z-10 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <span className="flex items-center gap-1.5 rounded-full bg-[rgba(3,9,7,0.7)] px-3 py-1.5 text-[11px] font-semibold text-text backdrop-blur-md">
                  <Icon name="expand" size={13} /> words over the cover
                </span>
              </span>
              <CoverArt
                path={track.artworkPath}
                title={track.title}
                className="h-full w-full"
                rounded="md"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-[rgba(3,9,7,0.92)] to-transparent p-4">
                <div className="min-w-0">
                  <div className="label mb-1">{track.status === "live" ? "recording" : "taken down"}</div>
                  <div className="truncate font-display text-lg text-text">
                    {track.title}
                  </div>
                </div>
                {track.titleAr ? (
                  <div
                    className="arabic shrink-0 text-[15px] text-goldsoft/80"
                    dir="rtl"
                  >
                    {track.titleAr}
                  </div>
                ) : null}
              </div>
            </button>
          </div>

          <div className="w-full max-w-[min(78vw,430px)] space-y-3">
            <div className="flex items-center justify-center gap-4">
              <TransportButtons size={42} />
            </div>
            <TimeRow />
            {error ? (
              <button
                onClick={dismissError}
                className="mx-auto flex items-center gap-2 text-[12px] text-madder"
              >
                <Icon name="info" size={13} /> {error} — dismiss
              </button>
            ) : null}
            <div className="flex items-center justify-between gap-3 pt-1">
              <Link
                to={`/a/${artist.id}`}
                className="group flex min-w-0 items-center gap-2.5"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line2 bg-surface2/60 text-[11px] font-semibold text-text2">
                  {artist.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-text group-hover:text-jadesoft">
                    {artist.name}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {artist.role}
                  </span>
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted">
                {stats.plays ? (
                  <span className="flex items-center gap-1 tabular-nums">
                    <Icon name="waveform" size={11} />{" "}
                    {formatCount(stats.plays)}
                  </span>
                ) : null}
                <span className="flex items-center gap-1 tabular-nums">
                  <Icon name="star" size={11} /> {formatCount(stats.likes)}
                </span>
                <span className="flex items-center gap-1 tabular-nums">
                  <Icon name="clock" size={11} /> {formatTime(total)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* right: tabs */}
        <div className="flex min-h-0 flex-col lg:pl-2">
          <div className="mb-4 flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface2/50 p-0.5">
            {(
              [
                { id: "lyrics", label: "Lyrics", icon: "lyrics" },
                { id: "queue", label: "Queue", icon: "queue" },
                { id: "details", label: "Details", icon: "info" },
              ] as const
            ).map((entry) => (
              <button
                key={entry.id}
                onClick={() => setTab(entry.id)}
                className={clsx(
                  "btn flex-1 gap-1.5 !py-2 !text-[12px]",
                  tab === entry.id
                    ? "bg-jade/15 text-jadesoft"
                    : "text-muted hover:text-text2",
                )}
                aria-pressed={tab === entry.id}
              >
                <Icon name={entry.icon} size={14} />
                {entry.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1">
            {tab === "lyrics" ? (
              <Lyrics song={track} variant="immersive" />
            ) : tab === "queue" ? (
              <QueuePanel compact />
            ) : (
              <div className="scroll-slim h-full space-y-4 overflow-y-auto pr-1">
                {track.note ? (
                  <div className="rounded-xl border border-line bg-surface2/40 p-3.5">
                    <div className="label mb-1.5">about this recording</div>
                    <p className="text-[13px] leading-relaxed text-text2">
                      {track.note}
                    </p>
                  </div>
                ) : null}

                <dl className="grid grid-cols-2 gap-3">
                  <Detail label="Publisher" value={artist.name} />
                  <Detail
                    label="Published"
                    value={relativeTime(track.publishedAt)}
                  />
                  <Detail label="Length" value={formatTime(total)} />
                  <Detail label="Plays" value={formatCount(stats.plays)} />
                  <Detail label="Loves" value={formatCount(stats.likes)} />
                  <Detail label="Notes" value={formatCount(stats.comments)} />
                  <Detail label="Lines" value={String(track.lines.length)} />
                </dl>

                {track.tags.length ? (
                  <div>
                    <div className="label mb-2">tags</div>
                    <div className="flex flex-wrap gap-1.5">
                      {track.tags.map((tag) => (
                        <Link
                          key={tag}
                          to={`/search?tag=${encodeURIComponent(tag)}`}
                          className="chip"
                        >
                          {tag}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}

                {sets.length ? (
                  <div>
                    <div className="label mb-2">appears in</div>
                    <div className="space-y-1.5">
                      {sets.map((set) => (
                        <Link
                          key={set.id}
                          to={`/c/${set.id}`}
                          className="flex items-center gap-2 text-[12.5px] text-muted hover:text-text2"
                        >
                          <Icon name="rows" size={13} /> {set.title}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center gap-2 pt-1">
                  <LikeButton trackId={track.id} size={16} />
                  <Link
                    to={`/t/${track.id}`}
                    className="btn btn-ghost px-3 py-2 !text-[12px]"
                  >
                    <Icon name="arrowUpRight" size={13} /> Open the page
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface2/30 px-3 py-2.5">
      <dt className="label mb-0.5">{label}</dt>
      <dd className="truncate text-[13px] text-text2 tabular-nums">{value}</dd>
    </div>
  );
}
