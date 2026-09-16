import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Icon, type IconName } from "../components/ui/Icons";
import { CoverArt } from "../components/art/CoverArt";
import { EmptyState, Modal, Reveal, SectionHeader, useToast } from "../components/ui/Primitives";
import { ArtistCard, CollectionCard } from "../components/collection/Cards";
import { TrackList } from "../components/track/TrackViews";
import { ARTISTS, COLLECTIONS, durationOf, formatCount, getTrack, statsFor } from "../data/catalog";
import { formatTime, formatTotal, plural, relativeTime } from "../lib/format";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import type { Track } from "../data/types";

type Tab = "loved" | "sets" | "reciters" | "history";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "loved", label: "Loved", icon: "starFill" },
  { id: "sets", label: "Sets", icon: "library" },
  { id: "reciters", label: "Reciters", icon: "user" },
  { id: "history", label: "History", icon: "clock" },
];

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>("loved");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const library = useLibrary();
  const player = usePlayer();
  const toast = useToast();

  const loved = useMemo(
    () => library.liked.map((id) => getTrack(id)).filter((t): t is Track => !!t),
    [library.liked],
  );
  const lovedDuration = loved.reduce((s, t) => s + durationOf(t), 0);
  const sets = useMemo(
    () =>
      library.playlists.map((pl) => ({
        pl,
        tracks: pl.trackIds.map((id) => getTrack(id)).filter((t): t is Track => !!t),
      })),
    [library.playlists],
  );
  const followed = ARTISTS.filter((a) => library.followedArtists.includes(a.id));
  const historyRows = useMemo(
    () => library.history.map((h) => ({ h, track: getTrack(h.id) })).filter((r): r is { h: (typeof library.history)[number]; track: Track } => !!r.track),
    [library.history],
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label mb-1.5">yours</div>
          <h1 className="text-[2rem] leading-none text-text md:text-[2.6rem]">Library</h1>
          <p className="mt-2 text-[13px] text-muted">
            {plural(loved.length, "loved nasheed", "loved nasheeds")} · {plural(sets.length, "set")} ·{" "}
            {plural(followed.length, "reciter")} followed
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary !px-4 !py-2.5" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> New set
          </button>
          {loved.length ? (
            <button
              className="btn btn-ghost !px-4 !py-2.5"
              onClick={() => player.playIds(loved.map((t) => t.id), 0, { kind: "liked", label: "Loved nasheeds" })}
            >
              <Icon name="play" size={14} strokeWidth={2.2} /> Play loved
            </button>
          ) : null}
        </div>
      </div>

      {/* tabs */}
      <div className="no-bar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {TABS.map((t) => {
          const count = t.id === "loved" ? loved.length : t.id === "sets" ? sets.length : t.id === "reciters" ? followed.length : historyRows.length;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                "btn shrink-0 !px-4 !py-2",
                tab === t.id ? "bg-jade/15 text-jadesoft shadow-[inset_0_0_0_1px_var(--c-line-2)]" : "btn-ghost",
              )}
              aria-pressed={tab === t.id}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
              <span className="ml-1 rounded-full bg-surface3 px-1.5 text-[10px] tabular-nums text-muted">{count}</span>
            </button>
          );
        })}
      </div>

      {tab === "loved" ? (
        loved.length ? (
          <section>
            <SectionHeader
              label={`${formatTotal(lovedDuration)} of singing`}
              title="Loved nasheeds"
              action={
                <button
                  className="btn btn-ghost !px-3 !py-1.5"
                  onClick={() => {
                    void library.createPlaylist("Loved nasheeds", loved.map((t) => t.id), "Copied from your loved list.").then((pl) => {
                      if (!pl) return;
                      toast.push({ title: "Copied into a set", msg: pl.name, kind: "ok" });
                    });
                  }}
                >
                  <Icon name="library" size={13} /> Copy to a set
                </button>
              }
            />
            <div className="panel rounded-2xl p-2 sm:p-3">
              <TrackList tracks={loved} context={{ kind: "liked", label: "Loved nasheeds" }} />
            </div>
          </section>
        ) : (
          <EmptyState
            icon="star"
            title="Nothing loved yet"
            msg="Tap the star on any nasheed and it collects here, under your account."
            action={
              <Link to="/" className="btn btn-primary mt-2 !px-4 !py-2.5">
                <Icon name="home" size={14} /> Start browsing
              </Link>
            }
          />
        )
      ) : null}

      {tab === "sets" ? (
        <section className="space-y-8">
          {sets.length ? (
            <>
              <SectionHeader label="yours" title="Your sets" />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {sets.map(({ pl, tracks }, i) => (
                  <Reveal key={pl.id} delay={i * 40}>
                    <Link to={`/p/${pl.id}`} className="card group block overflow-hidden">
                      <div className="over-art relative aspect-[4/3]">
                        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
                          {(tracks.length ? tracks.slice(0, 4) : [null, null, null, null]).map((t, k) =>
                            t ? (
                              <span key={k} className="overflow-hidden">
                                <CoverArt path={t.artworkPath} title={t.title} className="h-full w-full" rounded="sm" />
                              </span>
                            ) : (
                              <span key={k} className="bg-surface3/60" />
                            ),
                          )}
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(3,10,8,0.85)] to-transparent" />
                        <div className="absolute inset-x-3 bottom-2.5">
                          <h3 className="truncate text-[14px] font-semibold text-text">{pl.name}</h3>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 px-3.5 py-3 text-[11.5px] text-muted">
                        <span className="truncate">{tracks.length ? formatTime(tracks.reduce((s, t) => s + durationOf(t), 0)) : "empty"}</span>
                        <span className="shrink-0 tabular-nums">{plural(tracks.length, "track")}</span>
                      </div>
                    </Link>
                  </Reveal>
                ))}
              </div>
            </>
          ) : null}

          <section>
            <SectionHeader label="curated" title="Sets from the editors" subtitle="Not yours, but you can copy any of them into your library." />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {COLLECTIONS.map((c, i) => (
                <CollectionCard key={c.id} collection={c} index={i} />
              ))}
            </div>
          </section>
        </section>
      ) : null}

      {tab === "reciters" ? (
        <section className="space-y-8">
          {followed.length ? (
            <>
              <SectionHeader label="following" title="Your reciters" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {followed.map((a, i) => (
                  <ArtistCard key={a.id} artist={a} index={i} />
                ))}
              </div>
            </>
          ) : (
            <EmptyState icon="user" title="You are not following anyone" msg="Follow a reciter and they will wait for you here." />
          )}
          <section>
            <SectionHeader label="the catalogue" title="Every voice" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {ARTISTS.map((a, i) => (
                <ArtistCard key={a.id} artist={a} index={i} />
              ))}
            </div>
          </section>
        </section>
      ) : null}

      {tab === "history" ? (
        historyRows.length ? (
          <section>
            <SectionHeader
              label="local only"
              title="Play history"
              subtitle="Everything you have played in this browser, most recent first."
              action={
                <button className="btn btn-ghost !px-3 !py-1.5" onClick={() => library.clearHistory()}>
                  <Icon name="trash" size={13} /> Clear
                </button>
              }
            />
            <div className="panel divide-y divide-line overflow-hidden rounded-2xl">
              {historyRows.map(({ h, track }) => (
                <div key={h.id} className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface2/50">
                  <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg ring-1 ring-line">
                    <CoverArt path={track.artworkPath} title={track.title} className="h-full w-full" rounded="sm" />
                  </span>
                  <Link to={`/t/${track.id}`} className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-text group-hover:text-jadesoft">{track.title}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {relativeTime(h.at)} · {plural(h.count, "play")} · {formatCount(statsFor(track).plays)} everywhere
                    </span>
                  </Link>
                  <button
                    className="btn-icon rounded-full p-2 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Play ${track.title}`}
                    onClick={() => player.playTrack(track.id, { kind: "home", label: "History" })}
                  >
                    <Icon name="play" size={15} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <EmptyState icon="clock" title="No history" msg="Play something and it will show up here. Clearing your browser storage clears this too." />
        )
      ) : null}

      <Modal open={creating} onClose={() => setCreating(false)} title="New set" subtitle="A name is enough; you can add tracks later.">
        <div className="space-y-3 p-5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                void library.createPlaylist(name.trim()).then((pl) => {
                  if (!pl) return;
                  setCreating(false);
                  setName("");
                  toast.push({ title: "Set created", msg: pl.name, kind: "ok" });
                });
              }
            }}
            placeholder="e.g. Last ten nights"
            className="w-full rounded-xl border border-line2 bg-bg2 px-3.5 py-2.5 text-[14px] text-text outline-none focus:border-jade/50"
          />
          <div className="flex flex-wrap gap-1.5">
            {["Last ten nights", "Driving dhikr", "For the kids", "Before Fajr", "Long qaṣīdas"].map((s) => (
              <button key={s} className="chip hover:border-line2 hover:text-text" onClick={() => setName(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              className="btn btn-primary flex-1 !py-2.5"
              disabled={!name.trim()}
              onClick={() => {
                void library.createPlaylist(name.trim()).then((pl) => {
                  if (!pl) return;
                  setCreating(false);
                  setName("");
                  toast.push({ title: "Set created", msg: pl.name, kind: "ok" });
                });
              }}
            >
              Create set
            </button>
            <button className="btn btn-ghost !py-2.5" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
