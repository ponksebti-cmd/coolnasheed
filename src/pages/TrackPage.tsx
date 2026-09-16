/**
 * One nasheed.
 *
 * The recording, its words, what people said underneath it, and the rest of what its
 * publisher has recorded. Every number on this page is a counter the database keeps.
 */

import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../components/ui/Icons";
import { CoverArt } from "../components/art/CoverArt";
import { EmptyState, Reveal, SectionHeader, useToast } from "../components/ui/Primitives";
import { Lyrics, LyricPreview } from "../components/player/Lyrics";
import { TrackCardGrid, TrackList } from "../components/track/TrackViews";
import { Equalizer, LikeButton, PlayFab, TrackMenu } from "../components/track/TrackBits";
import { TRACKS, artistOf, collectionsOf, durationOf, formatCount, getTrack, statsFor } from "../data/catalog";
import { formatTime, plural, relativeTime } from "../lib/format";
import { CommentThread } from "../components/track/CommentThread";
import { useCommunity } from "../store/community";
import { usePlayer } from "../store/player";
import { seededShuffle } from "../lib/math";
import type { Song } from "../../shared/types";

export default function TrackPage() {
  const { id } = useParams();
  const track = getTrack(id);
  const player = usePlayer();
  const thread = useCommunity((s) => (id ? s.threads[id] : undefined));
  const loadThread = useCommunity((s) => s.loadThread);
  const toast = useToast();

  const sets = useMemo(() => (track ? collectionsOf(track) : []), [track]);
  const related = useMemo(() => {
    if (!track) return [];
    const artist = artistOf(track);
    const byArtist = TRACKS.filter((other) => other.id !== track.id && other.ownerId === artist.profileId);
    const byTag = TRACKS.filter(
      (other) => other.id !== track.id && other.ownerId !== artist.profileId && other.tags.some((tag) => track.tags.includes(tag)),
    );
    const rest = TRACKS.filter((other) => other.id !== track.id && !byArtist.includes(other) && !byTag.includes(other));
    return [...byArtist, ...byTag, ...seededShuffle(rest, track.id)].slice(0, 12);
  }, [track?.id, TRACKS.length]);

  if (!track) {
    return (
      <EmptyState
        icon="waveform"
        title="No such nasheed"
        msg="Nothing in the catalogue has that id — the link may be old, or the recording may have been taken down."
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
  const moreFromArtist = TRACKS.filter((other) => other.ownerId === track.ownerId && other.id !== track.id);
  const isCurrent = player.trackId === track.id;
  const queueIds = related.length ? related.map((other) => other.id) : [track.id];

  const play = () => {
    if (isCurrent) player.toggle();
    else player.playTrack(track.id, { kind: "home", label: track.title }, [track.id, ...moreFromArtist.map((t) => t.id)]);
  };

  return (
    <div className="space-y-10">
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
              <div className="over-art shadow-art relative aspect-square overflow-hidden rounded-2xl border border-line2">
                <CoverArt path={track.artworkPath} title={track.title} className="h-full w-full" rounded="md" />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-[rgba(3,9,7,0.94)] to-transparent p-4">
                  <div className="min-w-0">
                    <div className="label mb-1">{track.status === "live" ? "recording" : "taken down"}</div>
                    <div className="truncate text-[12px] text-text2">
                      {isCurrent && player.playing ? (
                        <span className="flex items-center gap-1.5 text-jade">
                          <Equalizer bars={3} /> playing
                        </span>
                      ) : (
                        `${formatTime(durationOf(track))} · ${plural(track.lines.length, "line")}`
                      )}
                    </div>
                  </div>
                  <PlayFab playing={isCurrent && player.playing} onClick={play} size={52} label={`Play ${track.title}`} />
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
                <span className="grid h-7 w-7 place-items-center rounded-full border border-line2 bg-surface2/60 text-[11px]">
                  {artist.name.slice(0, 1).toUpperCase()}
                </span>
                {artist.name}
                {artist.verified ? <Icon name="check" size={13} className="text-jade" /> : null}
              </Link>

              {track.note ? <p className="mt-3 max-w-prose text-[13px] leading-relaxed text-muted">{track.note}</p> : null}

              <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-muted">
                <span className="flex items-center gap-1.5 tabular-nums">
                  <Icon name="waveform" size={13} /> {formatCount(stats.plays)} plays
                </span>
                <span className="flex items-center gap-1.5 tabular-nums">
                  <Icon name="star" size={13} /> {formatCount(stats.likes)} loves
                </span>
                <span className="flex items-center gap-1.5 tabular-nums">
                  <Icon name="lyrics" size={13} /> {formatCount(stats.comments)} notes
                </span>
                <span className="tabular-nums">published {relativeTime(track.publishedAt)}</span>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button className="btn btn-primary px-5 py-2.5" onClick={play}>
                  <Icon name={isCurrent && player.playing ? "pause" : "play"} size={15} />
                  {isCurrent && player.playing ? "Pause" : "Play"}
                </button>
                <button
                  className="btn btn-ghost px-4 py-2.5"
                  onClick={() => {
                    player.playNext(track.id);
                    toast.push({ title: "Playing next", msg: track.title, kind: "ok" });
                  }}
                >
                  <Icon name="queue" size={14} /> Play next
                </button>
                <LikeButton trackId={track.id} size={16} />
                <TrackMenu track={track} contextIds={sets.map((set) => set.id)} />
              </div>

              {track.tags.length ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {track.tags.map((tag) => (
                    <Link key={tag} to={`/search?tag=${encodeURIComponent(tag)}`} className="chip">
                      {tag}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </Reveal>
        </div>

        {/* ----------------------------------------------- right column */}
        <div className="min-w-0 space-y-8">
          <Reveal delay={40}>
            <section className="panel rounded-2xl p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="label">the words</div>
                <Link to="#lyrics" className="text-[11.5px] text-muted hover:text-text2">
                  {plural(track.lines.length, "line")}
                </Link>
              </div>
              {track.lines.length ? (
                <LyricPreview song={track} count={4} />
              ) : (
                <p className="text-[12.5px] text-muted">The publisher has not written the lyrics out for this recording.</p>
              )}
              {track.lines.length > 4 ? (
                <Link to={`/t/${track.id}`} className="mt-3 inline-flex items-center gap-1 text-[12px] text-jade hover:text-jadesoft">
                  All the words <Icon name="chevronRight" size={12} />
                </Link>
              ) : null}
            </section>
          </Reveal>

          <section id="lyrics" className="panel rounded-2xl p-4 sm:p-5">
            <Lyrics song={track} variant="inline" className="max-h-[560px]" />
          </section>

          <section>
            <SectionHeader label="underneath" title="Notes" subtitle={`${thread?.items.length ?? 0} in the thread`} />
            <div onFocus={() => void loadThread(track.id)}>
              <CommentThread track={track} />
            </div>
          </section>

          {related.length ? (
            <section>
              <SectionHeader
                label={moreFromArtist.length ? "more from this publisher" : "in the same vein"}
                title={moreFromArtist.length ? `More from ${artist.name}` : "You might also like"}
                action={
                  <button
                    className="btn btn-ghost !px-3 !py-1.5"
                    onClick={() => {
                      player.playIds(queueIds, 0, { kind: "home", label: `Like ${track.title}` });
                    }}
                  >
                    <Icon name="play" size={13} /> Play all
                  </button>
                }
              />
              {moreFromArtist.length ? (
                <TrackList tracks={related} context={{ kind: "home", label: `Like ${track.title}` }} />
              ) : (
                <TrackCardGrid tracks={related.slice(0, 8)} />
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Kept for the “same publisher” strip on artist pages. */
export function songsByArtist(song: Song): Song[] {
  return TRACKS.filter((other) => other.ownerId === song.ownerId && other.id !== song.id);
}

export { clsx };
