import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../components/ui/Icons";
import { PatternArt } from "../components/art/PatternArt";
import { EmptyState, Reveal, SectionHeader } from "../components/ui/Primitives";
import { ArtistCard, CollectionCard, Rail, RailItem } from "../components/collection/Cards";
import { TrackList } from "../components/track/TrackViews";
import { ARTISTS, COLLECTIONS, durationOf, formatCount, getArtist, statsFor, tracksByArtist } from "../data/catalog";
import { MAQAMAT, maqamLabel } from "../lib/theory";
import { formatTotal, plural } from "../lib/format";
import { rngFrom, shuffle as shuffled } from "../lib/prng";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";

export default function ArtistPage() {
  const { id } = useParams();
  const artist = getArtist(id);
  const player = usePlayer();
  const followed = useLibrary((s) => (id ? s.followedArtists.includes(id) : false));
  const toggleArtist = useLibrary((s) => s.toggleArtist);

  const tracks = useMemo(() => (id ? tracksByArtist(id) : []), [id]);
  const ids = tracks.map((t) => t.id);

  if (!artist) {
    return (
      <EmptyState
        icon="user"
        title="No such reciter"
        msg="Everyone in this catalogue is fictional, but even they have correct URLs."
        action={
          <Link to="/" className="btn btn-primary mt-2 !px-4 !py-2.5">
            <Icon name="home" size={14} /> Home
          </Link>
        }
      />
    );
  }

  const inArtist = player.trackId ? ids.includes(player.trackId) : false;
  const plays = tracks.reduce((s, t) => s + statsFor(t).plays, 0);
  const duration = tracks.reduce((s, t) => s + durationOf(t), 0);
  const modes = Array.from(new Set(tracks.map((t) => t.maqam)));
  const sets = COLLECTIONS.filter((c) => c.trackIds.some((t) => ids.includes(t)));
  const others = shuffled(rngFrom(artist.seed), ARTISTS.filter((a) => a.id !== artist.id)).slice(0, 6);

  return (
    <div className="space-y-10">
      {/* artist hero */}
      <section className="relative overflow-hidden rounded-3xl border border-line">
        <div className="absolute inset-0 scale-[1.6] opacity-60 blur-[3px]">
          <PatternArt seed={artist.seed} accent={artist.accent} motif="rosette" intensity={1} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-[rgba(4,11,9,0.72)] to-[rgba(4,11,9,0.5)]" />
        <div className="grain absolute inset-0" />

        <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-end md:p-9">
          <Reveal className="shrink-0">
            <div className="relative h-[150px] w-[150px] overflow-hidden rounded-full ring-1 ring-line2 shadow-[0_30px_80px_-30px_rgba(0,0,0,1)] md:h-[186px] md:w-[186px]">
              <PatternArt seed={artist.seed} accent={artist.accent} motif="rosette" />
              <span className="absolute inset-0 rounded-full shadow-[inset_0_0_50px_rgba(0,0,0,0.6)]" />
              {artist.verified ? (
                <span className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line2 bg-elev/90 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-jade backdrop-blur">
                  <Icon name="check" size={10} strokeWidth={2.6} /> verified voice
                </span>
              ) : null}
            </div>
          </Reveal>

          <div className="min-w-0 flex-1">
            <div className="label mb-2 flex items-center gap-2">
              <span className="inline-block h-px w-6 bg-gold/60" /> reciter · {artist.origin}
            </div>
            <Reveal delay={60}>
              <h1 className="text-[2.2rem] leading-none text-text md:text-[3.2rem]">{artist.name}</h1>
              {artist.nameAr ? (
                <div className="arabic mt-2 text-[1.35rem] text-goldsoft/85" dir="rtl">
                  {artist.nameAr}
                </div>
              ) : null}
            </Reveal>
            <Reveal delay={110}>
              <p className="mt-3 max-w-[62ch] text-[13.5px] leading-relaxed text-text2/85 text-balance-pretty">{artist.bio}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted">
                <span className="flex items-center gap-1.5">
                  <Icon name="waveform" size={13} /> {plural(tracks.length, "nasheed")}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="clock" size={13} /> {formatTotal(duration)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="trending" size={13} /> {formatCount(plays)} plays
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="compass" size={13} /> {modes.map((m) => maqamLabel(m)).join(", ") || "—"}
                </span>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                  className="btn btn-primary !px-5 !py-3"
                  onClick={() => {
                    if (inArtist) player.toggle();
                    else player.playIds(ids, 0, { kind: "artist", id: artist.id, label: artist.name });
                  }}
                >
                  <Icon name={inArtist && player.playing ? "pause" : "play"} size={15} strokeWidth={2.2} />
                  {inArtist && player.playing ? "Pause" : "Play all"}
                </button>
                <button
                  className="btn btn-ghost !px-4 !py-3"
                  onClick={() => player.playIds(shuffled(rngFrom(`${artist.seed}-shuffle`), ids), 0, { kind: "artist", id: artist.id, label: artist.name })}
                >
                  <Icon name="shuffle" size={14} /> Shuffle
                </button>
                <button
                  className={clsx("btn !px-4 !py-3", followed ? "btn-gold" : "btn-ghost")}
                  onClick={() => toggleArtist(artist.id)}
                  aria-pressed={followed}
                >
                  <Icon name={followed ? "check" : "plus"} size={14} /> {followed ? "Following" : "Follow"}
                </button>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* mode palette */}
      <Reveal>
        <section className="grid gap-3 rounded-2xl border border-line bg-surface/40 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {modes.length ? (
            modes.map((m) => (
              <div key={m} className="rounded-xl border border-line bg-surface2/40 p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-[19px] text-text">{MAQAMAT[m].name}</span>
                  <span className="arabic text-[14px] text-goldsoft/80" dir="rtl">
                    {MAQAMAT[m].ar}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-muted">{MAQAMAT[m].mood}</p>
                <div className="mt-3 flex items-end gap-[3px]">
                  {MAQAMAT[m].steps.map((step, i) => (
                    <span
                      key={i}
                      className={clsx("flex-1 rounded-sm", Math.abs(step - Math.round(step)) > 0.01 ? "bg-gold/70" : "bg-jade/60")}
                      style={{ height: `${8 + step * 3.4}px` }}
                      title={`${step} semitones above the tonic`}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-[12.5px] text-muted">No tracks catalogued yet.</div>
          )}
        </section>
      </Reveal>

      <section>
        <SectionHeader label="catalogue" title={`Nasheeds by ${artist.name.split(" ")[0]}`} subtitle={`${plural(tracks.length, "track")}, oldest first`} />
        <div className="panel rounded-2xl p-2 sm:p-3">
          <TrackList
            tracks={[...tracks].sort((a, b) => a.year - b.year)}
            context={{ kind: "artist", id: artist.id, label: artist.name }}
          />
        </div>
      </section>

      {sets.length ? (
        <Rail label="appears in" title="Sets that include this voice">
          {sets.map((c, i) => (
            <RailItem key={c.id} className="!w-[240px] sm:!w-[268px]">
              <CollectionCard collection={c} index={i} />
            </RailItem>
          ))}
        </Rail>
      ) : null}

      <Rail label="also in the catalogue" title="Listeners also played">
        {others.map((a, i) => (
          <RailItem key={a.id} className="!w-[158px] sm:!w-[178px]">
            <ArtistCard artist={a} index={i} />
          </RailItem>
        ))}
      </Rail>
    </div>
  );
}
