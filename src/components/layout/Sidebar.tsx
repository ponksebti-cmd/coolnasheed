import { useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Icon, type IconName } from "../ui/Icons";
import { StarMark, PatternArt } from "../art/PatternArt";
import { Tasbih } from "../Tasbih";
import { COLLECTIONS, getTrack } from "../../data/catalog";
import { useLibrary } from "../../store/library";
import { usePlayer } from "../../store/player";
import { useToast } from "../ui/Primitives";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/library", label: "Library", icon: "library" },
  { to: "/queue", label: "Queue", icon: "queue" },
];

export function Sidebar({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const library = useLibrary();
  const queueLength = usePlayer((s) => s.queue.length);
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  /* One pill moves between the nav items instead of each item lighting up on its
     own. It is measured rather than assumed, so it survives a font or a label
     changing size. */
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const host = navRef.current;
    if (!host) return;
    const measure = () => {
      const el = host.querySelector<HTMLElement>('[data-active="true"]');
      setPill(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [pathname]);

  const playlists = library.playlists;
  const lovedCount = library.liked.length;

  const submitNew = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void library.createPlaylist(trimmed).then((pl) => {
      // null means no account (the sign-in sheet is open and will retry) or a refused write
      if (!pl) return;
      setName("");
      setCreating(false);
      toast.push({ title: "Set created", msg: pl.name, kind: "ok", action: { label: "Open", run: () => navigate(`/p/${pl.id}`) } });
      onNavigate?.();
    });
  };

  return (
    <aside className={clsx("flex h-full w-full flex-col border-r border-line bg-bg2/70", className)}>
      {/* brand */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="relative grid h-9 w-9 place-items-center rounded-lg border border-line2 bg-surface2">
          <StarMark size={24} />
          <span className="absolute inset-0 rounded-lg bg-jade/10 blur-[6px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="truncate font-display text-[17px] leading-none tracking-wide text-text">
            Cool<span className="text-gold">Nasheed</span>
          </div>
          <div className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">vocals of light</div>
        </div>
      </div>

      {/* nav */}
      <nav ref={navRef} className="relative px-2.5 pb-3" aria-label="Main">
        <span
          className="nav-pill"
          aria-hidden
          style={{
            left: 10,
            right: 10,
            height: pill ? pill.height : 0,
            transform: `translateY(${pill ? pill.top : 0}px)`,
            opacity: pill ? 1 : 0,
          }}
        />
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold transition-colors",
                isActive ? "text-text" : "text-muted hover:text-text2",
              )
            }
          >
            {({ isActive }) => (
              <span className="relative flex w-full items-center gap-3" data-active={isActive}>
                <Icon name={item.icon} size={17} className={clsx("relative", isActive && "text-jade")} />
                <span className="relative flex-1">{item.label}</span>
                {item.to === "/queue" && queueLength > 0 ? (
                  <span className="relative rounded-full bg-surface3 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-text2">{queueLength}</span>
                ) : null}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="hairline mx-3" />

      {/* your library */}
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        <div className="mb-1.5 flex items-center justify-between px-2">
          <span className="label">Your sets</span>
          <button className="btn-icon rounded-full p-1" onClick={() => setCreating((v) => !v)} aria-label="New set">
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
              <button className="btn btn-primary flex-1 !py-1.5" onClick={submitNew} disabled={!name.trim()}>
                Create
              </button>
              <button className="btn btn-ghost !py-1.5" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <NavLink
          to="/library"
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx("group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors", isActive ? "bg-surface2" : "hover:bg-surface2/60")
          }
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-gold/25 to-jade/20 text-gold ring-1 ring-line2">
            <Icon name="starFill" size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-text">Loved nasheeds</span>
            <span className="block truncate text-[11px] text-muted">{lovedCount ? `${lovedCount} saved` : "nothing loved yet"}</span>
          </span>
        </NavLink>

        {playlists.map((pl) => (
          <NavLink
            key={pl.id}
            to={`/p/${pl.id}`}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx("group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors", isActive ? "bg-surface2" : "hover:bg-surface2/60")
            }
          >
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-line">
              <PlaylistArt seed={pl.seed} ids={pl.trackIds} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-text2 group-hover:text-text">{pl.name}</span>
              <span className="block truncate text-[11px] text-muted">
                {pl.trackIds.length} {pl.trackIds.length === 1 ? "track" : "tracks"}
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
            <span className="mt-1 block leading-relaxed">Group the tracks you keep returning to. Everything stays on this device.</span>
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
              clsx("group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors", isActive ? "bg-surface2" : "hover:bg-surface2/60")
            }
          >
            <span className="h-7 w-7 shrink-0 overflow-hidden rounded-md ring-1 ring-line">
              <PatternArt seed={c.seed} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted group-hover:text-text2">{c.title}</span>
          </NavLink>
        ))}
      </div>

      {/* tasbih + footer */}
      <div className="border-t border-line p-3">
        <Tasbih />
        <div className="mt-2.5 flex items-center justify-between px-1">
          <NavLink to="/about" onClick={onNavigate} className="flex items-center gap-1.5 text-[11px] text-muted hover:text-text2">
            <Icon name="info" size={12} /> about this app
          </NavLink>
          <span className="text-[10px] tabular-nums text-muted/70">{library.history.length} plays logged</span>
        </div>
      </div>
    </aside>
  );
}

function PlaylistArt({ seed, ids }: { seed: string; ids: string[] }) {
  const first = getTrack(ids[0]);
  if (!first) return <PatternArt seed={seed} />;
  return (
    <span className="grid h-full w-full grid-cols-2 grid-rows-2">
      {ids.slice(0, 4).map((id, i) => {
        const t = getTrack(id);
        if (!t) return <span key={i} className="bg-surface3" />;
        return (
          <span key={i} className="overflow-hidden">
            <PatternArt seed={t.seed} showVignette={false} />
          </span>
        );
      })}
      {ids.length === 1 ? (
        <>
          <PatternArt seed={seed} showVignette={false} className="col-span-1" />
          <PatternArt seed={`${seed}-b`} showVignette={false} />
          <PatternArt seed={`${seed}-c`} showVignette={false} />
        </>
      ) : null}
      {ids.length === 2 || ids.length === 3
        ? Array.from({ length: 4 - Math.min(ids.length, 4) }).map((_, i) => (
            <span key={`pad-${i}`} className="bg-surface3" />
          ))
        : null}
    </span>
  );
}
