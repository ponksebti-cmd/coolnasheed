import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { Kbd } from "../ui/Primitives";
import { useLibrary } from "../../store/library";
import { useUi } from "../../store/ui";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useLibrary((s) => s.settings.theme);
  const setSetting = useLibrary((s) => s.setSetting);
  const setNur = useUi((s) => s.setNur);
  const nurOpen = useUi((s) => s.nurOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setQ(params.get("q") ?? "");
  }, [location.search]);

  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("coolnasheed:focus-search", focus);
    return () => window.removeEventListener("coolnasheed:focus-search", focus);
  }, []);

  const onSearch = (value: string) => {
    const next = value ? `/search?q=${encodeURIComponent(value)}` : "/search";
    navigate(next, { replace: location.pathname === "/search" });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/72 backdrop-blur-xl">
      <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-5">
        <button className="btn-icon rounded-full p-2 lg:hidden" onClick={onMenu} aria-label="Open menu">
          <Icon name="rows" size={18} />
        </button>
        <button
          className="btn-icon hidden rounded-full p-2 sm:grid"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          title="Back"
        >
          <Icon name="chevronLeft" size={18} />
        </button>

        <form
          className={clsx("relative min-w-0 flex-1 max-w-[520px]", location.pathname === "/search" && "hidden md:block")}
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(q);
          }}
          role="search"
        >
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <Icon name="search" size={15} />
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              onSearch(e.target.value);
            }}
            placeholder="Search nasheeds, reciters, maqām, a line of poetry…"
            aria-label="Search CoolNasheed"
            className="w-full rounded-full border border-line bg-surface2/60 py-2 pl-9 pr-16 text-[13px] text-text outline-none transition-all placeholder:text-muted/80 focus:border-jade/45 focus:bg-surface2 focus:shadow-[0_0_0_4px_rgba(var(--c-glow),0.08)]"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 sm:flex">
            <Kbd>/</Kbd>
          </span>
        </form>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setNur(!nurOpen)}
            className={clsx(
              "btn gap-1.5 !px-3 !py-2",
              nurOpen ? "btn-gold" : "btn-ghost",
            )}
            aria-pressed={nurOpen}
            title="Nūr — the on-device curator"
          >
            <Icon name="sparkle" size={15} />
            <span className="hidden md:inline">Nūr</span>
          </button>

          <button
            className="btn-icon hidden rounded-full p-2 md:grid"
            onClick={() => window.dispatchEvent(new CustomEvent("coolnasheed:command"))}
            aria-label="Command palette"
            title="Command palette"
          >
            <Icon name="command" size={17} />
          </button>

          <button
            className="btn-icon grid place-items-center rounded-full p-2"
            onClick={() => setSetting("theme", theme === "night" ? "dawn" : "night")}
            aria-label={theme === "night" ? "Switch to daylight theme" : "Switch to night theme"}
            title={theme === "night" ? "Daylight theme" : "Night theme"}
          >
            <Icon name={theme === "night" ? "moon" : "sun"} size={17} />
          </button>
        </div>
      </div>
    </header>
  );
}
