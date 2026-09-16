/**
 * The words over the cover.
 *
 * The full-screen lyric view Spotify made familiar: the artwork fills the screen —
 * scaled up and blurred until it is light rather than a picture — and the line being
 * sung sits in the middle of it, with what comes next underneath. Tapping the backdrop
 * clears the chrome away so it is only the words; tapping a line takes the recording
 * there, the same way the lyric sheet does.
 *
 * The one rule a stage this dark needs: it carries `over-art`, so every token inside it
 * is pinned to the night book whatever theme the app is in. A line of poetry is not
 * readable because the page happens to be cream — it is readable because the room
 * behind it was made dark on purpose.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { songArtworkUrl } from "../../lib/wire";
import { useLibrary } from "../../store/library";
import { usePlayer } from "../../store/player";
import { currentTime } from "../../store/player";
import { Equalizer } from "../track/TrackBits";
import { TimeRow, TransportButtons } from "./Transport";
import { artistOf } from "../../data/catalog";
import type { LyricLine, Song } from "../../../shared/types";

/** The last line whose timing has been reached, or -1 when nothing is timed. */
function lineAt(lines: LyricLine[], t: number): number {
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i]!.t;
    if (typeof at === "number" && t >= at) found = i;
  }
  return found;
}

export function LyricStage({ song, onClose }: { song: Song; onClose: () => void }) {
  const seek = usePlayer((s) => s.seek);
  const playing = usePlayer((s) => s.playing);
  const duration = usePlayer((s) => s.duration);
  const toggle = usePlayer((s) => s.toggle);
  const settings = useLibrary((s) => s.settings);

  const boxRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeRef = useRef(-1);
  const [active, setActive] = useState(-1);
  const [offset, setOffset] = useState(0);
  const [chrome, setChrome] = useState(true);

  const lines = song.lines;
  const timed = lines.some((line) => typeof line.t === "number");
  const artwork = songArtworkUrl(song);

  /* which line is being sung, at the pace of the recording */
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
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [lines, timed]);

  /* the column slides so the line being sung stays in the middle of the screen */
  const recentre = useCallback(() => {
    const box = boxRef.current;
    const el = lineRefs.current[Math.max(0, active)];
    if (!box || !el) return;
    const middle = el.offsetTop + el.offsetHeight / 2;
    setOffset(middle - box.clientHeight / 2);
  }, [active]);

  useLayoutEffect(() => {
    recentre();
  }, [recentre, active, song.id]);

  useEffect(() => {
    const onResize = () => recentre();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recentre]);

  /* Escape leaves the stage rather than the player: one step back, not two */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const progress =
    duration > 0 ? Math.min(1, Math.max(0, currentTime() / duration)) : 0;

  return (
    <section
      className="over-art absolute inset-0 z-30 flex flex-col overflow-hidden bg-bg"
      aria-label="Lyrics over the cover"
    >
      {/* the picture, turned into light */}
      {artwork ? (
        <div
          className="absolute -inset-24 scale-125 opacity-60 blur-[70px]"
          style={{ backgroundImage: `url(${artwork})`, backgroundSize: "cover", backgroundPosition: "center" }}
          aria-hidden
        />
      ) : (
        <div
          className="absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(120% 100% at 30% 10%, color-mix(in oklab, var(--c-jade) 60%, transparent), transparent 68%)",
          }}
          aria-hidden
        />
      )}
      <div className="art-wash-deep absolute inset-0" aria-hidden />
      <div className="grain absolute inset-0" aria-hidden />

      {/* progress, a hairline at the top of the screen */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-line2" aria-hidden>
        <div
          className="h-full bg-jade transition-[width] duration-500 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <header
        className={clsx(
          "relative z-10 flex items-center justify-between gap-3 px-4 py-3 transition-opacity duration-500 sm:px-7",
          chrome ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button
          onClick={onClose}
          className="btn-icon grid h-9 w-9 place-items-center rounded-full border border-line2 text-text2 hover:text-text"
          aria-label="Back to the player"
        >
          <Icon name="chevronDown" size={18} />
        </button>
        <div className="min-w-0 text-center">
          <div className="truncate text-[13px] font-semibold text-text">{song.title}</div>
          <div className="truncate text-[11px] text-muted">{artistOf(song).name}</div>
        </div>
        <div className="flex items-center gap-2">
          {playing ? <Equalizer bars={3} className="text-jade" /> : null}
          <button
            onClick={toggle}
            className="btn-icon grid h-9 w-9 place-items-center rounded-full border border-line2 text-text2 hover:text-text"
            aria-label={playing ? "Pause" : "Play"}
          >
            <Icon name={playing ? "pause" : "play"} size={15} />
          </button>
        </div>
      </header>

      {/* the words */}
      <div
        ref={boxRef}
        onClick={() => setChrome((v) => !v)}
        className="relative z-10 min-h-0 flex-1 cursor-pointer overflow-hidden"
      >
        {!lines.length ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <Icon name="lyrics" size={22} className="mx-auto mb-3 text-muted" />
              <p className="text-[13.5px] text-text2">
                The publisher has not written the lyrics out for this one.
              </p>
            </div>
          </div>
        ) : null}
        <div
          className="will-change-transform transition-transform duration-[700ms] [transition-timing-function:var(--ease-material)]"
          style={{ transform: `translateY(${-offset}px)` }}
        >
          {lines.map((line, i) => {
            const state = i === active ? "active" : i < active ? "past" : "future";
            const sung = line.tr ?? line.en ?? line.ar ?? "";
            const primary = settings.lyricScript;
            const main =
              primary === "ar" ? (line.ar ?? sung) : primary === "en" ? (line.en ?? sung) : sung;
            const showArabic = settings.showArabic && !!line.ar && primary !== "ar";
            const showTranslation = settings.showTranslation && !!line.en && primary !== "en";
            const jumpable = typeof line.t === "number";

            return (
              <button
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                onClick={(e) => {
                  /* a tap on a line is a seek, not a request to hide the controls */
                  e.stopPropagation();
                  if (jumpable) seek(line.t!);
                }}
                className={clsx(
                  "mx-auto block w-full max-w-[min(94vw,900px)] px-6 py-3 text-center transition-all duration-500 sm:px-10",
                  jumpable ? "cursor-pointer" : "cursor-default",
                  state === "active"
                    ? "opacity-100"
                    : state === "past"
                      ? "opacity-30 hover:opacity-60"
                      : "opacity-45 hover:opacity-75",
                )}
                aria-current={state === "active" ? "true" : undefined}
              >
                {showArabic ? (
                  <div
                    className={clsx(
                      "arabic leading-[1.7] transition-all duration-500",
                      state === "active" ? "text-[clamp(1.1rem,2.6vw,1.7rem)] text-goldsoft" : "text-[clamp(0.95rem,1.8vw,1.15rem)] text-goldsoft/50",
                    )}
                    dir="rtl"
                  >
                    {line.ar}
                  </div>
                ) : null}
                <div
                  className={clsx(
                    "font-display leading-[1.3] transition-all duration-500",
                    state === "active"
                      ? "text-[clamp(1.5rem,4.6vw,2.7rem)] text-text shadow-[0_2px_30px_var(--art-strong)]"
                      : "text-[clamp(1.05rem,2.4vw,1.5rem)] text-text2",
                    primary === "ar" && "arabic",
                  )}
                >
                  {main}
                </div>
                {showTranslation ? (
                  <div
                    className={clsx(
                      "mt-1.5 italic transition-all duration-500",
                      state === "active" ? "text-[14px] text-text2" : "text-[12.5px] text-muted",
                    )}
                  >
                    {line.en}
                  </div>
                ) : null}
                {line.note && state === "active" ? (
                  <div className="mt-2 inline-block rounded-full border border-gold/35 bg-gold/10 px-2 py-[2px] text-[9.5px] font-bold uppercase tracking-[0.12em] text-goldsoft">
                    {line.note}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* the edges dissolve, so the words come out of the dark rather than a box */}
        <div className="art-fade-top pointer-events-none absolute inset-x-0 top-0 h-24" aria-hidden />
        <div className="art-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 h-24" aria-hidden />
      </div>

      <footer
        className={clsx(
          "relative z-10 space-y-2 px-4 pb-5 pt-3 transition-opacity duration-500 sm:px-7",
          chrome ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {!timed ? (
          <p className="text-center text-[11.5px] text-muted">
            The publisher did not time these lines, so nothing follows the recording.
          </p>
        ) : null}
        <div className="flex items-center justify-center gap-4">
          <TransportButtons size={46} />
        </div>
        <TimeRow />
      </footer>
    </section>
  );
}
