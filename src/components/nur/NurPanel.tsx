import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/Icons";
import { Chip, useToast } from "../ui/Primitives";
import { ArtThumb } from "../track/TrackBits";
import { PatternArt } from "../art/PatternArt";
import { ARTISTS, artistOf, durationOf, formatCount, statsFor } from "../../data/catalog";
import { formatTime, formatTotal } from "../../lib/format";
import { maqamLabel, type MaqamName } from "../../lib/theory";
import { buildTaste, dominantMood, generateNurMix, NUR_MOODS, NUR_VOICE, type NurMix } from "../../lib/nur";
import { useLibrary } from "../../store/library";
import { usePlayer } from "../../store/player";
import { useUi } from "../../store/ui";
import { useBodyScrollLock } from "../../lib/hooks";

export function NurPanel() {
  const open = useUi((s) => s.nurOpen);
  const setNur = useUi((s) => s.setNur);
  const liked = useLibrary((s) => s.liked);
  const history = useLibrary((s) => s.history);
  const createPlaylist = useLibrary((s) => s.createPlaylist);
  const playIds = usePlayer((s) => s.playIds);
  const toast = useToast();
  const [moodId, setMoodId] = useState<string | null>(null);
  const [mix, setMix] = useState<NurMix | null>(null);
  const [thinking, setThinking] = useState(false);
  const [voice] = useState(() => NUR_VOICE[Math.floor(Math.random() * NUR_VOICE.length)]!);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNur(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setNur]);

  const taste = useMemo(() => buildTaste(liked, history), [liked, history]);
  const dominant = useMemo(() => dominantMood(taste), [taste]);
  const topTags = useMemo(
    () => Object.entries(taste.tags).sort((a, b) => b[1] - a[1]).slice(0, 6),
    [taste],
  );
  const topMaqam = useMemo(
    () => Object.entries(taste.maqam).sort((a, b) => b[1] - a[1]).slice(0, 4),
    [taste],
  );
  const topArtists = useMemo(
    () => Object.entries(taste.artists).sort((a, b) => b[1] - a[1]).slice(0, 3),
    [taste],
  );

  const generate = (mood?: string | null) => {
    setThinking(true);
    // a beat of theatre; the model is local and instant
    window.setTimeout(() => {
      const next = generateNurMix({
        liked,
        history,
        moodId: mood ?? moodId ?? undefined,
        size: 8,
        seedKey: `${mood ?? moodId ?? dominant.id}-${Math.floor(Date.now() / 60000)}`,
      });
      setMix(next);
      setThinking(false);
    }, 420);
  };

  useEffect(() => {
    if (open && !mix && !thinking) generate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex justify-end veil-enter" role="dialog" aria-modal="true" aria-label="Nūr curator">
      <div className="absolute inset-0 bg-[rgba(3,9,7,0.6)] backdrop-blur-sm" onClick={() => setNur(false)} aria-hidden />
      <aside className="relative flex h-full w-full max-w-[420px] flex-col border-l border-line2 bg-bg2/97 shadow-[-40px_0_120px_-40px_rgba(0,0,0,1)] toast-enter">
        {/* header */}
        <div className="relative shrink-0 overflow-hidden border-b border-line px-5 pb-4 pt-5">
          <div className="absolute -right-10 -top-14 h-44 w-44 opacity-40 blur-[1px]">
            <PatternArt seed="nur-panel" accent="gold" motif="rosette" />
          </div>
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="label mb-1.5 flex items-center gap-1.5">
                <Icon name="sparkle" size={12} className="text-gold" /> on-device curator
              </div>
              <h2 className="font-display text-[26px] leading-none text-text">
                Nūr <span className="arabic ml-1 text-[18px] text-goldsoft/80" dir="rtl">نور</span>
              </h2>
              <p className="mt-2 max-w-[300px] text-[12px] leading-relaxed text-muted">{voice}</p>
            </div>
            <button className="btn-icon rounded-full p-2" onClick={() => setNur(false)} aria-label="Close Nūr">
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>

        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* taste */}
          <section className="mb-5">
            <div className="label mb-2">What I think you like</div>
            {taste.plays < 1 ? (
              <p className="rounded-xl border border-dashed border-line2 px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
                Nothing yet — my notebook is blank. Love a few nasheeds or just play something and I will start guessing.
                Until then I will assume you want <span className="text-jade">{dominant.label}</span>, because everyone does at first.
              </p>
            ) : (
              <div className="space-y-2.5">
                {topTags.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {topTags.map(([tag, w]) => (
                      <span key={tag} className="chip !normal-case !tracking-normal" title={`weight ${w.toFixed(1)}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-jade" style={{ opacity: Math.min(1, w / 4) }} />
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-line bg-surface2/40 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Modes</div>
                    <div className="mt-1 space-y-1">
                      {topMaqam.length ? (
                        topMaqam.map(([m, w]) => (
                          <div key={m} className="flex items-center gap-2">
                            <span className="w-16 shrink-0 truncate text-[11.5px] text-text2">{maqamLabel(m as MaqamName)}</span>
                            <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface3">
                              <span className="block h-full rounded-full bg-gradient-to-r from-jadedeep to-jade" style={{ width: `${Math.min(100, (w / (topMaqam[0]?.[1] ?? 1)) * 100)}%` }} />
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="text-[11.5px] text-muted">no preference yet</div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-surface2/40 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Tempo</div>
                    <div className="mt-1 font-display text-xl text-text">
                      {taste.bpm.weight ? `${Math.round(taste.bpm.sum / taste.bpm.weight)}` : "—"}
                      <span className="ml-1 text-[11px] font-sans text-muted">bpm</span>
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-muted">
                      {taste.bpm.weight ? (taste.bpm.sum / taste.bpm.weight) < 70 ? "you like it slow" : (taste.bpm.sum / taste.bpm.weight) > 88 ? "you like a pulse" : "middle of the road" : "no data"}
                    </div>
                  </div>
                </div>
                {topArtists.length ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                    <span className="label">Reciters</span>
                    {topArtists.map(([id]) => (
                      <span key={id} className="rounded-full border border-line px-2 py-0.5 text-text2">
                        {ARTISTS.find((a) => a.id === id)?.name ?? id}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {/* mood */}
          <section className="mb-5">
            <div className="label mb-2">Set a mood</div>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={moodId === null} onClick={() => setMoodId(null)}>
                whatever I feel like
              </Chip>
              {NUR_MOODS.map((m) => (
                <Chip key={m.id} active={moodId === m.id} onClick={() => setMoodId(m.id)}>
                  {m.label}
                </Chip>
              ))}
            </div>
          </section>

          {/* mix */}
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="label">Tonight's mix</span>
              <button className="btn btn-ghost !px-2.5 !py-1.5" onClick={() => generate()} disabled={thinking}>
                <Icon name="repeat" size={13} /> regenerate
              </button>
            </div>

            {thinking ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-surface2/30 p-2.5">
                    <span className="h-9 w-9 animate-pulse rounded-lg bg-surface3" />
                    <span className="h-3 flex-1 animate-pulse rounded bg-surface3" style={{ animationDelay: `${i * 90}ms` }} />
                  </div>
                ))}
              </div>
            ) : mix ? (
              <div className="overflow-hidden rounded-2xl border border-line2">
                <div className="relative overflow-hidden p-4">
                  <div className="absolute inset-0 opacity-70">
                    <PatternArt seed={mix.seed} accent={mix.accent} />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-[rgba(4,11,9,0.95)] via-[rgba(4,11,9,0.7)] to-[rgba(4,11,9,0.45)]" />
                  <div className="relative">
                    <div className="label mb-1">{mix.mood} · {mix.trackIds.length} tracks · {formatTotal(mix.duration)}</div>
                    <h3 className="font-display text-[22px] leading-tight text-text">{mix.title}</h3>
                    <div className="arabic mt-0.5 text-[14px] text-goldsoft/85" dir="rtl">
                      {mix.titleAr}
                    </div>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-text2/90">{mix.blurb}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="btn btn-primary !px-4 !py-2"
                        onClick={() => {
                          playIds(mix.trackIds, 0, { kind: "mix", id: mix.id, label: `Nūr · ${mix.title}` });
                          setNur(false);
                        }}
                      >
                        <Icon name="play" size={14} strokeWidth={2.2} /> Play mix
                      </button>
                      <button
                        className="btn btn-ghost !px-3.5 !py-2"
                        onClick={() => {
                          void createPlaylist(mix.title, mix.trackIds, mix.blurb).then((pl) => {
                            if (!pl) return;
                            toast.push({ title: "Saved as a set", msg: pl.name, kind: "ok" });
                          });
                        }}
                      >
                        <Icon name="plus" size={14} /> Save
                      </button>
                    </div>
                  </div>
                </div>

                <ul className="divide-y divide-line">
                  {mix.picks.map((pick, i) => (
                    <li key={pick.track.id} className="group flex items-start gap-3 p-3 transition-colors hover:bg-surface2/50">
                      <span className="mt-1 w-4 shrink-0 text-[11px] tabular-nums text-muted">{i + 1}</span>
                      <ArtThumb track={pick.track} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-text">{pick.track.title}</span>
                          <span className="shrink-0 text-[10.5px] tabular-nums text-muted">{formatTime(durationOf(pick.track))}</span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted">
                          {artistOf(pick.track).name} · {maqamLabel(pick.track.maqam)} · {formatCount(statsFor(pick.track).plays)} plays
                        </div>
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-text2/80">{pick.reason}</p>
                      </div>
                      <button
                        className="btn-icon mt-1 shrink-0 rounded-full p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={`Play ${pick.track.title}`}
                        onClick={() => {
                          playIds(mix.trackIds, i, { kind: "mix", id: mix.id, label: `Nūr · ${mix.title}` });
                          setNur(false);
                        }}
                      >
                        <Icon name="play" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-muted">
            <Icon name="info" size={13} className="mt-px shrink-0" />
            <span>
              Nūr is a scoring function plus a template writer, running entirely in this tab. It reads your loves and play
              history from local storage and nothing leaves the device. The opinions are synthetic; the maqām theory is real.
            </span>
          </p>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
