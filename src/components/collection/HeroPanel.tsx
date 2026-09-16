import { clsx } from "clsx";
import { CoverArt } from "../art/CoverArt";
import { Icon, type IconName } from "../ui/Icons";
import { Reveal } from "../ui/Primitives";
import { PlayFab } from "../track/TrackBits";
import type { Accent, Track } from "../../data/types";
import { durationOf } from "../../data/catalog";
import { formatTotal } from "../../lib/format";

export type HeroAction = { label: string; icon: IconName; onClick: () => void; tone?: "primary" | "ghost" | "gold"; active?: boolean };

export function HeroPanel({
  title,
  titleAr,
  eyebrow,
  curator,
  blurb,
  artworkPath,
  accent,
  tracks,
  playing,
  onPlay,
  actions,
  liked,
  onLike,
  children,
  big,
}: {
  title: string;
  titleAr?: string;
  eyebrow?: string;
  curator?: string;
  blurb?: string;
  /** the cover image, when the shelf or nasheed has one */
  artworkPath?: string | null;
  accent: Accent;
  tracks: Track[];
  playing: boolean;
  onPlay: () => void;
  actions?: HeroAction[];
  liked?: boolean;
  onLike?: () => void;
  children?: React.ReactNode;
  big?: boolean;
}) {
  const total = tracks.length;
  const duration = tracks.reduce((sum, t) => sum + durationOf(t), 0);

  return (
    <section className={clsx("over-art relative overflow-hidden rounded-2xl border border-line", big ? "min-h-[380px]" : "min-h-[280px]")}>
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background: `radial-gradient(120% 120% at 12% 0%, color-mix(in oklab, var(--c-${accent}) 42%, transparent), transparent 62%)`,
        }}
        aria-hidden
      />
      <div className="art-scrim-side absolute inset-0" />
      <div className="grain absolute inset-0" />

      <div className={clsx("relative flex flex-col gap-6 p-5 md:flex-row md:items-end md:p-8", big ? "md:min-h-[380px]" : "md:min-h-[280px]")}>
        <Reveal className="shrink-0">
          <div
            className={clsx(
              "shadow-art relative overflow-hidden rounded-xl border border-line2 transition-transform duration-700 hover:scale-[1.02]",
              big ? "h-[164px] w-[164px] md:h-[208px] md:w-[208px]" : "h-[132px] w-[132px] md:h-[164px] md:w-[164px]",
            )}
          >
            <CoverArt path={artworkPath} title={title} accent={accent} className="h-full w-full" rounded="md" />
            <div className="absolute inset-0 ring-1 ring-inset ring-line2" />
          </div>
        </Reveal>

        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <div className="label mb-2 flex items-center gap-2">
              <span className="inline-block h-px w-6 bg-gold/60" />
              {eyebrow}
            </div>
          ) : null}
          <Reveal delay={60}>
            <h1 className={clsx("text-balance leading-[0.95] text-text", big ? "text-[2.1rem] md:text-[3.4rem]" : "text-[1.7rem] md:text-[2.5rem]")}>
              {title}
            </h1>
            {titleAr ? (
              <div className="arabic mt-2 text-[1.15rem] text-goldsoft/85 md:text-[1.5rem]" dir="rtl">
                {titleAr}
              </div>
            ) : null}
          </Reveal>

          <Reveal delay={110}>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {curator ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <Icon name="sparkle" size={12} className="text-gold" />
                    {curator}
                  </span>
                  <span aria-hidden>·</span>
                </>
              ) : null}
              <span className="tabular-nums">
                {total} {total === 1 ? "track" : "tracks"}
              </span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{formatTotal(duration)}</span>
              {children}
            </div>
            {blurb ? <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-text2/85 text-balance-pretty">{blurb}</p> : null}
          </Reveal>

          <Reveal delay={160}>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button onClick={onPlay} className="btn btn-primary px-5 py-3 text-[13px]" aria-label={playing ? "Pause" : `Play ${title}`}>
                <Icon name={playing ? "pause" : "play"} size={16} strokeWidth={2.2} />
                {playing ? "Pause" : "Play"}
              </button>
              {actions?.map((a) => (
                <button
                  key={a.label}
                  onClick={a.onClick}
                  className={clsx("btn px-4 py-3", a.tone === "gold" ? "btn-gold" : a.tone === "primary" ? "btn-primary" : "btn-ghost")}
                  aria-pressed={a.active}
                >
                  <Icon name={a.icon} size={15} />
                  {a.label}
                </button>
              ))}
              {onLike ? (
                <button
                  onClick={onLike}
                  className={clsx("btn-icon grid h-11 w-11 place-items-center rounded-full border transition-colors", liked ? "border-gold/40 bg-gold/12 text-gold" : "border-line2 text-text2 hover:text-text")}
                  aria-label={liked ? "Remove from library" : "Save to library"}
                  aria-pressed={liked}
                >
                  <Icon name={liked ? "starFill" : "star"} size={17} />
                </button>
              ) : null}
            </div>
          </Reveal>
        </div>

        <div className="hidden shrink-0 md:block">
          <PlayFab playing={playing} onClick={onPlay} size={58} className="shadow-[0_20px_50px_-18px_rgba(var(--c-glow),0.9)]" />
        </div>
      </div>
    </section>
  );
}
