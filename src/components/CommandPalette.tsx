import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Icon, type IconName } from "./ui/Icons";
import {
  ARTISTS,
  COLLECTIONS,
  artistOf,
  searchArtists,
  searchCollections,
  searchTracks,
} from "../data/catalog";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import { useUi } from "../store/ui";

type Item = {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: IconName;
  run: () => void;
};

export function CommandPalette() {
  const open = useUi((s) => s.commandOpen);
  const setCommand = useUi((s) => s.setCommand);
  const navigate = useNavigate();
  const player = usePlayer();
  const library = useLibrary();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommand(!useUi.getState().commandOpen);
      }
    };
    const custom = () => setCommand(true);
    window.addEventListener("keydown", handler);
    window.addEventListener("coolnasheed:command", custom);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("coolnasheed:command", custom);
    };
  }, [setCommand]);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const close = () => setCommand(false);
    const go = (to: string) => () => {
      navigate(to);
      close();
    };

    const actions: Item[] = [
      {
        id: "a-play",
        group: "Actions",
        label: player.playing ? "Pause" : "Play",
        icon: player.playing ? "pause" : "play",
        run: () => {
          player.toggle();
          close();
        },
      },
      {
        id: "a-next",
        group: "Actions",
        label: "Next nasheed",
        icon: "next",
        run: () => {
          player.next();
          close();
        },
      },
      {
        id: "a-prev",
        group: "Actions",
        label: "Previous nasheed",
        icon: "prev",
        run: () => {
          player.prev();
          close();
        },
      },
      {
        id: "a-immersive",
        group: "Actions",
        label: player.immersive
          ? "Close immersive player"
          : "Open immersive player & lyrics",
        icon: "lyrics",
        run: () => {
          player.setImmersive(!player.immersive);
          close();
        },
      },
      {
        id: "a-shuffle",
        group: "Actions",
        label: player.shuffle ? "Shuffle off" : "Shuffle on",
        icon: "shuffle",
        run: () => {
          player.setShuffle(!player.shuffle);
          close();
        },
      },
      {
        id: "a-theme",
        group: "Actions",
        label:
          library.settings.theme === "night"
            ? "Switch to daylight theme"
            : "Switch to night theme",
        icon: library.settings.theme === "night" ? "sun" : "moon",
        run: () => {
          library.setSetting(
            "theme",
            library.settings.theme === "night" ? "dawn" : "night",
          );
          close();
        },
      },
    ];

    const pages: Item[] = [
      {
        id: "p-home",
        group: "Go to",
        label: "Home",
        icon: "home",
        run: go("/"),
      },
      {
        id: "p-search",
        group: "Go to",
        label: "Search",
        icon: "search",
        run: go("/search"),
      },
      {
        id: "p-library",
        group: "Go to",
        label: "Library",
        icon: "library",
        run: go("/library"),
      },
      {
        id: "p-queue",
        group: "Go to",
        label: "Queue",
        icon: "queue",
        run: go("/queue"),
      },
      {
        id: "p-about",
        group: "Go to",
        label: "About CoolNasheed",
        icon: "info",
        run: go("/about"),
      },
      ...library.playlists.map((pl) => ({
        id: `p-${pl.id}`,
        group: "Go to",
        label: pl.name,
        sub: `${pl.trackIds.length} tracks`,
        icon: "rows" as IconName,
        run: go(`/p/${pl.id}`),
      })),
    ];

    if (!q.trim()) return [...actions, ...pages];

    const tracks = searchTracks(q)
      .slice(0, 6)
      .map((t) => ({
        id: `t-${t.id}`,
        group: "Nasheeds",
        label: t.title,
        sub: artistOf(t).name,
        icon: "waveform" as IconName,
        run: () => {
          player.playTrack(t.id, { kind: "search", label: `Search · ${q}` });
          close();
        },
      }));
    const sets = searchCollections(q)
      .slice(0, 3)
      .map((c) => ({
        id: `c-${c.id}`,
        group: "Sets",
        label: c.title,
        sub: c.curator,
        icon: "library" as IconName,
        run: go(`/c/${c.id}`),
      }));
    const artists = searchArtists(q)
      .slice(0, 3)
      .map((a) => ({
        id: `ar-${a.id}`,
        group: "Reciters",
        label: a.name,
        sub: a.origin,
        icon: "user" as IconName,
        run: go(`/a/${a.id}`),
      }));
    const matchedActions = actions.filter((a) =>
      a.label.toLowerCase().includes(q.toLowerCase()),
    );
    const matchedPages = pages.filter((p) =>
      p.label.toLowerCase().includes(q.toLowerCase()),
    );

    return [...tracks, ...sets, ...artists, ...matchedActions, ...matchedPages];
  }, [q, player, library, navigate, setCommand]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${cursor}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const groups: { name: string; items: Item[] }[] = [];
  items.forEach((item) => {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  });

  let flatIndex = -1;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center p-4 pt-[12vh] veil-enter"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="absolute inset-0 bg-[rgba(3,9,7,0.66)] backdrop-blur-xl"
        onClick={() => setCommand(false)}
        aria-hidden
      />
      <div className="glass materialize relative z-10 w-full max-w-[560px] overflow-hidden rounded-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Icon name="search" size={17} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(items.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                items[cursor]?.run();
              } else if (e.key === "Escape") {
                setCommand(false);
              }
            }}
            placeholder="Search nasheeds, sets, reciters, or run a command…"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-muted"
            aria-label="Command palette search"
          />
          <span className="hidden shrink-0 rounded border border-line2 px-1.5 py-0.5 text-[10px] font-semibold text-muted sm:block">
            ESC
          </span>
        </div>

        <div
          ref={listRef}
          className="scroll-slim max-h-[52vh] overflow-y-auto p-1.5"
        >
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted">
              Nothing matches “{q}”. Try a title, a publisher's name, a tag, or
              a word from a lyric.
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="mb-1">
                <div className="label px-3 pb-1 pt-2">{group.name}</div>
                {group.items.map((item) => {
                  flatIndex++;
                  const idx = flatIndex;
                  return (
                    <button
                      key={item.id}
                      data-idx={idx}
                      onMouseEnter={() => setCursor(idx)}
                      onClick={item.run}
                      className={clsx(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                        idx === cursor
                          ? "bg-jade/12 text-text"
                          : "text-text2 hover:bg-surface2",
                      )}
                    >
                      <span
                        className={clsx(
                          "grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-surface2",
                          idx === cursor && "text-jade",
                        )}
                      >
                        <Icon name={item.icon} size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {item.label}
                        </span>
                        {item.sub ? (
                          <span className="block truncate text-[11px] text-muted">
                            {item.sub}
                          </span>
                        ) : null}
                      </span>
                      {idx === cursor ? (
                        <Icon
                          name="arrowUpRight"
                          size={13}
                          className="shrink-0 text-muted"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[10.5px] text-muted">
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-line2 px-1">↑</kbd>
            <kbd className="rounded border border-line2 px-1">↓</kbd> navigate
            <kbd className="rounded border border-line2 px-1">↵</kbd> run
          </span>
          <span className="truncate">
            {ARTISTS.length} reciters · {COLLECTIONS.length} sets indexed
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
