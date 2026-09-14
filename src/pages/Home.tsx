import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/ui/Icons";
import { PatternArt, AmbientBackdrop } from "../components/art/PatternArt";
import { Chip, Reveal, SectionHeader, useToast } from "../components/ui/Primitives";
import { ArtistCard, CollectionCard, MiniTrack, MoodTile, Rail, RailItem } from "../components/collection/Cards";
import { TrackCardGrid } from "../components/track/TrackViews";
import { Equalizer, PlayFab } from "../components/track/TrackBits";
import { RadialSpectrum } from "../components/player/Visualizer";
import {
  ARTISTS,
  COLLECTIONS,
  MOODS,
  TRACKS,
  artistOf,
  durationOf,
  formatCount,
  getTrack,
  statsFor,
} from "../data/catalog";
import { maqamLabel } from "../lib/theory";
import { clsx } from "clsx";
import { formatTime, greeting, plural, relativeTime } from "../lib/format";
import { useNow } from "../lib/hooks";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import { useUi } from "../store/ui";
import { generateNurMix } from "../lib/nur";
import type { Track } from "../data/types";

/** The featured nasheed changes with the hour — the app has a body clock. */
const HOUR_PICKS: { from: number; to: number; id: string; why: string }[] = [
  { from: 0, to: 4, id: "laylat-al-qadr", why: "the odd nights are the good ones" },
  { from: 4, to: 7, id: "city-of-fajr", why: "the minarets are already awake" },
  { from: 7, to: 12, id: "alhamdulillah", why: "gratitude, before the day gets loud" },
  { from: 12, to: 16, id: "talaa-al-badru", why: "the oldest welcome song we have" },
  { from: 16, to: 19, id: "asma-al-husna", why: "the hour between ʿAṣr and Maghrib" },
  { from: 19, to: 22, id: "nur-ala-nur", why: "light upon light, after ʿIshāʾ" },
  { from: 22, to: 24, id: "sakina", why: "put the day down" },
];

function featuredForHour(hour: number): { track: Track; why: string } {
  const pick = HOUR_PICKS.find((p) => hour >= p.from && hour < p.to) ?? HOUR_PICKS[6]!;
  return { track: getTrack(pick.id) ?? TRACKS[0]!, why: pick.why };
}

export default function Home() {
  const now = useNow(60_000);
  const player = usePlayer();
  const history = useLibrary((s) => s.history);
  const liked = useLibrary((s) => s.liked);
  const playlists = useLibrary((s) => s.playlists);
  const setNur = useUi((s) => s.setNur);
  const toast = useToast();

  const { track: featured, why } = useMemo(() => featuredForHour(now.getHours()), [now]);
  const isFeatured = player.trackId === featured.id;

  const trending = useMemo(
    () => [...TRACKS].sort((a, b) => statsFor(b).plays - statsFor(a).plays).slice(0, 8),
    [],
  );
  const fresh = useMemo(() => [...TRACKS].sort((a, b) => b.year - a.year || b.bpm - a.bpm).slice(0, 10), []);
  const vocalsOnly = useMemo(() => TRACKS.filter((t) => !t.duff), []);
  const recent = useMemo(() => history.slice(0, 10).map((h) => ({ h, track: getTrack(h.id) })).filter((r) => !!r.track) as { h: (typeof history)[number]; track: Track }[], [history]);

  const nurPreview = useMemo(() => generateNurMix({ liked, history, size: 5, seedKey: `home-${now.toDateString()}` }), [liked, history, now]);

  const lovedTracks = useMemo(() => liked.map((id) => getTrack(id)).filter((t): t is Track => !!t), [liked]);
  const featuredLoved = useLibrary((s) => s.liked.includes(featured.id));
  const toggleLike = useLibrary((s) => s.toggleLike);

  return (
    <div className="space-y-11">
      {/* ---------------------------------------------------------- hero */}
      <section className="relative overflow-hidden rounded-3xl border border-line">
        <div className="absolute inset-0 scale-[1.5] opacity-80 blur-[2px]">
          <PatternArt seed={featured.seed} accent={featured.accent} intensity={1.1} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(4,11,9,0.95)] via-[rgba(4,11,9,0.82)] to-[rgba(4,11,9,0.35)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent" />
        <AmbientBackdrop accent={featured.accent} seed="hero" />

        <div className="relative grid gap-8 p-6 md:p-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center">
          <div className="min-w-0">
            <div className="label mb-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-gold">
                <Icon name="clock" size={12} /> {greeting(now)}
              </span>
              <span className="hidden h-px w-6 bg-gold/40 sm:block" />
              <span className="normal-case tracking-normal text-muted">{why}</span>
            </div>

            <Reveal>
              <h1 className="max-w-[16ch] text-[2.4rem] leading-[0.94] text-text sm:text-[3.2rem] lg:text-[3.9rem]">
                {featured.title}
              </h1>
              {featured.titleAr ? (
                <div className="arabic mt-3 text-[1.4rem] text-goldsoft/85 sm:text-[1.8rem]" dir="rtl">
                  {featured.titleAr}
                </div>
              ) : null}
            </Reveal>

            <Reveal delay={80}>
              <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-text2">
                <Link to={`/a/${featured.artistId}`} className="flex items-center gap-2 font-semibold text-text hover:text-jadesoft">
                  <span className="h-6 w-6 overflow-hidden rounded-full ring-1 ring-line2">
                    <PatternArt seed={artistOf(featured).seed} accent={artistOf(featured).accent} showVignette={false} />
                  </span>
                  {artistOf(featured).name}
                </Link>
                <span aria-hidden className="text-muted">·</span>
                <span className="text-muted">{maqamLabel(featured.maqam)}</span>
                <span aria-hidden className="text-muted">·</span>
                <span className="text-muted">{featured.bpm} bpm</span>
                <span aria-hidden className="text-muted">·</span>
                <span className="text-muted">{formatTime(durationOf(featured))}</span>
                <span aria-hidden className="text-muted">·</span>
                <span className="flex items-center gap-1 text-muted">
                  <Icon name="waveform" size={12} /> {formatCount(statsFor(featured).plays)} plays
                </span>
              </div>
              <p className="mt-4 max-w-[54ch] text-[13.5px] leading-relaxed text-text2/85 text-balance-pretty">{featured.blurb}</p>
            </Reveal>

            <Reveal delay={140}>
              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <button
                  className="btn btn-primary !px-6 !py-3.5 !text-[13.5px]"
                  onClick={() => (isFeatured ? player.toggle() : player.playTrack(featured.id, { kind: "home", label: "Featured" }))}
                >
                  <Icon name={isFeatured && player.playing ? "pause" : "play"} size={16} strokeWidth={2.2} />
                  {isFeatured && player.playing ? "Pause" : "Play now"}
                </button>
                <Link to={`/t/${featured.id}`} className="btn btn-ghost !px-5 !py-3.5">
                  <Icon name="lyrics" size={15} /> Read the lyrics
                </Link>
                <button
                  className={clsx("btn !px-4 !py-3.5", featuredLoved ? "btn-gold" : "btn-ghost")}
                  onClick={() => {
                    const nowLiked = toggleLike(featured.id);
                    if (nowLiked === null) return;
                    toast.push({ title: nowLiked ? "Loved" : "Removed from loved", msg: featured.title, kind: nowLiked ? "ok" : "info" });
                  }}
                  aria-pressed={featuredLoved}
                >
                  <Icon name={featuredLoved ? "starFill" : "star"} size={15} />
                  <span className="hidden sm:inline">{featuredLoved ? "Loved" : "Love"}</span>
                </button>
              </div>
            </Reveal>
          </div>

          {/* hero artwork + on-air */}
          <Reveal delay={100} className="relative mx-auto w-full max-w-[340px]">
            <div className="absolute -inset-8">
              <RadialSpectrum radius={0.66} />
            </div>
            <div className="relative aspect-square overflow-hidden rounded-2xl border border-line2 shadow-[0_50px_110px_-40px_rgba(0,0,0,1)]">
              <PatternArt seed={featured.seed} accent={featured.accent} intensity={1} />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-[rgba(3,9,7,0.94)] to-transparent p-4">
                <div>
                  <div className="label mb-1 flex items-center gap-1.5">
                    {isFeatured && player.playing ? <Equalizer bars={3} className="text-jade" /> : <Icon name="mic" size={11} />}
                    {isFeatured && player.playing ? "on air" : "featured"}
                  </div>
                  <div className="text-[12px] text-text2">{featured.voices} · {featured.duff ? "with duff" : "vocals only"}</div>
                </div>
                <PlayFab
                  playing={isFeatured && player.playing}
                  size={44}
                  onClick={() => (isFeatured ? player.toggle() : player.playTrack(featured.id, { kind: "home", label: "Featured" }))}
                />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------ continue */}
      {recent.length ? (
        <Rail
          label="where you left off"
          title="Pick up the thread"
          subtitle={`${plural(history.length, "play", "plays")} logged on this device`}
          action={
            <Link to="/library" className="btn btn-ghost !px-3 !py-1.5">
              Library <Icon name="chevronRight" size={13} />
            </Link>
          }
        >
          {recent.map(({ h, track }, i) => (
            <RailItem key={`${track.id}-${i}`} className="!w-[260px]">
              <button
                className="card group flex w-full items-center gap-3 p-2.5 text-left"
                onClick={() => player.playTrack(track.id, { kind: "home", label: "Recently played" }, recent.map((r) => r.track.id))}
              >
                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-line">
                  <PatternArt seed={track.seed} accent={track.accent} showVignette={false} />
                  <span className="absolute inset-0 grid place-items-center bg-[rgba(3,10,8,0.6)] opacity-0 transition-opacity group-hover:opacity-100">
                    <Icon name="play" size={15} className="text-text" />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-text">{track.title}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {artistOf(track).name} · {relativeTime(h.at)}
                  </span>
                </span>
                {player.trackId === track.id ? <Equalizer active={player.playing} className="text-jade" bars={3} /> : null}
              </button>
            </RailItem>
          ))}
        </Rail>
      ) : null}

      {/* --------------------------------------------------------- moods */}
      <section>
        <SectionHeader
          label="eight ways in"
          title="What are you listening for?"
          subtitle="Moods filter the whole catalogue by tempo, maqām and intent."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {MOODS.map((m, i) => (
            <MoodTile key={m.id} mood={m} index={i} />
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- Nūr */}
      <Reveal>
        <section className="relative overflow-hidden rounded-2xl border border-line2">
          <div className="absolute inset-0 opacity-45">
            <PatternArt seed={nurPreview.seed} accent={nurPreview.accent} motif="rosette" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-[rgba(4,11,9,0.96)] via-[rgba(4,11,9,0.86)] to-[rgba(4,11,9,0.6)]" />
          <div className="relative grid gap-6 p-5 md:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
            <div>
              <div className="label mb-2 flex items-center gap-1.5 text-gold">
                <Icon name="sparkle" size={12} /> on-device curator
              </div>
              <h2 className="text-[1.7rem] leading-tight text-text md:text-[2.1rem]">
                Nūr made you a mix
                <span className="arabic ml-2 text-[1.2rem] text-goldsoft/80" dir="rtl">
                  {nurPreview.titleAr}
                </span>
              </h2>
              <p className="mt-1 font-display text-[17px] text-jadesoft">{nurPreview.title}</p>
              <p className="mt-3 max-w-[52ch] text-[13px] leading-relaxed text-text2/85">{nurPreview.blurb}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="btn btn-gold !px-4 !py-2.5"
                  onClick={() => {
                    player.playIds(nurPreview.trackIds, 0, { kind: "mix", id: nurPreview.id, label: `Nūr · ${nurPreview.title}` });
                  }}
                >
                  <Icon name="play" size={14} strokeWidth={2.2} /> Play the mix
                </button>
                <button className="btn btn-ghost !px-4 !py-2.5" onClick={() => setNur(true)}>
                  <Icon name="sliders" size={14} /> Open Nūr
                </button>
                <button
                  className="btn btn-ghost !px-4 !py-2.5"
                  onClick={() => {
                    void useLibrary.getState().createPlaylist(nurPreview.title, nurPreview.trackIds, nurPreview.blurb).then((pl) => {
                      if (!pl) return;
                      toast.push({ title: "Saved to your sets", msg: pl.name, kind: "ok" });
                    });
                  }}
                >
                  <Icon name="plus" size={14} /> Save as a set
                </button>
              </div>
            </div>
            <ul className="space-y-1">
              {nurPreview.picks.map((pick, i) => (
                <li key={pick.track.id}>
                  <MiniTrack
                    track={pick.track}
                    index={i}
                    queue={nurPreview.trackIds}
                    context={{ kind: "mix", id: nurPreview.id, label: `Nūr · ${nurPreview.title}` }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      </Reveal>

      {/* ----------------------------------------------------- trending */}
      <section>
        <SectionHeader
          label="this week"
          title="Most played nasheeds"
          subtitle="Counted across the whole library of listeners, which is to say: made up, but stable."
          action={
            <Link to="/search" className="btn btn-ghost !px-3 !py-1.5">
              All tracks <Icon name="chevronRight" size={13} />
            </Link>
          }
        />
        <div className="panel rounded-2xl p-2 sm:p-3">
          {trending.map((t, i) => (
            <MiniTrack key={t.id} track={t} index={i} queue={trending.map((x) => x.id)} context={{ kind: "home", label: "Trending" }} />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------- curated sets */}
      <Rail
        label="curated"
        title="Sets worth an evening"
        action={
          <Link to="/library" className="btn btn-ghost !px-3 !py-1.5">
            Library <Icon name="chevronRight" size={13} />
          </Link>
        }
      >
        {COLLECTIONS.map((c, i) => (
          <RailItem key={c.id} className="!w-[240px] sm:!w-[268px]">
            <CollectionCard collection={c} index={i} />
          </RailItem>
        ))}
      </Rail>

      {/* -------------------------------------------------- new releases */}
      <section>
        <SectionHeader label="fresh" title="New from the reciters" subtitle="Sorted by year, then by tempo — the loudest first." />
        <TrackCardGrid tracks={fresh} context={{ kind: "home", label: "New releases" }} />
      </section>

      {/* ------------------------------------------------------- artists */}
      <Rail label="the voices" title="Who is singing" subtitle={`${plural(ARTISTS.length, "reciter")} in the catalogue`}>
        {ARTISTS.map((a, i) => (
          <RailItem key={a.id} className="!w-[158px] sm:!w-[178px]">
            <ArtistCard artist={a} index={i} />
          </RailItem>
        ))}
      </Rail>

      {/* --------------------------------------------------- vocals only */}
      <section>
        <SectionHeader
          label="no drum, no strings"
          title="Vocals only"
          subtitle="For listeners who prefer the voice unaccompanied — every track here has the duff switched off at the source."
        />
        <TrackCardGrid tracks={vocalsOnly} context={{ kind: "home", label: "Vocals only" }} />
      </section>

      {/* ---------------------------------------------------- your stuff */}
      {lovedTracks.length || playlists.length ? (
        <section>
          <SectionHeader label="yours" title="Your library so far" />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Link to="/library" className="card group flex items-center gap-4 p-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-gold/25 to-jade/20 text-gold ring-1 ring-line2">
                <Icon name="starFill" size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-text">Loved nasheeds</span>
                <span className="block text-[12px] text-muted">{lovedTracks.length ? `${lovedTracks.length} saved` : "nothing yet"}</span>
              </span>
              <Icon name="chevronRight" size={16} className="ml-auto text-muted" />
            </Link>
            {playlists.slice(0, 2).map((pl) => {
              const tracks = pl.trackIds.map((id) => getTrack(id)).filter((t): t is Track => !!t);
              return (
                <Link key={pl.id} to={`/p/${pl.id}`} className="card group flex items-center gap-4 p-4">
                  <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-line2">
                    <PatternArt seed={pl.seed} accent={pl.accent} motif="girih" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-text">{pl.name}</span>
                    <span className="block text-[12px] text-muted">
                      {tracks.length} tracks · {formatTime(tracks.reduce((s, t) => s + durationOf(t), 0))}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={16} className="ml-auto text-muted" />
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------- footer */}
      <footer className="pt-2">
        <div className="hairline mb-5" />
        <div className="flex flex-col gap-3 text-[11.5px] leading-relaxed text-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[70ch]">
            CoolNasheed synthesises every performance in your browser from maqām, tempo and syllables — nothing is streamed,
            nothing is uploaded, and no one's recording was touched. Qurʾānic lines are marked and their English renderings are
            meanings, not scripture.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Chip>
              <Icon name="waveform" size={11} /> {TRACKS.length} nasheeds
            </Chip>
            <Chip>
              <Icon name="library" size={11} /> {COLLECTIONS.length} sets
            </Chip>
          </div>
        </div>
      </footer>
    </div>
  );
}
