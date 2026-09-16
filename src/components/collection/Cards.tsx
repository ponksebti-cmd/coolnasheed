import { useRef } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { CoverArt, Avatar } from "../art/CoverArt";
import { Reveal, SectionHeader } from "../ui/Primitives";
import { PlayFab } from "../track/TrackBits";
import {
  artistOf,
  durationOf,
  formatCount,
  getCollection,
  statsFor,
  tracksOf,
} from "../../data/catalog";
import { formatTime, formatTotal } from "../../lib/format";
import { usePlayer, type PlayContext } from "../../store/player";
import type { Accent, Collection, Track } from "../../data/types";
import type { ArtistCard as Artist } from "../../../shared/types";

/* ------------------------------------------------------------------- rail */

export function Rail({
  label,
  title,
  subtitle,
  action,
  children,
  className,
}: {
  label?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.max(280, el.clientWidth * 0.8),
      behavior: "smooth",
    });
  };

  return (
    <section className={clsx("group/rail", className)}>
      <SectionHeader
        label={label}
        title={title}
        subtitle={subtitle}
        action={
          <div className="flex items-center gap-2">
            {action}
            <div className="hidden items-center gap-1 sm:flex">
              <button
                className="btn-icon grid h-8 w-8 place-items-center rounded-full border border-line"
                onClick={() => scrollBy(-1)}
                aria-label="Scroll left"
              >
                <Icon name="chevronLeft" size={15} />
              </button>
              <button
                className="btn-icon grid h-8 w-8 place-items-center rounded-full border border-line"
                onClick={() => scrollBy(1)}
                aria-label="Scroll right"
              >
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
          </div>
        }
      />
      <div
        ref={ref}
        className="no-bar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pb-2"
      >
        {children}
      </div>
    </section>
  );
}

export function RailItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx("w-[168px] shrink-0 snap-start sm:w-[190px]", className)}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------- collection card */

export function CollectionCard({
  collection,
  index = 0,
  to,
}: {
  collection: Pick<
    Collection,
    "id" | "title" | "titleAr" | "curator" | "accent" | "blurb" | "tags"
  >;
  index?: number;
  to?: string;
}) {
  const tracks = getCollection(collection.id)
    ? tracksOf(getCollection(collection.id)!)
    : [];
  const playIds = usePlayer((s) => s.playIds);
  const duration = tracks.reduce((sum, t) => sum + durationOf(t), 0);

  return (
    <Reveal delay={index * 40}>
      <article className="card sheen group relative overflow-hidden">
        <Link to={to ?? `/c/${collection.id}`} className="block">
          <div className="relative aspect-[4/3] overflow-hidden">
            <div className="absolute inset-0 transition-transform duration-[1100ms] ease-out group-hover:scale-[1.07]">
              <CoverArt
                title={collection.title}
                accent={collection.accent}
                className="h-full w-full"
                rounded="sm"
              />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(3,10,8,0.9)] via-[rgba(3,10,8,0.15)] to-transparent" />
            {collection.titleAr ? (
              <div
                className="arabic absolute right-3 top-2 text-[15px] text-goldsoft/70"
                dir="rtl"
              >
                {collection.titleAr}
              </div>
            ) : null}
            <div className="absolute inset-x-3 bottom-3">
              <div className="label mb-1">{collection.tags[0] ?? "set"}</div>
              <h3 className="text-balance text-[15px] font-semibold leading-tight text-text">
                {collection.title}
              </h3>
            </div>
          </div>
        </Link>
        <div className="space-y-2 p-3.5">
          <p className="truncate-2 text-[12px] leading-relaxed text-muted">
            {collection.blurb}
          </p>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
            <span className="truncate">{collection.curator}</span>
            <span className="shrink-0 tabular-nums">
              {tracks.length} · {formatTotal(duration)}
            </span>
          </div>
        </div>
        <div className="absolute bottom-[86px] right-3.5 translate-y-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <PlayFab
            playing={false}
            size={40}
            onClick={(e) => {
              e.preventDefault();
              playIds(
                tracks.map((t) => t.id),
                0,
                {
                  kind: "collection",
                  id: collection.id,
                  label: collection.title,
                },
              );
            }}
          />
        </div>
      </article>
    </Reveal>
  );
}

/* ------------------------------------------------------------ artist card */

export function ArtistCard({
  artist,
  index = 0,
}: {
  artist: Artist;
  index?: number;
}) {
  return (
    <Reveal delay={index * 40}>
      <Link
        to={`/a/${artist.id}`}
        className="card sheen group block overflow-hidden p-4 text-center"
      >
        <div className="relative mx-auto mb-3 h-[92px] w-[92px] overflow-hidden rounded-full ring-1 ring-line2 transition-transform duration-500 group-hover:scale-[1.05]">
          <Avatar name={artist.name} accent={artist.accent} size={92} />
          <span className="absolute inset-0 rounded-full shadow-[inset_0_0_24px_rgba(0,0,0,0.55)]" />
          {artist.verified ? (
            <span className="absolute -bottom-0.5 left-1/2 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full border border-line2 bg-elev text-jade">
              <Icon name="check" size={11} strokeWidth={2.4} />
            </span>
          ) : null}
        </div>
        <div className="truncate text-[13.5px] font-semibold text-text group-hover:text-jadesoft">
          {artist.name}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted">
          {artist.role}
        </div>
        <div className="mt-2 truncate text-[10.5px] uppercase tracking-[0.12em] text-muted/70">
          {artist.origin}
        </div>
      </Link>
    </Reveal>
  );
}

/* ------------------------------------------------------------- mood tile */

export function MoodTile({
  mood,
  index = 0,
  active,
}: {
  mood: {
    id: string;
    label: string;
    labelAr?: string;
    blurb: string;
    accent: Accent;
  };
  index?: number;
  active?: boolean;
}) {
  return (
    <Reveal delay={index * 30} className="h-full">
      <Link
        to={`/search?mood=${mood.id}`}
        className={clsx(
          "card sheen group relative flex h-full flex-col justify-between overflow-hidden p-4",
          active && "!border-jade/40 bg-jade/[0.07]",
        )}
      >
        <div
          className="absolute inset-0 opacity-[0.28] transition-opacity duration-500 group-hover:opacity-45"
          style={{
            background: `radial-gradient(120% 90% at 85% 10%, color-mix(in oklab, var(--c-${mood.accent}) 45%, transparent), transparent 70%)`,
          }}
          aria-hidden
        />
        <div className="relative">
          <h3 className="font-display text-[19px] leading-tight text-text">
            {mood.label}
          </h3>
          {mood.labelAr ? (
            <div
              className="arabic mt-0.5 text-[13px] text-goldsoft/75"
              dir="rtl"
            >
              {mood.labelAr}
            </div>
          ) : null}
        </div>
        <p className="relative mt-3 text-[11.5px] leading-relaxed text-muted">
          {mood.blurb}
        </p>
      </Link>
    </Reveal>
  );
}

/* ------------------------------------------------------- compact track row */

export function MiniTrack({
  track,
  index,
  queue,
  context,
}: {
  track: Track;
  index: number;
  queue: string[];
  context?: PlayContext;
}) {
  const { trackId, playing, toggle, playIds } = usePlayer();
  const isCurrent = trackId === track.id;
  const artist = artistOf(track);
  return (
    <div
      className={clsx(
        "group flex items-center gap-3 rounded-xl border px-2.5 py-2 transition-colors",
        isCurrent
          ? "border-jade/25 bg-jade/[0.07]"
          : "border-transparent hover:border-line hover:bg-surface2/50",
      )}
    >
      <span
        className={clsx(
          "w-4 shrink-0 text-center text-[11px] tabular-nums",
          isCurrent ? "text-jade" : "text-muted",
        )}
      >
        {index + 1}
      </span>
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg ring-1 ring-line">
        <CoverArt
          path={track.artworkPath}
          title={track.title}
          className="h-full w-full"
          rounded="sm"
        />
        <button
          className="absolute inset-0 grid place-items-center bg-[rgba(3,10,8,0.66)] opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() =>
            isCurrent ? toggle() : playIds(queue, index, context)
          }
          aria-label={isCurrent && playing ? "Pause" : "Play"}
        >
          <Icon
            name={isCurrent && playing ? "pause" : "play"}
            size={14}
            className="text-text"
            strokeWidth={2.2}
          />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={clsx(
            "truncate text-[13px] font-semibold",
            isCurrent ? "text-jadesoft" : "text-text",
          )}
        >
          {track.title}
        </div>
        <div className="truncate text-[11px] text-muted">{artist.name}</div>
      </div>
      <span className="hidden shrink-0 items-center gap-1 text-[10.5px] tabular-nums text-muted sm:flex">
        <Icon name="waveform" size={11} />
        {formatCount(statsFor(track).plays)}
      </span>
      <span className="hidden w-12 shrink-0 text-right text-[11px] tabular-nums text-muted md:block">
        {formatTime(durationOf(track))}
      </span>
    </div>
  );
}
