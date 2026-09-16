import { useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Icon, type IconName } from "../ui/Icons";
import { StarMark, CoverArt } from "../art/CoverArt";
import { Tasbih } from "../Tasbih";
import { COLLECTIONS, getTrack } from "../../data/catalog";
import { useLibrary } from "../../store/library";
import { usePlayer } from "../../store/player";
import { useToast } from "../ui/Primitives";
import type { Accent } from "../../data/types";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/library", label: "Library", icon: "library" },
  { to: "/queue", label: "Queue", icon: "queue" },
];

export function Sidebar({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const library = useLibrary();
  const queueLength = usePlayer((s) => s.queue.length);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const playlists = library.playlists;
  const lovedCount = library.liked.length;

  /* Which destination is current — and therefore where the pill sits. A detail page
     belongs to nothing in this list, so the pill fades out rather than lying. */
  const activeTo =
    NAV.find((item) =>
      item.end
        ? location.pathname === item.to
        : location.pathname === item.to ||
          location.pathname.startsWith(`${item.to}/`),
    )?.to ?? null;

  /* Measured, not guessed: the label can wrap, the font can load late, the window
     can be any size. Re-measure on both. */
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || !activeTo) {
      setPill(null);
      return;
    }
    const measure = () => {
      const link = nav.querySelector<HTMLElement>(`[data-nav="${activeTo}"]`);
      if (!link) {
        setPill(null);
        return;
      }
      setPill({ y: link.offsetTop, h: link.offsetHeight });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeTo, queueLength]);

  const submitNew = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void library.createPlaylist(trimmed).then((pl) => {
      // null means no account (the sign-in sheet is open and will retry) or a refused write
      if (!pl) return;
      setName("");
      setCreating(false);
      toast.push({
        title: "Set created",
        msg: pl.name,
        kind: "ok",
        action: { label: "Open", run: () => navigate(`/p/${pl.id}`) },
      });
      onNavigate?.();
    });
  };

  return (
    <aside
      className={clsx(
        "flex h-full w-full flex-col border-r border-line bg-bg2/70",
        className,
      )}
    >
      {/* brand */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="relative grid h-9 w-9 place-items-center rounded-lg border border-line2 bg-surface2">
          <StarMark size={24} />
          <span
            className="absolute inset-0 rounded-lg bg-jade/10 blur-[6px]"
            aria-hidden
          />
        </span>
        <div className="min-w-0">
          <div className="truncate font-display text-[17px] leading-none tracking-wide text-text">
            Cool<span className="text-gold">Nasheed</span>
          </div>
          <div className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
            vocals of light
          </div>
        </div>
      </div>

      {/* nav */}
      <nav ref={navRef} className="relative px-2.5 pb-3" aria-label="Main">
        {pill ? (
          <span
            className="nav-pill"
            style={{ transform: `translateY(${pill.y}px)`, height: pill.h }}
            aria-hidden
          />
        ) : null}
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-nav={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                "pressable group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold",
                isActive ? "text-text" : "text-muted hover:text-text2",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={clsx(
                    "absolute inset-0 rounded-lg transition-colors duration-200",
                    isActive
                      ? "bg-jade/6"
                      : "bg-transparent group-hover:bg-surface2/50",
                  )}
                />
                <Icon
                  name={item.icon}
                  size={17}
                  className={clsx(
                    "relative",
                    isActive ? "icon-pop text-jade" : "",
                  )}
                />
                <span className="relative flex-1">{item.label}</span>
                {item.to === "/queue" && queueLength > 0 ? (
                  <span className="relative rounded-full bg-surface3 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-text2">
                    {queueLength}
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="hairline mx-3" />

      {/* your library */}
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        <div className="mb-1.5 flex items-center justify-between px-2">
          <span className="label">Your sets</span>
          <button
            className="btn-icon rounded-full p-1"
            onClick={() => setCreating((v) => !v)}
            aria-label="New set"
          >
            <Icon name="plus" size={15} />
          </button>
        </div>

        {creating ? (
          <div className="mb-2 rounded-lg border border-line2 bg-surface2 p-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNew();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Name your set…"
              className="w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-muted focus:border-jade/50"
            />
            <div className="mt-2 flex gap-1.5">
              <button
                className="btn btn-primary flex-1 !py-1.5"
                onClick={submitNew}
                disabled={!name.trim()}
              >
                Create
              </button>
              <button
                className="btn btn-ghost !py-1.5"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <NavLink
          to="/library"
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              "group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors",
              isActive ? "bg-surface2" : "hover:bg-surface2/60",
            )
          }
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-gold/25 to-jade/20 text-gold ring-1 ring-line2">
            <Icon name="starFill" size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-text">
              Loved nasheeds
            </span>
            <span className="block truncate text-[11px] text-muted">
              {lovedCount ? `${lovedCount} saved` : "nothing loved yet"}
            </span>
          </span>
        </NavLink>

        {playlists.map((pl) => (
          <NavLink
            key={pl.id}
            to={`/p/${pl.id}`}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                "group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors",
                isActive ? "bg-surface2" : "hover:bg-surface2/60",
              )
            }
          >
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-line">
              <PlaylistArt
                name={pl.name}
                accent={pl.accent}
                ids={pl.trackIds}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-text2 group-hover:text-text">
                {pl.name}
              </span>
              <span className="block truncate text-[11px] text-muted">
                {pl.trackIds.length}{" "}
                {pl.trackIds.length === 1 ? "track" : "tracks"}
              </span>
            </span>
          </NavLink>
        ))}

        {!playlists.length && !creating ? (
          <button
            onClick={() => setCreating(true)}
            className="mt-1 w-full rounded-lg border border-dashed border-line2 px-3 py-3 text-left text-[12px] text-muted transition-colors hover:border-line3 hover:text-text2"
          >
            <span className="flex items-center gap-2">
              <Icon name="plus" size={13} /> Make your first set
            </span>
            <span className="mt-1 block leading-relaxed">
              Group the nasheeds you keep returning to. Sets are saved to your
              account.
            </span>
          </button>
        ) : null}

        <div className="hairline mx-1 my-3" />

        <div className="mb-1.5 px-2">
          <span className="label">Curated</span>
        </div>
        {COLLECTIONS.map((c) => (
          <NavLink
            key={c.id}
            to={`/c/${c.id}`}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                "group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors",
                isActive ? "bg-surface2" : "hover:bg-surface2/60",
              )
            }
          >
            <span className="h-7 w-7 shrink-0 overflow-hidden rounded-md ring-1 ring-line">
              <CoverArt
                title={c.title}
                accent={c.accent}
                className="h-full w-full"
                rounded="sm"
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted group-hover:text-text2">
              {c.title}
            </span>
          </NavLink>
        ))}
      </div>

      {/* tasbih + footer */}
      <div className="border-t border-line p-3">
        <Tasbih />
        <div className="mt-2.5 flex items-center justify-between px-1">
          <NavLink
            to="/about"
            onClick={onNavigate}
            className="flex items-center gap-1.5 text-[11px] text-muted hover:text-text2"
          >
            <Icon name="info" size={12} /> about this app
          </NavLink>
          <span className="text-[10px] tabular-nums text-muted/70">
            {library.history.length} plays logged
          </span>
        </div>
      </div>
    </aside>
  );
}

function PlaylistArt({
  name,
  accent,
  ids,
}: {
  name: string;
  accent: Accent;
  ids: string[];
}) {
  const tracks = ids.slice(0, 4).map((id) => getTrack(id));
  if (!tracks.some(Boolean))
    return (
      <CoverArt
        title={name}
        accent={accent}
        className="h-full w-full"
        rounded="sm"
      />
    );
  return (
    <span className="grid h-full w-full grid-cols-2 grid-rows-2">
      {Array.from({ length: 4 }).map((_, i) => {
        const track = tracks[i];
        if (!track) return <span key={i} className="bg-surface3" />;
        return (
          <span key={i} className="overflow-hidden">
            <CoverArt
              path={track.artworkPath}
              title={track.title}
              className="h-full w-full"
              rounded="sm"
            />
          </span>
        );
      })}
    </span>
  );
}
