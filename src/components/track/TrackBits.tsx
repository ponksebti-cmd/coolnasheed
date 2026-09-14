import { clsx } from "clsx";
import { Link } from "react-router-dom";
import { Icon } from "../ui/Icons";
import { DropdownMenu, type MenuItem } from "../ui/Menu";
import { useToast } from "../ui/Primitives";
import { PatternArt } from "../art/PatternArt";
import { artistOf, durationOf, formatCount, getCollection, statsFor } from "../../data/catalog";
import { maqamLabel } from "../../lib/theory";
import { formatTime } from "../../lib/format";
import { usePlayer } from "../../store/player";
import { useLibrary } from "../../store/library";
import type { Track } from "../../data/types";

/* --------------------------------------------------------------- equalizer */

export function Equalizer({ active = true, className, bars = 4 }: { active?: boolean; className?: string; bars?: number }) {
  return (
    <span className={clsx("flex h-3.5 items-end gap-[2px]", className)} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={clsx("eq-bar h-full", !active && "!animate-none")}
          style={{
            animationDelay: `${i * 0.14}s`,
            animationDuration: `${0.85 + i * 0.13}s`,
            transform: active ? undefined : "scaleY(0.3)",
          }}
        />
      ))}
    </span>
  );
}

/* --------------------------------------------------------------- play fab */

export function PlayFab({
  playing,
  onClick,
  size = 44,
  className,
  tone = "primary",
  label,
}: {
  playing: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: number;
  className?: string;
  tone?: "primary" | "glass" | "gold";
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label ?? (playing ? "Pause" : "Play")}
      style={{ width: size, height: size }}
      className={clsx(
        "grid shrink-0 place-items-center rounded-full transition-all duration-200 active:scale-90",
        tone === "primary" && "btn-primary",
        tone === "gold" && "btn-gold",
        tone === "glass" && "glass text-text hover:border-line3",
        className,
      )}
    >
      <Icon name={playing ? "pause" : "play"} size={Math.round(size * 0.4)} strokeWidth={2.4} />
    </button>
  );
}

/* ------------------------------------------------------------- like button */

export function LikeButton({ trackId, size = 17, className }: { trackId: string; size?: number; className?: string }) {
  const liked = useLibrary((s) => s.liked.includes(trackId));
  const toggleLike = useLibrary((s) => s.toggleLike);
  const toast = useToast();
  return (
    <button
      className={clsx(
        "btn-icon grid place-items-center rounded-full p-2 transition-transform",
        liked ? "text-gold" : "text-muted hover:text-text2",
        className,
      )}
      aria-label={liked ? "Remove from loved" : "Love this nasheed"}
      aria-pressed={liked}
      onClick={(e) => {
        e.stopPropagation();
        const now = toggleLike(trackId);
        if (window.navigator.vibrate) window.navigator.vibrate(8);
        toast.push({
          title: now ? "Loved" : "Removed from loved",
          msg: now ? "It will keep showing up in Nūr mixes." : undefined,
          kind: now ? "ok" : "info",
        });
      }}
    >
      <Icon
        name={liked ? "starFill" : "star"}
        size={size}
        className={clsx(liked && "drop-shadow-[0_0_10px_rgba(var(--c-glow-2),0.65)]")}
      />
    </button>
  );
}

/* -------------------------------------------------------------- track menu */

export function TrackMenu({ track, contextIds }: { track: Track; contextIds?: string[] }) {
  const player = usePlayer();
  const library = useLibrary();
  const toast = useToast();
  const liked = library.liked.includes(track.id);
  const collections = contextIds?.length
    ? contextIds.map((id) => getCollection(id)).filter(Boolean)
    : track.collections.map((id) => getCollection(id)).filter(Boolean);

  const items: MenuItem[] = [
    {
      label: liked ? "Remove from loved" : "Love this nasheed",
      icon: liked ? "starFill" : "star",
      onClick: () => library.toggleLike(track.id),
    },
    {
      label: "Play next",
      icon: "play",
      onClick: () => {
        player.addToQueue(track.id);
        toast.push({ title: "Added next", msg: track.title, kind: "ok" });
      },
    },
    {
      label: "Add to queue",
      icon: "queue",
      onClick: () => {
        player.addToQueue(track.id);
        toast.push({ title: "Added to queue", msg: track.title, kind: "ok" });
      },
    },
    ...(library.playlists.length
      ? library.playlists.slice(0, 3).map((pl) => ({
          label: `Add to ${pl.name}`,
          icon: "plus" as const,
          onClick: () => {
            const added = library.addToPlaylist(pl.id, track.id);
            toast.push({
              title: added ? `Added to ${pl.name}` : `Already in ${pl.name}`,
              kind: added ? "ok" : "info",
            });
          },
        }))
      : []),
    {
      label: "New playlist…",
      icon: "library",
      onClick: () => {
        const pl = library.createPlaylist("Untitled set", [track.id]);
        toast.push({ title: "Playlist created", msg: pl.name, kind: "ok" });
      },
    },
    {
      label: `Go to ${artistOf(track).name}`,
      icon: "user",
      href: `/a/${track.artistId}`,
    },
    ...(collections[0] ? [{ label: `Go to ${collections[0]!.title}`, icon: "rows" as const, href: `/c/${collections[0]!.id}` }] : []),
    {
      label: "Copy link",
      icon: "share",
      onClick: async () => {
        const url = `${window.location.origin}/t/${track.id}`;
        try {
          await navigator.clipboard.writeText(url);
          toast.push({ title: "Link copied", msg: url, kind: "ok" });
        } catch {
          toast.push({ title: "Could not copy", msg: url, kind: "warn" });
        }
      },
    },
  ];

  return <DropdownMenu items={items} label={`More options for ${track.title}`} />;
}

/* --------------------------------------------------------------- thumbnail */

export function ArtThumb({ track, size = 44, className, rounded = "rounded-lg" }: { track: Track; size?: number; className?: string; rounded?: string }) {
  return (
    <div
      className={clsx("relative shrink-0 overflow-hidden border border-line", rounded, className)}
      style={{ width: size, height: size }}
    >
      <PatternArt seed={track.seed} accent={track.accent} />
    </div>
  );
}

/* ----------------------------------------------------------- meta fragments */

export function TrackMeta({ track, className, showMaqam = true }: { track: Track; className?: string; showMaqam?: boolean }) {
  const artist = artistOf(track);
  return (
    <div className={clsx("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted", className)}>
      <Link to={`/a/${artist.id}`} className="font-medium text-text2 hover:text-text hover:underline underline-offset-2">
        {artist.name}
      </Link>
      <span aria-hidden>·</span>
      {showMaqam ? (
        <span className="tabular-nums">
          {maqamLabel(track.maqam)}
          {track.duff ? "" : " · vocals only"}
        </span>
      ) : null}
      <span aria-hidden>·</span>
      <span className="tabular-nums">{formatTime(durationOf(track))}</span>
    </div>
  );
}

export function PlayCount({ track, className }: { track: Track; className?: string }) {
  const stats = statsFor(track);
  return (
    <span className={clsx("flex items-center gap-1 text-[11px] tabular-nums text-muted", className)}>
      <Icon name="waveform" size={12} />
      {formatCount(stats.plays)}
    </span>
  );
}
