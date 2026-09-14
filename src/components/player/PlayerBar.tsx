import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { PatternArt } from "../art/PatternArt";
import { TimeRow, TransportButtons, VolumeControl, SpaceMenu } from "./Transport";
import { Equalizer, LikeButton } from "../track/TrackBits";
import { artistOf, getTrack } from "../../data/catalog";
import { usePlayer } from "../../store/player";
import { useLibrary } from "../../store/library";
import { useSmoothTime } from "../../lib/hooks";
import { songFor } from "../../lib/song";
import { peaksFor } from "../../lib/envelope";
import { useMemo, useRef } from "react";
import { SeekBar } from "../ui/Primitives";

export function PlayerBar() {
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => s.time);
  const context = usePlayer((s) => s.context);
  const immersive = usePlayer((s) => s.immersive);
  const seek = usePlayer((s) => s.seek);
  const setImmersive = usePlayer((s) => s.setImmersive);
  const duff = useLibrary((s) => s.settings.duff);
  const setDuff = usePlayer((s) => s.setDuff);

  const track = getTrack(trackId);
  const artist = track ? artistOf(track) : null;
  const smooth = useSmoothTime(playing);
  const barRef = useRef<HTMLDivElement>(null);

  const peaks = useMemo(() => (track ? peaksFor(songFor(track), 260) : undefined), [track]);
  const progress = track ? (playing ? smooth : time) / songFor(track).duration : 0;

  if (!track || !artist) {
    return (
      <footer className="relative z-40 border-t border-line bg-elev/80 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-3 text-muted">
            <span className="grid h-11 w-11 place-items-center rounded-lg border border-dashed border-line2">
              <Icon name="waveform" size={18} />
            </span>
            <div>
              <div className="text-[13px] font-semibold text-text2">Nothing playing</div>
              <div className="text-[11.5px]">Pick a nasheed — the voices are synthesised live, so it starts instantly.</div>
            </div>
          </div>
          <Link to="/" className="btn btn-ghost px-3.5 py-2">
            <Icon name="home" size={14} /> Browse
          </Link>
        </div>
      </footer>
    );
  }

  return (
    <footer ref={barRef} className="relative z-40 border-t border-line bg-elev/88 backdrop-blur-2xl">
      {/* hairline progress for mobile */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-transparent sm:hidden">
        <div className="h-full bg-gradient-to-r from-jadedeep via-jade to-gold transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 sm:grid-cols-[minmax(0,280px)_minmax(0,1fr)_minmax(0,280px)] sm:px-4">
        {/* left: now playing */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => setImmersive(!immersive)}
            className="group relative shrink-0 overflow-hidden rounded-lg border border-line"
            style={{ width: 52, height: 52 }}
            aria-label="Open the immersive player"
          >
            <PatternArt seed={track.seed} accent={track.accent} />
            <span className="absolute inset-0 grid place-items-center bg-[rgba(4,12,9,0.6)] opacity-0 transition-opacity group-hover:opacity-100">
              <Icon name="expand" size={16} className="text-text" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <Link to={`/t/${track.id}`} className="block truncate text-[13.5px] font-semibold text-text hover:text-jadesoft">
              {track.title}
            </Link>
            <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted">
              <Link to={`/a/${artist.id}`} className="truncate hover:text-text2 hover:underline underline-offset-2">
                {artist.name}
              </Link>
              <span aria-hidden>·</span>
              <span className="hidden truncate sm:inline">{context.label}</span>
              {playing ? <Equalizer className="ml-0.5 text-jade" bars={3} /> : null}
            </div>
          </div>
          <LikeButton trackId={track.id} size={15} className="hidden sm:grid" />
        </div>

        {/* center: transport */}
        <div className="hidden flex-col items-center gap-1 sm:flex">
          <TransportButtons size={34} />
          <TimeRow className="max-w-[560px]" />
        </div>

        {/* right: tools */}
        <div className="flex items-center justify-end gap-0.5">
          <div className="sm:hidden">
            <TransportButtons size={30} />
          </div>
          <button
            onClick={() => setDuff(!duff)}
            className={clsx("btn-icon hidden items-center gap-1.5 rounded-full px-2.5 py-2 md:flex", duff ? "text-gold" : "text-muted")}
            aria-pressed={duff}
            title={duff ? "Duff (frame drum) on — tap for vocals only" : "Vocals only — tap to bring the duff back"}
          >
            <Icon name="drum" size={16} />
            <span className="text-[10.5px] font-bold uppercase tracking-wider">{duff ? "duff" : "vocals"}</span>
          </button>
          <div className="hidden lg:block">
            <SpaceMenu />
          </div>
          <Link to="/queue" className="btn-icon hidden rounded-full p-2 md:grid" title="Queue">
            <Icon name="queue" size={17} />
          </Link>
          <div className="hidden xl:block">
            <VolumeControl />
          </div>
          <button
            onClick={() => setImmersive(!immersive)}
            className="btn-icon rounded-full p-2"
            aria-label="Open lyrics"
            title="Lyrics & immersive view"
          >
            <Icon name={immersive ? "collapse" : "lyrics"} size={17} />
          </button>
        </div>
      </div>

      {/* mobile seek */}
      <div className="px-3 pb-2 sm:hidden">
        <SeekBar value={playing ? smooth : time} max={songFor(track).duration} peaks={peaks} onChange={seek} compact className="w-full" label="Seek" />
      </div>
    </footer>
  );
}
