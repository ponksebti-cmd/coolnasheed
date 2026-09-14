import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../components/ui/Icons";
import { PatternArt } from "../components/art/PatternArt";
import { EmptyState, Reveal, SectionHeader, useToast } from "../components/ui/Primitives";
import { RadialSpectrum } from "../components/player/Visualizer";
import { Lyrics, LyricPreview } from "../components/player/Lyrics";
import { TrackCardGrid } from "../components/track/TrackViews";
import { Equalizer, LikeButton, PlayFab } from "../components/track/TrackBits";
import { SpaceMenu } from "../components/player/Transport";
import { MOTIF_LABEL, planArt } from "../lib/art/pattern";
import { TRACKS, artistOf, collectionsOf, durationOf, formatCount, getTrack, statsFor } from "../data/catalog";
import { songFor } from "../lib/song";
import { MAQAMAT, hasQuarterTones, maqamLabel, noteName } from "../lib/theory";
import { formatTime, plural, relativeTime } from "../lib/format";
import { CommentThread } from "../components/track/CommentThread";
import { useCommunity } from "../store/community";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import { rngFrom, shuffle as shuffled } from "../lib/prng";

export default function TrackPage() {
  const { id } = useParams();
  const track = getTrack(id);
  const player = usePlayer();
  const library = useLibrary();
  const thread = useCommunity((s) => (id ? s.threads[id] : undefined));
  const toast = useToast();

  const song = useMemo(() => (track ? songFor(track) : null), [track]);
  const plan = useMemo(() => (track ? planArt(track.seed, track.accent) : null), [track]);

  if (!track || !song || !plan) {
    return (
      <EmptyState
        icon="waveform"
        title="No such nasheed"
        msg="The link points at something that was never recorded, synthesised or imagined."
        action={
          <Link to="/" className="btn btn-primary mt-2 !px-4 !py-2.5">
            <Icon name="home" size={14} /> Home
          </Link>
        }
      />
    );
  }

  const artist = artistOf(track);
  const stats = statsFor(track);
  const noteCount = thread?.total ?? thread?.items.length ?? 0;
  const sets = collectionsOf(track);
  const isCurrent = player.trackId === track.id;
  const moreFromArtist = TRACKS.filter((t) => t.artistId === track.artistId && t.id !== track.id);
  const similar = shuffled(rngFrom(track.seed), TRACKS.filter((t) => t.id !== track.id && (t.maqam === track.maqam || t.artistId === track.artistId || t.tags.some((x) => track.tags.includes(x))))).slice(0, 10);

  const play = () => {
    if (isCurrent) player.toggle();
    else player.playTrack(track.id, { kind: "home", label: track.title }, sets[0]?.trackIds ?? [track.id]);
  };

  return (
    <div className="space-y-10">
      {/* breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-text2">
          Home
        </Link>
        <Icon name="chevronRight" size={12} />
        {sets[0] ? (
          <>
            <Link to={`/c/${sets[0].id}`} className="hover:text-text2">
              {sets[0].title}
            </Link>
            <Icon name="chevronRight" size={12} />
          </>
        ) : null}
        <span className="truncate text-text2">{track.title}</span>
      </nav>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-10">
        {/* ------------------------------------------------ left column */}
        <div className="lg:sticky lg:top-[76px] lg:self-start">
          <Reveal>
            <div className="relative mx-auto w-full max-w-[380px]">
              <div className="absolute -inset-6">
                <RadialSpectrum radius={0.68} />
              </div>
              <div className="relative aspect-square overflow-hidden rounded-2xl border border-line2 shadow-[0_40px_100px_-40px_rgba(0,0,0,1)]">
                <PatternArt seed={track.seed} accent={track.accent} intensity={1} />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-[rgba(3,9,7,0.94)] to-transparent p-4">
                  <div className="min-w-0">
                    <div className="label mb-1">{MOTIF_LABEL[plan.motif]}</div>
                    <div className="truncate text-[12px] text-text2">
                      {isCurrent && player.playing ? (
                        <span className="flex items-center gap-1.5 text-jade">
                          <Equalizer bars={3} /> synthesising live
                        </span>
                      ) : (
                        `${song.notes.length} notes · ${song.lines.length} lines`
                      )}
                    </div>
                  </div>
                  <PlayFab playing={isCurrent && player.playing} onClick={play} size={52} />
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={70}>
            <div className="mt-5">
              <h1 className="text-[1.9rem] leading-tight text-text md:text-[2.3rem]">{track.title}</h1>
              {track.titleAr ? (
                <div className="arabic mt-1.5 text-[1.25rem] text-goldsoft/85" dir="rtl">
                  {track.titleAr}
                </div>
              ) : null}
              <Link to={`/a/${artist.id}`} className="mt-2.5 flex items-center gap-2.5 text-[14px] font-semibold text-text2 hover:text-text">
                <span className="h-7 w-7 overflow-hidden rounded-full ring-1 ring-line2">
                  <PatternArt seed={artist.seed} accent={artist.accent} showVignette={false} />
                </span>
                {artist.name}
                <span className="text-[11.5px] font-normal text-muted">{artist.role}</span>
              </Link>

              <p className="mt-3 text-[13px] leading-relaxed text-muted text-balance-pretty">{track.blurb}</p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button className="btn btn-primary !px-5 !py-3" onClick={play}>
                  <Icon name={isCurrent && player.playing ? "pause" : "play"} size={15} strokeWidth={2.2} />
                  {isCurrent && player.playing ? "Pause" : "Play"}
                </button>
                <button
                  className="btn btn-ghost !px-4 !py-3"
                  onClick={() => {
                    player.setImmersive(true);
                    if (!isCurrent) play();
                  }}
                >
                  <Icon name="lyrics" size={15} /> Full lyrics
                </button>
                <span className="rounded-full border border-line bg-surface2/60">
                  <LikeButton trackId={track.id} size={16} />
                </span>
                <button
                  className="btn-icon grid h-11 w-11 place-items-center rounded-full border border-line bg-surface2/60 text-text2"
                  aria-label="Copy link"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${window.location.origin}/t/${track.id}`);
                      toast.push({ title: "Link copied", kind: "ok" });
                    } catch {
                      toast.push({ title: "Clipboard blocked by the browser", kind: "warn" });
                    }
                  }}
                >
                  <Icon name="share" size={16} />
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  className={clsx("btn !px-3 !py-2", library.settings.duff ? "btn-gold" : "btn-ghost")}
                  onClick={() => player.setDuff(!library.settings.duff)}
                  aria-pressed={library.settings.duff}
                  title="Toggle the frame drum"
                >
                  <Icon name="drum" size={14} />
                  {library.settings.duff ? "Duff on" : "Vocals only"}
                </button>
                <SpaceMenu />
                <span className="chip !normal-case !tracking-normal">
                  <Icon name="mic" size={11} /> {track.voices}
                </span>
              </div>
            </div>
          </Reveal>

          {/* stats */}
          <Reveal delay={120}>
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
              <Cell k="Plays" v={formatCount(stats.plays)} />
              <Cell k="Loved by" v={formatCount(stats.likes)} />
              <Cell k="Maqām" v={maqamLabel(track.maqam)} />
              <Cell k="Tonic" v={noteName(track.root)} />
              <Cell k="Tempo" v={`${track.bpm} bpm`} />
              <Cell k="Length" v={formatTime(durationOf(track))} />
              <Cell k="Bars" v={String(song.bars)} />
              <Cell k="Year" v={String(track.year)} />
            </dl>
          </Reveal>

          {hasQuarterTones(track.maqam) ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-gold/25 bg-gold/[0.06] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-text2">
              <Icon name="info" size={13} className="mt-px shrink-0 text-gold" />
              <span>
                {MAQAMAT[track.maqam].name} uses quarter tones. The synthesiser tunes to fractional semitones, so what you hear
                is not a piano's approximation of it.
              </span>
            </p>
          ) : null}
        </div>

        {/* ------------------------------------------------ right column */}
        <div className="min-w-0 space-y-8">
          <section>
            <SectionHeader
              label="line by line"
              title="Lyrics"
              subtitle={`${plural(song.lines.length, "line")} · follow the voice, or click any line to jump there`}
              action={
                <button className="btn btn-ghost !px-3 !py-1.5" onClick={() => player.setImmersive(true)}>
                  <Icon name="expand" size={13} /> Immersive
                </button>
              }
            />
            <div className="panel relative overflow-hidden rounded-2xl p-4 sm:p-5">
              <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 opacity-[0.10]">
                <PatternArt seed={`${track.seed}-lyrics`} accent={track.accent} motif="mihrab" />
              </div>
              <div className="relative h-[min(66vh,560px)]">
                <Lyrics song={song} variant="inline" />
              </div>
            </div>
          </section>

          {/* opening lines teaser (useful when nothing is playing) */}
          {!isCurrent ? (
            <Reveal>
              <section className="rounded-2xl border border-line bg-surface/50 p-5">
                <div className="label mb-3">how it opens</div>
                <LyricPreview song={song} count={3} />
                <button className="btn btn-ghost mt-4 !px-4 !py-2" onClick={play}>
                  <Icon name="play" size={14} strokeWidth={2.2} /> Hear these lines
                </button>
              </section>
            </Reveal>
          ) : null}

          {/* notes — yours and the room's */}
          <section>
            <SectionHeader
              label="notes"
              title={`${plural(noteCount + stats.comments, "note")}`}
              subtitle="Notes from accounts are real and stay on this device. The rest are generated for the demo, and say so."
            />
            <CommentThread track={track} song={song} />
          </section>

          {sets.length ? (
            <section>
              <div className="label mb-2">in these sets</div>
              <div className="flex flex-wrap gap-2">
                {sets.map((c) => (
                  <Link key={c.id} to={`/c/${c.id}`} className="card flex items-center gap-3 !rounded-xl px-3 py-2.5">
                    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-line">
                      <PatternArt seed={c.seed} accent={c.accent} showVignette={false} />
                    </span>
                    <span className="min-w-0">
                      <span className="block max-w-[22ch] truncate text-[12.5px] font-semibold text-text">{c.title}</span>
                      <span className="block text-[11px] text-muted">{plural(c.trackIds.length, "track")}</span>
                    </span>
                    <Icon name="chevronRight" size={14} className="text-muted" />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {moreFromArtist.length ? (
            <section>
              <SectionHeader
                label={`more from ${artist.name}`}
                title="Same voice, other weather"
                action={
                  <Link to={`/a/${artist.id}`} className="btn btn-ghost !px-3 !py-1.5">
                    Artist page <Icon name="chevronRight" size={13} />
                  </Link>
                }
              />
              <TrackCardGrid tracks={moreFromArtist} context={{ kind: "artist", id: artist.id, label: artist.name }} />
            </section>
          ) : null}

          <section>
            <SectionHeader label="you may also want" title="Nearby in mode and mood" subtitle="Shuffled from the same seed every time, so it looks curated. It is." />
            <TrackCardGrid tracks={similar} context={{ kind: "home", label: `Similar to ${track.title}` }} />
          </section>

          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
            <Icon name="info" size={13} className="mt-px shrink-0" />
            <span>
              Last played on this device {library.history.find((h) => h.id === track.id) ? relativeTime(library.history.find((h) => h.id === track.id)!.at) : "never"} ·{" "}
              {library.history.find((h) => h.id === track.id)?.count ?? 0} {plural(library.history.find((h) => h.id === track.id)?.count ?? 0, "time")}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-surface px-3.5 py-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{k}</dt>
      <dd className="mt-0.5 truncate text-[13.5px] font-semibold text-text">{v}</dd>
    </div>
  );
}
