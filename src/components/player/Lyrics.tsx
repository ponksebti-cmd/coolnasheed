/**
 * The words.
 *
 * A nasheed's lyrics are text a publisher wrote, and — when they took the trouble —
 * timings in seconds taken from the recording. Nothing derives a timing from the
 * audio and nothing guesses one: if the timings are there the view follows the
 * recording line by line, and if they are not the words are simply the words.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import type { LyricLine, Song } from "../../../shared/types";
import { useLibrary, type Settings } from "../../store/library";
import { usePlayer } from "../../store/player";
import { currentTime } from "../../store/player";

const SCRIPT_TABS: { id: Settings["lyricScript"]; label: string }[] = [
  { id: "tr", label: "Transliteration" },
  { id: "ar", label: "العربية" },
  { id: "en", label: "English" },
];

/** The last line whose timing has been reached, or -1 when nothing is timed. */
function lineAt(lines: LyricLine[], t: number): number {
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i]!.t;
    if (typeof at === "number" && t >= at) found = i;
  }
  return found;
}

export function Lyrics({
  song,
  variant = "immersive",
  className,
}: {
  song: Song;
  variant?: "immersive" | "inline" | "compact";
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeRef = useRef(-1);
  const lastAuto = useRef(0);
  const userScrollUntil = useRef(0);

  const [active, setActive] = useState(-1);
  const [following, setFollowing] = useState(true);
  const [showRail, setShowRail] = useState(true);

  const settings = useLibrary((s) => s.settings);
  const setSetting = useLibrary((s) => s.setSetting);
  const seek = usePlayer((s) => s.seek);
  const playing = usePlayer((s) => s.playing);

  const lines = song.lines;
  const timed = useMemo(() => lines.some((line) => typeof line.t === "number"), [lines]);

  const scrollTo = useCallback((idx: number, smooth = true) => {
    const el = lineRefs.current[idx];
    const box = scrollRef.current;
    if (!el || !box) return;
    const top = Math.max(0, el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2);
    lastAuto.current = top;
    if (typeof box.scrollTo === "function") box.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    else box.scrollTop = top;
  }, []);

  /* the active line follows the recording, at the pace of the recording */
  useEffect(() => {
    if (!timed) {
      activeRef.current = -1;
      setActive(-1);
      return;
    }
    let raf = 0;
    const frame = () => {
      const idx = lineAt(lines, currentTime());
      if (idx !== activeRef.current) {
        activeRef.current = idx;
        setActive(idx);
        if (idx >= 0 && following && performance.now() > userScrollUntil.current) scrollTo(idx);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [lines, timed, following, scrollTo]);

  /* a new recording starts at the top */
  useEffect(() => {
    activeRef.current = -1;
    setActive(-1);
    const box = scrollRef.current;
    if (box) {
      if (typeof box.scrollTo === "function") box.scrollTo({ top: 0 });
      else box.scrollTop = 0;
    }
  }, [song.id]);

  const onUserScroll = () => {
    const box = scrollRef.current;
    if (!box) return;
    if (Math.abs(box.scrollTop - lastAuto.current) > 14) {
      userScrollUntil.current = performance.now() + 3500;
    }
  };

  const big = variant === "immersive";
  const compact = variant === "compact";
  const primary = settings.lyricScript;

  if (!lines.length) {
    return (
      <div className={clsx("grid h-full place-items-center p-6 text-center text-sm text-muted", className)}>
        <div>
          <Icon name="lyrics" size={22} className="mx-auto mb-3 text-muted/70" />
          <p>The publisher has not written the lyrics out for this one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx("flex h-full min-h-0 flex-col", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-1 pb-3">
        <div className="flex items-center gap-1 rounded-full border border-line bg-surface2/60 p-0.5">
          {SCRIPT_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => void setSetting("lyricScript", tab.id)}
              className={clsx(
                "btn px-3 py-1.5 !text-[11px]",
                primary === tab.id ? "bg-jade/15 text-jadesoft" : "text-muted hover:text-text2",
              )}
              aria-pressed={primary === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {timed ? (
            <button
              className={clsx("btn-icon flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px]", following ? "text-jade" : "text-muted")}
              onClick={() => {
                const next = !following;
                setFollowing(next);
                if (next && activeRef.current >= 0) scrollTo(activeRef.current);
              }}
              aria-pressed={following}
              title="Follow the recording"
            >
              <Icon name={following ? "eye" : "eyeOff"} size={14} />
              <span className="hidden sm:inline">{following ? "Following" : "Free scroll"}</span>
            </button>
          ) : null}
          {timed && !compact ? (
            <button
              className="btn-icon rounded-full p-1.5 text-muted hover:text-text2"
              onClick={() => setShowRail((v) => !v)}
              aria-pressed={showRail}
              title="Line map"
            >
              <Icon name="rows" size={15} />
            </button>
          ) : null}
          <button
            className="btn-icon rounded-full p-1.5 text-muted hover:text-text2"
            onClick={() => (activeRef.current >= 0 ? scrollTo(activeRef.current) : usePlayer.getState().seek(0))}
            title={timed ? "Jump to the current line" : "Back to the top"}
          >
            <Icon name="compass" size={15} />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 gap-3">
        {showRail && timed && !compact ? (
          <div className="relative hidden w-6 shrink-0 py-6 sm:block" aria-hidden>
            <div className="absolute bottom-6 left-1/2 top-6 w-px -translate-x-1/2 bg-line2" />
            {lines.map((line, i) => {
              const total = song.durationMs ? song.durationMs / 1000 : 0;
              const pct = total > 0 && typeof line.t === "number" ? line.t / total : i / Math.max(1, lines.length);
              const isActive = i === active;
              return (
                <button
                  key={i}
                  onClick={() => (typeof line.t === "number" ? seek(line.t) : undefined)}
                  className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-300"
                  style={{
                    top: `${6 + pct * 88}%`,
                    width: isActive ? 9 : 5,
                    height: isActive ? 9 : 5,
                    background: isActive ? "var(--c-gold)" : i < active ? "var(--c-jade)" : "var(--c-line-3)",
                  }}
                  aria-label={`Line ${i + 1}`}
                />
              );
            })}
          </div>
        ) : null}

        <div
          ref={scrollRef}
          onScroll={onUserScroll}
          className={clsx("scroll-slim relative min-h-0 flex-1 overflow-y-auto px-1", big ? "py-[34%]" : "py-6")}
          style={{
            maskImage: big ? "linear-gradient(to bottom, transparent, black 12%, black 82%, transparent)" : undefined,
            WebkitMaskImage: big ? "linear-gradient(to bottom, transparent, black 12%, black 82%, transparent)" : undefined,
          }}
        >
          {lines.map((line, i) => {
            const state = i === active ? "active" : i < active ? "past" : "future";
            const sung = line.tr ?? line.en ?? line.ar ?? "";
            const showArabic = settings.showArabic && !!line.ar && primary !== "ar";
            const showTranslation = settings.showTranslation && !!line.en && primary !== "en";
            const main = primary === "ar" ? (line.ar ?? sung) : primary === "en" ? (line.en ?? sung) : sung;
            const jumpable = typeof line.t === "number";

            return (
              <Fragment key={i}>
                <button
                  ref={(el) => {
                    lineRefs.current[i] = el;
                  }}
                  data-active={state === "active"}
                  onClick={() => (jumpable ? seek(line.t!) : undefined)}
                  className={clsx(
                    "lyric-line group block w-full rounded-xl px-3 py-2 text-left transition-all duration-500",
                    state === "active" ? "bg-jade/[0.05]" : "hover:bg-surface2/50",
                    i > 0 && "mt-1",
                    !jumpable && "cursor-default",
                  )}
                  aria-current={state === "active" ? "true" : undefined}
                >
                  {showArabic ? (
                    <div
                      className={clsx(
                        "arabic text-right transition-all duration-500",
                        state === "active" ? "text-goldsoft" : state === "past" ? "text-text2/45" : "text-muted/60",
                        big ? "text-[1.35rem]" : "text-[1.05rem]",
                      )}
                      dir="rtl"
                    >
                      {line.ar}
                    </div>
                  ) : null}

                  <div
                    className={clsx(
                      "mt-1 font-display leading-[1.35] transition-all duration-500",
                      big ? "text-[1.65rem] md:text-[2.15rem]" : "text-[1.15rem]",
                      state === "active"
                        ? "text-text"
                        : state === "past"
                          ? "text-text2/40"
                          : "text-muted/70 group-hover:text-muted",
                      primary === "ar" && "arabic text-right",
                    )}
                  >
                    {main}
                  </div>

                  {showTranslation ? (
                    <div
                      className={clsx(
                        "mt-1 text-[13px] italic leading-relaxed transition-colors duration-500",
                        state === "active" ? "text-text2" : "text-muted/55",
                      )}
                    >
                      {line.en}
                    </div>
                  ) : null}

                  {line.note ? (
                    <div
                      className={clsx(
                        "mt-1.5 inline-block rounded-full border px-2 py-[2px] text-[9.5px] font-bold uppercase tracking-[0.12em]",
                        line.note.startsWith("Qurʾān") ? "border-gold/35 bg-gold/10 text-goldsoft" : "border-line2 text-muted",
                      )}
                    >
                      {line.note}
                    </div>
                  ) : null}
                </button>
              </Fragment>
            );
          })}

          <div className={clsx("flex items-center gap-2 px-3 pb-2 pt-6 text-[11px] text-muted", big && "mt-6")}>
            <Icon name="info" size={13} />
            <span>
              {timed
                ? playing
                  ? "The lines follow the recording, at the timings the publisher gave."
                  : "Press play and the lines will follow the recording."
                : "These lines are not timed — the words are all here, in order."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The opening lines, for cards and pages that want a taste of the words. */
export function LyricPreview({ song, count = 3, className }: { song: Song; count?: number; className?: string }) {
  const lines = song.lines.slice(0, count);
  if (!lines.length) return null;
  return (
    <div className={clsx("space-y-2", className)}>
      {lines.map((line, i) => (
        <div key={i} className="border-l border-line2 pl-3">
          {line.ar ? (
            <div className="arabic text-[1.02rem] text-goldsoft/80" dir="rtl">
              {line.ar}
            </div>
          ) : null}
          <div className="font-display text-[15px] leading-snug text-text2">{line.tr ?? line.en ?? ""}</div>
          {line.en && line.tr ? <div className="text-xs italic text-muted">{line.en}</div> : null}
        </div>
      ))}
    </div>
  );
}
