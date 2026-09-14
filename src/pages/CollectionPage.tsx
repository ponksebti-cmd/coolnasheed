import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Icon } from "../components/ui/Icons";
import { EmptyState, Reveal, SectionHeader } from "../components/ui/Primitives";
import { HeroPanel } from "../components/collection/HeroPanel";
import { CollectionCard, Rail, RailItem } from "../components/collection/Cards";
import { TrackList } from "../components/track/TrackViews";
import { COLLECTIONS, artistOf, formatCount, getCollection, statsFor, tracksOf } from "../data/catalog";
import { maqamLabel } from "../lib/theory";
import { plural } from "../lib/format";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import { shuffle as shuffled, rngFrom } from "../lib/prng";

export default function CollectionPage() {
  const { id } = useParams();
  const collection = getCollection(id);
  const player = usePlayer();
  const library = useLibrary();

  const tracks = useMemo(() => (collection ? tracksOf(collection) : []), [collection]);
  const ids = useMemo(() => tracks.map((t) => t.id), [tracks]);

  if (!collection) {
    return (
      <EmptyState
        icon="library"
        title="That set does not exist"
        msg="It may have been renamed, or the link may have come from a dream."
        action={
          <Link to="/library" className="btn btn-primary mt-2 !px-4 !py-2.5">
            <Icon name="library" size={14} /> Back to the library
          </Link>
        }
      />
    );
  }

  const inSet = player.trackId ? ids.includes(player.trackId) : false;
  const saved = library.likedCollections.includes(collection.id);
  const totalPlays = tracks.reduce((sum, t) => sum + statsFor(t).plays, 0);
  const maqams = Array.from(new Set(tracks.map((t) => maqamLabel(t.maqam))));
  const artists = Array.from(new Set(tracks.map((t) => artistOf(t).name)));
  const related = COLLECTIONS.filter((c) => c.id !== collection.id && c.tags.some((t) => collection.tags.includes(t))).slice(0, 6);
  const order = shuffled(rngFrom(collection.seed), ids);

  return (
    <div className="space-y-10">
      <HeroPanel
        eyebrow={`${collection.kind === "album" ? "album" : "selection"} · ${collection.year}`}
        title={collection.title}
        titleAr={collection.titleAr}
        curator={collection.curator}
        blurb={collection.blurb}
        seed={collection.seed}
        accent={collection.accent}
        tracks={tracks}
        playing={inSet && player.playing}
        onPlay={() => {
          if (inSet) player.toggle();
          else player.playIds(ids, 0, { kind: "collection", id: collection.id, label: collection.title });
        }}
        liked={saved}
        onLike={() => library.toggleCollection(collection.id)}
        actions={[
          {
            label: "Shuffle",
            icon: "shuffle",
            onClick: () => player.playIds(order, 0, { kind: "collection", id: collection.id, label: `${collection.title} (shuffled)` }),
          },
        ]}
      >
        <span aria-hidden className="text-muted">·</span>
        <span className="tabular-nums">{formatCount(totalPlays)} plays</span>
        <span aria-hidden className="text-muted">·</span>
        <span className="truncate">{maqams.join(", ")}</span>
      </HeroPanel>

      <section>
        <SectionHeader
          label="tracklist"
          title={collection.title}
          subtitle={`${plural(tracks.length, "track")} · ${plural(artists.length, "reciter")} · ${maqams.length} maqāmāt`}
          action={
            <div className="flex items-center gap-2">
              <button
                className="btn btn-ghost !px-3.5 !py-2"
                onClick={() => {
                  void library.createPlaylist(collection.title, ids, collection.blurb);
                }}
              >
                <Icon name="plus" size={14} /> Copy to my sets
              </button>
            </div>
          }
        />
        <div className="panel rounded-2xl p-2 sm:p-3">
          <TrackList tracks={tracks} context={{ kind: "collection", id: collection.id, label: collection.title }} />
        </div>
      </section>

      <Reveal>
        <section className="grid gap-3 rounded-2xl border border-line bg-surface/40 p-5 md:grid-cols-3">
          <Stat label="Reciters" value={artists.length} detail={artists.slice(0, 3).join(" · ")} icon="user" />
          <Stat label="Modes used" value={maqams.length} detail={maqams.slice(0, 4).join(" · ")} icon="compass" />
          <Stat
            label="With duff"
            value={tracks.filter((t) => t.duff).length}
            detail={`${tracks.filter((t) => !t.duff).length} vocals only`}
            icon="drum"
          />
        </section>
      </Reveal>

      {related.length ? (
        <Rail label="keep going" title="Sets in the same weather">
          {related.map((c, i) => (
            <RailItem key={c.id} className="!w-[240px] sm:!w-[268px]">
              <CollectionCard collection={c} index={i} />
            </RailItem>
          ))}
        </Rail>
      ) : null}
    </div>
  );
}

function Stat({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: "user" | "compass" | "drum" }) {
  return (
    <div>
      <div className="label mb-1.5 flex items-center gap-1.5">
        <Icon name={icon} size={12} className="text-gold" /> {label}
      </div>
      <div className="font-display text-[30px] leading-none text-text">{value}</div>
      <div className="mt-1.5 truncate text-[11.5px] text-muted">{detail}</div>
    </div>
  );
}
