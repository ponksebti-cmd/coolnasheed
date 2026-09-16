import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../components/ui/Icons";
import { Chip, EmptyState, Reveal, SectionHeader, useToast } from "../components/ui/Primitives";
import { ArtistCard, CollectionCard, MiniTrack, Rail, RailItem } from "../components/collection/Cards";
import { TrackCardGrid } from "../components/track/TrackViews";
import { Equalizer, PlayFab } from "../components/track/TrackBits";
import { CoverArt } from "../components/art/CoverArt";
import {
  ARTISTS,
  COLLECTIONS,
  TRACKS,
  artistOf,
  durationOf,
  formatCount,
  getTrack,
  latestSongs,
  popularSongs,
  statsFor,
} from "../data/catalog";
import { api } from "../lib/api";
import { formatTime, greeting, plural, relativeTime } from "../lib/format";
import { useCatalogVersion, useNow } from "../lib/hooks";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import { useBoot } from "../lib/boot";
import type { Track } from "../data/types";

export default function Home() {
  const now = useNow(60_000);
  const version = useCatalogVersion();
  const boot = useBoot();
  const player = usePlayer();
  const history = useLibrary((s) => s.history);
  const liked = useLibrary((s) => s.liked);
  const playlists = useLibrary((s) => s.playlists);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const toast = useToast();

  /* real play counts, asked of the server — not a number this app invented */
  const [trending, setTrending] = useState<Track[]>([]);

  useEffect(() => {
    let live = true;
    void api
      .trending("7d", 10)
      .then((res) => {
        if (!live) return;
        setTrending(res.rows.map((row) => getTrack(row.songId)).filter((t): t is Track => !!t));
      })
      .catch(() => {
        if (live) setTrending([]);
      });
    return () => {
      live = false;
    };
  }, [version]);

  const latest = useMemo(() => latestSongs(10), [version]);
  const featured = useMemo(() => trending[0] ?? latest[0] ?? null, [trending, latest]);
  /* six, not eight: the chart says what is being played, it is not the page */
  const popular = useMemo(
    () => (trending.length ? trending.slice(0, 6) : popularSongs(6)),
    [trending, version],
  );
  const featuredLoved = useLibrary((s) => (featured ? s.liked.includes(featured.id) : false));
  const recent = useMemo(
    () =>
      history
        .slice(0, 10)
        .map((entry) => ({ entry, track: getTrack(entry.id) }))
        .filter((row): row is { entry: (typeof history)[number]; track: Track } => !!row.track),
    [history],
  );
  const lovedTracks = useMemo(() => liked.map((id) => getTrack(id)).filter((t): t is Track => !!t), [liked]);

  /* ------------------------------------------------------------------ empty */
  if (!TRACKS.length) {
    const loading = !boot;
    return (
      <div className="space-y-6">
        <EmptyState
          icon={loading ? "clock" : boot?.needsSetup ? "server" : boot?.error ? "cloudOff" : "upload"}
          title={
            loading
              ? "Reading the catalogue…"
              : boot?.needsSetup
                ? "The database has no schema yet"
                : boot?.error
                  ? "The catalogue would not load"
                  : "Nothing published yet"
          }
          msg={
            loading
              ? "One request to the backend. Until it answers, the app does not pretend to know what is in the catalogue."
              : boot?.error
                ? boot.error
                : "This project has no nasheeds in it. Upload an mp3 with an account, and it will be the first thing on this page — there is no bundled demo catalogue behind it."
          }
          action={
            boot?.needsSetup || boot?.error ? (
              <Link to="/about" className="btn btn-ghost mt-2 !px-4 !py-2.5">
                <Icon name="info" size={14} /> What the app expects
              </Link>
            ) : (
              <Link to="/studio" className="btn btn-primary mt-2 !px-4 !py-2.5">
                <Icon name="upload" size={14} /> Publish a nasheed
              </Link>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-11">
      {/* ---------------------------------------------------------- hero */}
      {featured ? (
        <section className="over-art relative overflow-hidden rounded-3xl border border-line">
          <div
            className="absolute inset-0 opacity-70"
            style={{
              background: `radial-gradient(120% 120% at 12% 0%, color-mix(in oklab, var(--c-jade) 40%, transparent), transparent 62%)`,
            }}
            aria-hidden
          />
          <div className="art-scrim-side absolute inset-0" />
          <div className="grain absolute inset-0" />

          <div className="relative grid gap-8 p-6 md:p-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center">
            <div className="min-w-0">
              <div className="label mb-3 flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-gold">
                  <Icon name="clock" size={12} /> {greeting(now)}
                </span>
                <span className="hidden h-px w-6 bg-gold/40 sm:block" />
                <span className="normal-case tracking-normal text-muted">
                  {trending.length ? "most played this week" : "newest in the catalogue"}
                </span>
              </div>

              <Reveal>
                <h1 className="max-w-[16ch] text-[2.4rem] leading-[0.94] text-text sm:text-[3.2rem] lg:text-[3.9rem]">{featured.title}</h1>
                {featured.titleAr ? (
                  <div className="arabic mt-3 text-[1.4rem] text-goldsoft/85 sm:text-[1.8rem]" dir="rtl">
                    {featured.titleAr}
                  </div>
                ) : null}
              </Reveal>

              <Reveal delay={80}>
                <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-text2">
                  <Link to={`/a/${artistOf(featured).id}`} className="flex items-center gap-2 font-semibold text-text hover:text-jadesoft">
                    <CoverArt path={featured.artworkPath} title={featured.title} rounded="full" className="h-6 w-6" />
                    {artistOf(featured).name}
                  </Link>
                  <span aria-hidden className="text-muted">·</span>
                  <span className="text-muted">{formatTime(durationOf(featured))}</span>
                  <span aria-hidden className="text-muted">·</span>
                  <span className="flex items-center gap-1 text-muted">
                    <Icon name="waveform" size={12} /> {formatCount(statsFor(featured).plays)} plays
                  </span>
                </div>
                {featured.note ? (
                  <p className="mt-4 max-w-[54ch] text-[13.5px] leading-relaxed text-text2/85 text-balance-pretty">{featured.note}</p>
                ) : null}
              </Reveal>

              <Reveal delay={140}>
                <div className="mt-6 flex flex-wrap items-center gap-2.5">
                  <button
                    className="btn btn-primary !px-6 !py-3.5 !text-[13.5px]"
                    onClick={() => (player.trackId === featured.id ? player.toggle() : player.playTrack(featured.id, { kind: "home", label: "Featured" }, latest.map((t) => t.id)))}
                  >
                    <Icon name={player.trackId === featured.id && player.playing ? "pause" : "play"} size={16} strokeWidth={2.2} />
                    {player.trackId === featured.id && player.playing ? "Pause" : "Play now"}
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

            <Reveal delay={100} className="relative mx-auto w-full max-w-[340px]">
              <div className="over-art shadow-art relative aspect-square overflow-hidden rounded-2xl border border-line2">
                <CoverArt path={featured.artworkPath} title={featured.title} className="h-full w-full" rounded="lg" />
                <div className="art-scrim-up absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
                  <div>
                    <div className="label mb-1 flex items-center gap-1.5">
                      {player.trackId === featured.id && player.playing ? <Equalizer bars={3} className="text-jade" /> : <Icon name="mic" size={11} />}
                      {player.trackId === featured.id && player.playing ? "playing" : "featured"}
                    </div>
                    <div className="text-[12px] text-text2">
                      {artistOf(featured).name}
                    </div>
                  </div>
                  <PlayFab
                    playing={player.trackId === featured.id && player.playing}
                    size={44}
                    onClick={() => (player.trackId === featured.id ? player.toggle() : player.playTrack(featured.id, { kind: "home", label: "Featured" }, latest.map((t) => t.id)))}
                  />
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------ continue */}
      {recent.length ? (
        <Rail
          label="where you left off"
          title="Pick up the thread"
          subtitle={`${plural(history.length, "play", "plays")} in your history`}
          action={
            <Link to="/library" className="btn btn-ghost !px-3 !py-1.5">
              Library <Icon name="chevronRight" size={13} />
            </Link>
          }
        >
          {recent.map(({ entry, track }, i) => (
            <RailItem key={`${track.id}-${i}`} className="!w-[260px]">
              <button
                className="card group flex w-full items-center gap-3 p-2.5 text-left"
                onClick={() => player.playTrack(track.id, { kind: "home", label: "Recently played" }, recent.map((r) => r.track.id))}
              >
                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-line">
                  <CoverArt path={track.artworkPath} title={track.title} className="h-full w-full" rounded="sm" />
                  <span className="over-art art-wash absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                    <Icon name="play" size={15} className="text-text" />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-text">{track.title}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {artistOf(track).name} · {relativeTime(entry.at)}
                  </span>
                </span>
                {player.trackId === track.id ? <Equalizer active={player.playing} className="text-jade" bars={3} /> : null}
              </button>
            </RailItem>
          ))}
        </Rail>
      ) : null}

      {/* ----------------------------------------------------- trending */}
      <section>
        <SectionHeader
          label="this week"
          title="Most played"
          subtitle={trending.length ? "Counted from real plays in the last seven days." : "No plays recorded in the last seven days yet."}
          action={
            <Link to="/search" className="btn btn-ghost !px-3 !py-1.5">
              Everything <Icon name="chevronRight" size={13} />
            </Link>
          }
        />
        {popular.length ? (
          <div className="panel grid gap-1 rounded-2xl p-2 sm:grid-cols-2 sm:p-3">
            {popular.map((t, i) => (
              <MiniTrack
                key={t.id}
                track={t}
                index={i}
                dense
                queue={popular.map((x) => x.id)}
                context={{ kind: "home", label: "Most played" }}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon="trending" title="Nothing charted this week" msg="Play counts appear here once people listen." />
        )}
      </section>

      {/* ------------------------------------------------- curated sets */}
      {COLLECTIONS.length ? (
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
      ) : null}

      {/* -------------------------------------------------- new releases */}
      {latest.length ? (
        <section>
          <SectionHeader label="fresh" title="Newly published" subtitle="Newest uploads first." />
          <TrackCardGrid tracks={latest} context={{ kind: "home", label: "Newly published" }} />
        </section>
      ) : null}

      {/* ------------------------------------------------------- artists */}
      {ARTISTS.length ? (
        <Rail label="the voices" title="Who is publishing" subtitle={`${plural(ARTISTS.length, "publisher")} in the catalogue`}>
          {ARTISTS.map((a, i) => (
            <RailItem key={a.id} className="!w-[158px] sm:!w-[178px]">
              <ArtistCard artist={a} index={i} />
            </RailItem>
          ))}
        </Rail>
      ) : null}

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
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-surface2 ring-1 ring-line2">
                    <Icon name="library" size={19} className="text-muted" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-text">{pl.name}</span>
                    <span className="block text-[12px] text-muted">
                      {plural(tracks.length, "nasheed")} · {formatTime(tracks.reduce((sum, t) => sum + durationOf(t), 0))}
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
            Every nasheed here is a real recording, uploaded by the publisher who made it and streamed as an mp3. CoolNasheed
            writes no music of its own, invents no counters and keeps nothing on your device. Qurʾānic lines are marked, and their
            English renderings are meanings, not scripture.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Chip>
              <Icon name="waveform" size={11} /> {plural(TRACKS.length, "nasheed")}
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
