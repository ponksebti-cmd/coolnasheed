import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { Kbd } from "../ui/Primitives";
import { useLibrary } from "../../store/library";
import { AccountMenu } from "../auth/AccountMenu";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useLibrary((s) => s.settings.theme);
  const setSetting = useLibrary((s) => s.setSetting);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  /* What this field has already handed to the address bar. */
  const written = useRef<string | null>(null);
  const writeTimer = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const url = params.get("q") ?? "";
    /* The field leads and the address bar follows.
     *
     * The write lags the keystrokes by a moment, so the URL arriving back is old news:
     * letting it set the field is how a space typed at the end of a word got overtaken
     * by the write for the character before it, and the whole line of text jumped back
     * a character. A URL that arrived from anywhere else — a link, back, a tag — still
     * fills the field. */
    if (written.current !== null && written.current === url) {
      written.current = null;
      return;
    }
    written.current = null;
    setQ(url);
  }, [location.search]);

  useEffect(() => () => window.clearTimeout(writeTimer.current), []);

  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("coolnasheed:focus-search", focus);
    return () => window.removeEventListener("coolnasheed:focus-search", focus);
  }, []);

  const onSearch = (value: string) => {
    written.current = value;
    const next = value ? `/search?q=${encodeURIComponent(value)}` : "/search";
    navigate(next, { replace: location.pathname === "/search" });
  };

  /* Once the typing pauses, not once per keystroke: a navigation per character makes
     the field and the URL fight over the same text. */
  const onType = (value: string) => {
    setQ(value);
    window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(() => onSearch(value), 220);
  };

  return (
    <header className="topbar sticky top-0 z-30">
      <div className="relative z-10 flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-5">
        <button
          className="btn-icon rounded-full p-2 lg:hidden"
          onClick={onMenu}
          aria-label="Open menu"
        >
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
          className={clsx(
            "relative min-w-0 flex-1 max-w-[520px]",
            location.pathname === "/search" && "hidden md:block",
          )}
          onSubmit={(e) => {
            e.preventDefault();
            window.clearTimeout(writeTimer.current);
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
            onChange={(e) => onType(e.target.value)}
            placeholder="Search nasheeds, publishers, a line of poetry…"
            aria-label="Search CoolNasheed"
            className="w-full rounded-full border border-line bg-surface2/60 py-2 pl-9 pr-16 text-[13px] text-text outline-none transition-all placeholder:text-muted/80 focus:border-jade/45 focus:bg-surface2 focus:shadow-[0_0_0_4px_rgba(var(--c-glow),0.08)]"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 sm:flex">
            <Kbd>/</Kbd>
          </span>
        </form>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            className="btn-icon hidden rounded-full p-2 md:grid"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("coolnasheed:command"))
            }
            aria-label="Command palette"
            title="Command palette"
          >
            <Icon name="command" size={17} />
          </button>

          <button
            className="btn-icon grid place-items-center rounded-full p-2"
            onClick={() =>
              setSetting("theme", theme === "night" ? "dawn" : "night")
            }
            aria-label={
              theme === "night"
                ? "Switch to daylight theme"
                : "Switch to night theme"
            }
            title={theme === "night" ? "Daylight theme" : "Night theme"}
          >
            <Icon name={theme === "night" ? "moon" : "sun"} size={17} />
          </button>

          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
