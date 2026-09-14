import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/ui/Icons";
import { EmptyState, Reveal, SectionHeader } from "../components/ui/Primitives";
import { QueuePanel } from "../components/player/QueuePanel";
import { MiniTrack } from "../components/collection/Cards";
import { TRACKS, durationOf, getTrack } from "../data/catalog";
import { generateNurMix } from "../lib/nur";
import { formatTotal, plural } from "../lib/format";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import type { Track } from "../data/types";

export default function QueuePage() {
  const queue = usePlayer((s) => s.queue);
  const player = usePlayer();
  const liked = useLibrary((s) => s.liked);
  const history = useLibrary((s) => s.history);

  const suggestions = useMemo(() => {
    const mix = generateNurMix({ liked, history, size: 6, seedKey: `queue-${new Date().toDateString()}` });
    return mix.picks.filter((p) => !queue.includes(p.track.id)).slice(0, 5).map((p) => p.track);
  }, [liked, history, queue]);

  const recent = useMemo(
    () => history.slice(0, 8).map((h) => getTrack(h.id)).filter((t): t is Track => !!t && !queue.includes(t.id)).slice(0, 5),
    [history, queue],
  );

  const queueTracks = queue.map((id) => getTrack(id)).filter((t): t is Track => !!t);
  const queueDuration = queueTracks.reduce((s, t) => s + durationOf(t), 0);

  return (
    <div className="space-y-9">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label mb-1.5">up next</div>
          <h1 className="text-[2rem] leading-none text-text md:text-[2.6rem]">The queue</h1>
          <p className="mt-2 text-[13px] text-muted">
            {queueTracks.length ? `${plural(queueTracks.length, "track")} · ${formatTotal(queueDuration)} of singing lined up.` : "Nothing lined up yet."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-ghost !px-4 !py-2.5"
            onClick={() => player.setShuffle(!player.shuffle)}
            aria-pressed={player.shuffle}
          >
            <Icon name="shuffle" size={14} /> {player.shuffle ? "Shuffle on" : "Shuffle"}
          </button>
          <button className="btn btn-ghost !px-4 !py-2.5" onClick={player.cycleRepeat}>
            <Icon name={player.repeat === "one" ? "repeatOne" : "repeat"} size={14} /> repeat: {player.repeat}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Reveal>
          <div className="panel h-full rounded-2xl p-4 sm:p-5">
            <QueuePanel />
          </div>
        </Reveal>

        <div className="space-y-6">
          <section>
            <SectionHeader
              label="nūr suggests"
              title="Add these next"
              action={
                <button
                  className="btn btn-ghost !px-3 !py-1.5"
                  onClick={() => {
                    suggestions.forEach((t) => player.addToQueue(t.id));
                  }}
                  disabled={!suggestions.length}
                >
                  <Icon name="plus" size={13} /> Add all
                </button>
              }
            />
            <div className="panel rounded-2xl p-2.5">
              {suggestions.length ? (
                suggestions.map((t, i) => <MiniTrack key={t.id} track={t} index={i} queue={[...queue, ...suggestions.map((s) => s.id)]} />)
              ) : (
                <p className="px-3 py-6 text-center text-[12.5px] text-muted">
                  Everything Nūr would suggest is already queued. Impressive discipline.
                </p>
              )}
            </div>
          </section>

          {recent.length ? (
            <section>
              <SectionHeader label="again?" title="Recently played" />
              <div className="panel rounded-2xl p-2.5">
                {recent.map((t, i) => (
                  <MiniTrack key={t.id} track={t} index={i} queue={recent.map((r) => r.id)} />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <SectionHeader label="if the queue dies" title="Start one of these" />
            <div className="panel space-y-1 rounded-2xl p-2.5">
              {TRACKS.slice(0, 4).map((t, i) => (
                <MiniTrack key={t.id} track={t} index={i} queue={TRACKS.slice(0, 4).map((x) => x.id)} />
              ))}
            </div>
            <Link to="/search" className="btn btn-ghost mt-3 w-full !py-2.5">
              <Icon name="search" size={14} /> Browse everything
            </Link>
          </section>
        </div>
      </div>

      {!queue.length ? (
        <EmptyState
          icon="queue"
          title="Silence, for now"
          msg="Play any nasheed and it lands here. Nūr can also fill the queue from your loved list."
        />
      ) : null}
    </div>
  );
}
