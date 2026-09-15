import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import type { TimedLyrics } from "../../lib/lyrics";
import type { LyricScript } from "../../store/library";
import { useLibrary } from "../../store/library";
import { currentTime, usePlayer } from "../../store/player";
import { lineAt } from "../../lib/lyrics";

const SCRIPT_TABS: { id: LyricScript; label: string }[] = [
  { id: "tr", label: "Transliteration" },
  { id: "ar", label: "العربية" },
  { id: "en", label: "English" },
];

export function Lyrics({
  lyrics,
  variant = "immersive",
  className,
}: {
  lyrics: TimedLyrics;
  variant?: "immersive" | "inline" | "compact";
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wordRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const activeRef = useRef(-1);
  const lastAuto = useRef(0);
  const userScrollUntil = useRef(0);

  const [active, setActive] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showRail, setShowRail] = useState(true);
  const settings = useLibrary((s) => s.settings);
  const setSetting = useLibrary((s) => s.setSetting);
  const seek = usePlayer((s) => s.seek);
  const playing = usePlayer((s) => s.playing);

  const lines = lyrics.lines;

  const scrollTo = useCallback((idx: number, smooth = true) => {
    const el = lineRefs.current[idx];
    const box = scrollRef.current;
    if (!el || !box) return;
    const top = Math.max(0, el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2);
    lastAuto.current = top;
    if (typeof box.scrollTo === "function") box.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    else box.scrollTop = top;
  }, []);

  /* ---- animation loop: active line + per-word karaoke fill ---- */
  useEffect(() => {
    let raf = 0;
    activeRef.current = -1;

    const frame = () => {
      const t = currentTime();
      const idx = lineAt(lines, t);

      if (idx !== activeRef.current) {
        // settle the line we just left
        const prev = activeRef.current;
        if (prev >= 0 && lines[prev]) {
          lines[prev]!.words.forEach((w) => {
            const el = wordRefs.current.get(`${prev}:${w.w}`);
            if (el) el.style.setProperty("--p", idx > prev ? "1" : "0");
          });
        }
        activeRef.current = idx;
        setActive(idx);
        if (idx >= 0 && autoScroll && performance.now() > userScrollUntil.current) scrollTo(idx);
      }

      // fill the words of the current line
      if (idx >= 0 && lines[idx]) {
        const line = lines[idx]!;
        line.words.forEach((w) => {
          const el = wordRefs.current.get(`${idx}:${w.w}`);
          if (!el) return;
          const span = Math.max(0.05, w.end - w.t);
          const p = Math.min(1, Math.max(0, (t - w.t) / span));
          el.style.setProperty("--p", p.toFixed(4));
        });
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [lines, autoScroll, scrollTo]);

  /* ---- reset when the song changes ---- */
  useEffect(() => {
    wordRefs.current.clear();
    activeRef.current = -1;
    setActive(-1);
    const box = scrollRef.current;
    if (box) {
      if (typeof box.scrollTo === "function") box.scrollTo({ top: 0 });
      else box.scrollTop = 0;
    }
    const first = lineAt(lines, currentTime());
    if (first >= 0) scrollTo(first, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyrics.trackId]);

  const registerWord = (key: string) => (el: HTMLSpanElement | null) => {
    if (el) wordRefs.current.set(key, el);
    else wordRefs.current.delete(key);
  };

  const onUserScroll = () => {
    const box = scrollRef.current;
    if (!box) return;
    if (Math.abs(box.scrollTop - lastAuto.current) > 14) {
      userScrollUntil.current = performance.now() + 3500;
    }
  };

  const big = variant === "immersive";
  const timed = lines.some((l) => typeof l.line.t === "number");
  const compact = variant === "compact";

  const primary = useMemo(() => settings.lyricScript, [settings.lyricScript]);

  return (
    <div className={clsx("flex h-full min-h-0 flex-col", className)}>
      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-1 pb-3">
        <div className="flex items-center gap-1 rounded-full border border-line bg-surface2/60 p-0.5">
          {SCRIPT_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSetting("lyricScript", tab.id)}
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
          <button
            className={clsx("btn-icon flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px]", autoScroll ? "text-jade" : "text-muted")}
            onClick={() => {
              const next = !autoScroll;
              setAutoScroll(next);
              if (next && activeRef.current >= 0) scrollTo(activeRef.current);
            }}
            aria-pressed={autoScroll}
            title="Follow the voice"
          >
            <Icon name={autoScroll ? "eye" : "eyeOff"} size={14} />
            <span className="hidden sm:inline">{autoScroll ? "Following" : "Free scroll"}</span>
          </button>
          <button
            className="btn-icon rounded-full p-1.5 text-muted hover:text-text2"
            onClick={() => setShowRail((v) => !v)}
            aria-pressed={showRail}
            title="Line map"
          >
            <Icon name="rows" size={15} />
          </button>
          <button
            className="btn-icon rounded-full p-1.5 text-muted hover:text-text2"
            onClick={() => {
              if (activeRef.current >= 0) scrollTo(activeRef.current);
              else seek(0);
            }}
            title="Jump to the current line"
          >
            <Icon name="compass" size={15} />
          </button>
        </div>
      </div>

      {/* lyric body */}
      <div className="relative flex min-h-0 flex-1 gap-3">
        {showRail && !compact ? (
          <div className="relative hidden w-6 shrink-0 py-6 sm:block" aria-hidden>
            <div className="absolute bottom-6 left-1/2 top-6 w-px -translate-x-1/2 bg-line2" />
            {lines.map((l, i) => {
              const pct = l.t / Math.max(1, lyrics.duration);
              const isActive = i === active;
              return (
                <button
                  key={i}
                  onClick={() => seek(l.t)}
                  className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-300"
                  style={{
                    top: `${6 + pct * 88}%`,
                    width: isActive ? 9 : 5,
                    height: isActive ? 9 : 5,
                    background: isActive ? "var(--c-gold)" : i < active ? "var(--c-jade)" : "var(--c-line-3)",
                    boxShadow: isActive ? "0 0 12px rgba(var(--c-glow-2),0.8)" : undefined,
                  }}
                  aria-label={`Jump to line ${i + 1}`}
                />
              );
            })}
          </div>
        ) : null}

        <div
          ref={scrollRef}
          onScroll={onUserScroll}
          className={clsx(
            "scroll-slim relative min-h-0 flex-1 overflow-y-auto px-1",
            big ? "py-[38%]" : "py-6",
          )}
          style={{
            maskImage: big ? "linear-gradient(to bottom, transparent, black 12%, black 82%, transparent)" : undefined,
            WebkitMaskImage: big ? "linear-gradient(to bottom, transparent, black 12%, black 82%, transparent)" : undefined,
          }}
        >
          {lines.map((l, i) => {
            const state = i === active ? "active" : i < active ? "past" : "future";
            const sung = l.line.tr ?? l.line.en ?? l.line.ar ?? "";
            const showArabic = settings.showArabic && !!l.line.ar && primary !== "ar";
            const showEn = settings.showTranslation && !!l.line.en && primary !== "en";
            const mainText = primary === "ar" ? (l.line.ar ?? sung) : primary === "en" ? (l.line.en ?? sung) : sung;

            return (
              <Fragment key={i}>
                <button
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                data-active={state === "active"}
                onClick={() => seek(l.t)}
                className={clsx(
                  "lyric-line group block w-full rounded-xl px-3 py-2 text-left transition-all duration-500",
                  state === "active" ? "bg-jade/[0.05]" : "hover:bg-surface2/50",
                  i > 0 && "mt-1",
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
                    {l.line.ar}
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
                  style={state !== "active" ? ({ ["--p" as string]: state === "past" ? 1 : 0 } as React.CSSProperties) : undefined}
                >
                  {l.words.length
                    ? l.words.map((w, wi) => (
                        <span key={wi} className="mr-[0.34em] inline-block whitespace-nowrap">
                          <span
                            ref={registerWord(`${i}:${w.w}`)}
                            className="lyric-word"
                            style={{ ["--p" as string]: state === "past" ? 1 : 0 } as React.CSSProperties}
                          >
                            {w.text}
                            <span className="fill" aria-hidden>
                              {w.text}
                            </span>
                          </span>
                        </span>
                      ))
                    : mainText}
                </div>

                {showEn ? (
                  <div
                    className={clsx(
                      "mt-1 text-[13px] italic leading-relaxed transition-colors duration-500",
                      state === "active" ? "text-text2" : "text-muted/55",
                    )}
                  >
                    {l.line.en}
                  </div>
                ) : null}

                {l.line.note ? (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className={clsx(
                        "rounded-full border px-2 py-[2px] text-[9.5px] font-bold uppercase tracking-[0.12em] transition-colors",
                        l.line.note.startsWith("Qurʾān")
                          ? "border-gold/35 bg-gold/10 text-goldsoft"
                          : "border-line2 text-muted",
                      )}
                    >
                      {l.line.note}
                    </span>
                  </div>
                ) : null}
                </button>
              </Fragment>
            );
          })}

          <div className={clsx("flex items-center gap-2 px-3 pb-2 pt-6 text-[11px] text-muted", big && "mt-6")}>
            <Icon name="info" size={13} />
            <span>
              {playing
                ? timed
                  ? "Timing follows the recording — the publisher set where each line starts."
                  : "No timings were published for this one, so the lines are spread evenly across the recording."
                : "Press play and the words will follow the voice."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A small teaser of the opening lines, used on track pages and cards. */
export function LyricPreview({ lyrics, count = 3, className }: { lyrics: TimedLyrics; count?: number; className?: string }) {
  return (
    <div className={clsx("space-y-2", className)}>
      {lyrics.lines.slice(0, count).map(({ line: l }, i) => (
        <div key={i} className="border-l border-line2 pl-3">
          {l.ar ? (
            <div className="arabic text-[1.02rem] text-goldsoft/80" dir="rtl">
              {l.ar}
            </div>
          ) : null}
          <div className="font-display text-[15px] leading-snug text-text2">{l.tr ?? l.en}</div>
          {l.en && l.tr ? <div className="text-xs italic text-muted">{l.en}</div> : null}
        </div>
      ))}
    </div>
  );
}
