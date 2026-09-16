import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { PatternArt } from "../art/PatternArt";
import { RadialSpectrum } from "./Visualizer";
import { TimeRow, TransportButtons, VolumeControl } from "./Transport";
import { QueuePanel } from "./QueuePanel";
import { Lyrics } from "./Lyrics";
import { Equalizer, LikeButton } from "../track/TrackBits";
import { MOTIF_LABEL, planArt } from "../../lib/art/pattern";
import { artistOf, collectionsOf, durationOf, formatCount, getTrack, statsFor } from "../../data/catalog";
import { timedLyrics } from "../../lib/lyrics";
import { MAQAMAT, hasQuarterTones, maqamLabel } from "../../lib/theory";
import { formatTime } from "../../lib/format";
import { useBodyScrollLock, useKeyboard } from "../../lib/hooks";
import { usePlayer } from "../../store/player";
import { useLibrary } from "../../store/library";
import { whyThis } from "../../lib/nur";
import type { Track } from "../../data/types";
import type { TimedLyrics } from "../../lib/lyrics";

type Tab = "lyrics" | "queue" | "details";

export function ImmersivePlayer() {
  const open = usePlayer((s) => s.immersive);
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const context = usePlayer((s) => s.context);
  const setImmersive = usePlayer((s) => s.setImmersive);
  const liked = useLibrary((s) => (trackId ? s.liked.includes(trackId) : false));
  const history = useLibrary((s) => s.history);
  const likes = useLibrary((s) => s.liked);
  const [tab, setTab] = useState<Tab>("lyrics");

  useBodyScrollLock(open);
  useKeyboard(
    {
      escape: () => setImmersive(false),
      l: () => setTab("lyrics"),
      q: () => setTab("queue"),
    },
    open,
  );

  const track = getTrack(trackId);
  const lyrics = useMemo(
    () => (track ? timedLyrics(track.id, track.lines, durationOf(track)) : null),
    [track],
  );
  const plan = useMemo(() => (track ? planArt(track.seed) : null), [track]);

  useEffect(() => {
    if (open) setTab("lyrics");
  }, [open, trackId]);

  if (!open || !track || !lyrics || !plan) return null;

  const artist = artistOf(track);
  const stats = statsFor(track);
  const sets = collectionsOf(track);
  const timed = timedLines(lyrics);

  return createPortal(
    <div className="sheet-in fixed inset-0 z-[100] flex flex-col overflow-hidden bg-bg" role="dialog" aria-modal="true" aria-label="Immersive player">
      {/* backdrop */}
      <div className="absolute inset-0 scale-[1.6] opacity-[0.55] blur-[46px]">
        <PatternArt seed={track.seed} intensity={1.1} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(4,10,8,0.86)] via-[rgba(4,10,8,0.9)] to-bg" />
      <div className="grain absolute inset-0" />

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
              {playing ? <Equalizer bars={3} className="text-jade" /> : <Icon name="waveform" size={11} />}
              now playing · {context.label}
            </div>
            <div className="truncate text-[13px] font-semibold text-text">{track.title}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LikeButton trackId={track.id} size={16} />
        </div>
      </header>

      {/* body */}
      <div className="relative z-10 grid min-h-0 flex-1 gap-6 overflow-y-auto px-4 pb-4 sm:overflow-hidden sm:px-7 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-10">
        {/* left: artwork + transport */}
        <div className="scroll-slim flex min-h-0 flex-col items-center justify-center gap-5 sm:overflow-y-auto lg:pr-2">
          <div className="relative w-full max-w-[min(78vw,430px)]">
            <div className="absolute -inset-[9%]">
              <RadialSpectrum />
            </div>
            <div className="relative aspect-square overflow-hidden rounded-2xl border border-line2 shadow-[0_50px_120px_-40px_rgba(0,0,0,1)]">
              <PatternArt seed={track.seed} intensity={1} />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-[rgba(3,9,7,0.92)] to-transparent p-4">
                <div className="min-w-0">
                  <div className="label mb-1">{MOTIF_LABEL[plan.motif]}</div>
                  <div className="truncate font-display text-lg text-text">{track.title}</div>
                  {track.titleAr ? (
                    <div className="arabic truncate text-[13px] text-goldsoft/85" dir="rtl">
                      {track.titleAr}
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-md border border-line2 bg-[rgba(4,12,9,0.6)] px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider text-text2 backdrop-blur">
                  {maqamLabel(track.maqam)}
                </span>
              </div>
            </div>
          </div>

          <div className="w-full max-w-[520px]">
            <div className="flex items-center justify-center">
              <TransportButtons size={42} />
            </div>
            <div className="mt-2">
              <TimeRow />
            </div>
            <div className="mt-2 flex items-center justify-center gap-3">
              <VolumeControl />
              <div className="hidden items-center gap-1 text-[11px] text-muted sm:flex">
                <Icon name="info" size={12} />
                <span>
                  {lyrics.lines.length} lines
                  {timed ? " · timed to the recording" : " · no timings published"}
                </span>
              </div>
            </div>
          </div>

          {/* meta chips */}
          <div className="flex max-w-[560px] flex-wrap items-center justify-center gap-1.5">
            {[
              { icon: "compass" as const, label: maqamLabel(track.maqam) },
              { icon: "clock" as const, label: formatTime(durationOf(track)) },
              { icon: "user" as const, label: artist.name },
            ].map((c) => (
              <span key={c.label} className="chip !normal-case !tracking-normal">
                <Icon name={c.icon} size={11} />
                {c.label}
              </span>
            ))}
          </div>
        </div>

        {/* right: lyrics / queue / details */}
        <div className="panel relative flex min-h-[60vh] flex-col overflow-hidden rounded-2xl p-4 sm:min-h-0 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-full border border-line bg-surface2/50 p-0.5">
              {(
                [
                  { id: "lyrics", label: "Lyrics", icon: "lyrics" },
                  { id: "queue", label: "Queue", icon: "queue" },
                  { id: "details", label: "Details", icon: "info" },
                ] as { id: Tab; label: string; icon: "lyrics" | "queue" | "info" }[]
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    "btn px-3 py-1.5 !text-[11.5px]",
                    tab === t.id ? "bg-jade/15 text-jadesoft" : "text-muted hover:text-text2",
                  )}
                  aria-pressed={tab === t.id}
                >
                  <Icon name={t.icon} size={13} />
                  {t.label}
                </button>
              ))}
            </div>
            <Link to={`/t/${track.id}`} className="btn-icon flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] text-muted hover:text-text2">
              Track page <Icon name="arrowUpRight" size={13} />
            </Link>
          </div>

          <div className="min-h-0 flex-1">
            {tab === "lyrics" ? (
              <Lyrics lyrics={lyrics} variant="immersive" />
            ) : tab === "queue" ? (
              <QueuePanel compact />
            ) : (
              <DetailsPanel
                track={track}
                lyrics={lyrics}
                reason={whyThis(track, likes, history)}
                liked={liked}
                stats={stats}
                sets={sets.map((s) => ({ id: s.id, title: s.title }))}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DetailsPanel({
  track,
  lyrics,
  reason,
  liked,
  stats,
  sets,
}: {
  track: Track;
  lyrics: TimedLyrics;
  reason: string;
  liked: boolean;
  stats: { plays: number; likes: number; notes: number };
  sets: { id: string; title: string }[];
}) {
  const artist = artistOf(track);
  const maqam = MAQAMAT[track.maqam];
  const quarter = hasQuarterTones(track.maqam);

  return (
    <div className="scroll-slim h-full min-h-0 space-y-5 overflow-y-auto pr-1.5 pb-4">
      <section>
        <div className="label mb-2">Why this is playing</div>
        <p className="rounded-xl border border-jade/25 bg-jade/[0.07] px-3.5 py-3 text-[13px] leading-relaxed text-text2">
          <span className="mr-1.5 inline-flex align-middle text-jade">
            <Icon name="sparkle" size={14} />
          </span>
          {reason}
        </p>
      </section>

      <section>
        <div className="label mb-2">About</div>
        <p className="text-[13.5px] leading-relaxed text-text2">{track.note}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {track.tags.map((t) => (
            <span key={t} className="chip !normal-case !tracking-normal">
              {t}
            </span>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-surface2/40 p-3">
          <div className="label mb-1.5">Maqām</div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-xl text-text">{maqam.name}</span>
            <span className="arabic text-sm text-goldsoft/80" dir="rtl">
              {maqam.ar}
            </span>
          </div>
          <p className="mt-1 text-[11.5px] text-muted">{maqam.mood}</p>
          <div className="mt-3">
            <div className="relative h-8">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line2" />
              {Array.from({ length: 13 }).map((_, i) => (
                <span key={i} className="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-line2" style={{ left: `${(i / 12) * 100}%` }} />
              ))}
              {maqam.steps.map((s, i) => {
                const isQuarter = Math.abs(s - Math.round(s)) > 0.01;
                return (
                  <span
                    key={i}
                    className={clsx("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", isQuarter ? "h-2.5 w-2.5 bg-gold" : "h-2 w-2 bg-jade")}
                    style={{ left: `${(s / 12) * 100}%`, boxShadow: isQuarter ? "0 0 10px rgba(var(--c-glow-2),0.7)" : undefined }}
                    title={`${s} semitones`}
                  />
                );
              })}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10.5px] text-muted">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-jade" /> whole & half tones
              </span>
              {quarter ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold" /> quarter tone
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface2/40 p-3">
          <div className="label mb-1.5">The recording</div>
          <div className="font-display text-xl capitalize text-text">{formatTime(durationOf(track))}</div>
          <p className="mt-1 text-[11.5px] text-muted">
            {track.audioUrl ? "Streamed from the publisher's upload." : "No audio has been attached to this nasheed."}
          </p>
          <div className="mt-3 space-y-1.5 text-[11.5px] text-muted">
            <Row k="Length" v={formatTime(durationOf(track))} />
            <Row k="Lines" v={`${lyrics.lines.length}${timedLines(lyrics) ? " · timed" : ""}`} />
            <Row k="Year" v={String(track.year)} />
            <Row k="Plays" v={`${formatCount(stats.plays)} · ${formatCount(stats.likes)} loved`} />
          </div>
          {liked ? (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-gold">
              <Icon name="starFill" size={12} /> in your loved list
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <div className="label mb-2">Sources</div>
        <ul className="space-y-1.5">
          {lyrics.lines
            .filter(({ line }) => line.note)
            .map(({ line }, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px] text-text2">
                <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-gold" />
                <span>
                  <span className="font-semibold text-text">{line.note}</span>
                  {line.tr || line.en ? <span className="text-muted"> — {line.tr ?? line.en}</span> : null}
                </span>
              </li>
            ))}
          {!lyrics.lines.some(({ line }) => line.note) ? (
            <li className="text-[12.5px] text-muted">The publisher credited no sources for these words.</li>
          ) : null}
        </ul>
      </section>

      <section>
        <div className="label mb-2">More from</div>
        <Link to={`/a/${artist.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface2/40 p-3 transition-colors hover:border-line2">
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line">
            <PatternArt seed={artist.seed} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-text">{artist.name}</div>
            <div className="truncate text-[11.5px] text-muted">
              {artist.role} · {artist.origin}
            </div>
          </div>
          <Icon name="chevronRight" size={16} className="text-muted" />
        </Link>
        {sets.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sets.map((set) => (
              <Link key={set.id} to={`/c/${set.id}`} className="chip !normal-case !tracking-normal hover:border-line2 hover:text-text">
                <Icon name="rows" size={11} /> {set.title}
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** True when the publisher supplied a start time for every line. */
function timedLines(lyrics: TimedLyrics): boolean {
  return lyrics.lines.length > 0 && lyrics.lines.every((l) => typeof l.line.t === "number");
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className="truncate font-medium text-text2">{v}</span>
    </div>
  );
}
