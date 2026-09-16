import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../components/ui/Icons";
import { Avatar } from "../components/art/CoverArt";
import { Chip, EmptyState, Reveal, SectionHeader } from "../components/ui/Primitives";
import { ArtistCard, CollectionCard, Rail, RailItem } from "../components/collection/Cards";
import { TrackList } from "../components/track/TrackViews";
import { ARTISTS, COLLECTIONS, durationOf, formatCount, getArtist, statsFor, tracksByArtist, tracksOf } from "../data/catalog";
import { formatTotal, plural } from "../lib/format";
import { seededShuffle } from "../lib/math";
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
        msg="Nobody publishes under that handle — not yet, and not under a different name."
        action={
          <Link to="/" className="btn btn-primary mt-2 !px-4 !py-2.5">
            <Icon name="home" size={14} /> Home
          </Link>
        }
      />
    );
  }

  const inArtist = player.trackId ? ids.includes(player.trackId) : false;
  const plays = tracks.reduce((sum, t) => sum + statsFor(t).plays, 0);
  const duration = tracks.reduce((sum, t) => sum + durationOf(t), 0);
  const tags = tagSpread(tracks);
  const sets = COLLECTIONS.filter((collection) => tracksOf(collection).some((t) => ids.includes(t.id)));
  const others = seededShuffle(
    ARTISTS.filter((a) => a.id !== artist.id),
    artist.id,
  ).slice(0, 6);

  return (
    <div className="space-y-10">
      {/* ------------------------------------------------------------ hero */}
      <section className="over-art relative overflow-hidden rounded-3xl border border-line">
        <div
          className="absolute inset-0 opacity-70"
          style={{
            background: `radial-gradient(110% 120% at 8% 0%, color-mix(in oklab, var(--c-${artist.accent}) 34%, transparent), transparent 60%)`,
          }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(6,15,12,0.98)] via-[rgba(4,11,9,0.78)] to-[rgba(4,11,9,0.5)]" />
        <div className="grain absolute inset-0" />

        <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-end md:p-9">
          <Reveal className="shrink-0">
            <div className="relative h-[150px] w-[150px] md:h-[186px] md:w-[186px]">
              <Avatar name={artist.name} accent={artist.accent} size={186} className="!h-full !w-full !text-[3.4rem] ring-1 ring-line2" />
              {artist.verified ? (
                <span className="absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line2 bg-elev/90 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-jade backdrop-blur">
                  <Icon name="check" size={10} strokeWidth={2.6} /> verified publisher
                </span>
              ) : null}
            </div>
          </Reveal>

          <div className="min-w-0 flex-1">
            <div className="label mb-2 flex items-center gap-2">
              <span className="inline-block h-px w-6 bg-gold/60" /> {artist.role.toLowerCase()}
              {artist.origin && artist.origin !== "—" ? <> · {artist.origin}</> : null}
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
              {artist.bio ? (
                <p className="mt-3 max-w-[62ch] text-[13.5px] leading-relaxed text-text2/85 text-balance-pretty">{artist.bio}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted">
                <span className="flex items-center gap-1.5">
                  <Icon name="waveform" size={13} /> {plural(tracks.length, "nasheed")}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="clock" size={13} /> {duration ? formatTotal(duration) : "—"}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="trending" size={13} /> {formatCount(plays)} plays
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="user" size={13} /> {formatCount(artist.followers)} following
                </span>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                  className="btn btn-primary !px-5 !py-3"
                  disabled={!tracks.length}
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
                  disabled={!tracks.length}
                  onClick={() => player.playIds(seededShuffle(ids, artist.id), 0, { kind: "artist", id: artist.id, label: artist.name })}
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

      {/* ------------------------------------------------------------ tags */}
      {tags.length ? (
        <Reveal>
          <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/40 p-5">
            <span className="label mr-1">what they recite</span>
            {tags.map((entry) => (
              <Chip key={entry.tag}>
                <Link to={`/search?q=${encodeURIComponent(entry.tag)}`} className="hover:text-text">
                  {entry.tag}
                  <span className="ml-1.5 tabular-nums text-muted">{entry.count}</span>
                </Link>
              </Chip>
            ))}
          </section>
        </Reveal>
      ) : null}

      <section>
        <SectionHeader
          label="catalogue"
          title={`Nasheeds by ${artist.name.split(" ")[0]}`}
          subtitle={tracks.length ? `${plural(tracks.length, "nasheed")}, oldest first` : undefined}
        />
        {tracks.length ? (
          <div className="panel rounded-2xl p-2 sm:p-3">
            <TrackList
              tracks={[...tracks].sort((a, b) => a.title.localeCompare(b.title))}
              context={{ kind: "artist", id: artist.id, label: artist.name }}
            />
          </div>
        ) : (
          <EmptyState icon="waveform" title="Nothing published yet" msg="When this reciter uploads an mp3, it appears here." />
        )}
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

      {others.length ? (
        <Rail label="also in the catalogue" title="Other voices here">
          {others.map((a, i) => (
            <RailItem key={a.id} className="!w-[158px] sm:!w-[178px]">
              <ArtistCard artist={a} index={i} />
            </RailItem>
          ))}
        </Rail>
      ) : null}
    </div>
  );
}

/** Every tag this artist's nasheeds carry, most used first. */
function tagSpread(tracks: { tags: string[] }[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const track of tracks) for (const tag of track.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
