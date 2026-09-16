/**
 * Handing somebody the SQL.
 *
 * When the app can tell that a project's schema is missing or older than this build, the
 * sentence it shows ends with "run the SQL". For a person who has never opened the Supabase
 * dashboard that is still two unknown steps: find the file, copy 116 KB of it. The file is
 * served next to the app (`public/setup.sql`, written by `npm run sql:bundle`), so this
 * component does the part a browser can do.
 *
 * Three ways, in order, because the first one is not always available:
 *
 *   1. `navigator.clipboard.writeText` — clean, and what happens on a normal site;
 *   2. a hidden `textarea` and `document.execCommand("copy")` — the API that still works
 *      inside an iframe that was not granted `clipboard-write`, which is exactly the case
 *      for the sandboxed preview this app is often viewed in. Without it, the button says
 *      "could not copy", which is true and useless;
 *   3. the SQL itself, in a box on the page, already selected, with one instruction:
 *      press ⌘C. No clipboard permission is needed to select text, and no popup blocker
 *      can stop it. This is also the only path that works if `fetch` is blocked.
 *
 * Nothing in the file is secret: it is the same `create table` / `create policy` text that
 * is in the repository.
 */

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Icon } from "./ui/Icons";

type State = "idle" | "working" | "copied" | "shown" | "failed";

/* Served from the site root: `vite.config.ts` sets no `base`, so the app is always at `/`. */
const SETUP_URL = "/setup.sql";

export function SetupSqlButton({ className }: { className?: string }) {
  const [state, setState] = useState<State>("idle");
  const [sql, setSql] = useState("");
  const [problem, setProblem] = useState("");
  const box = useRef<HTMLTextAreaElement | null>(null);

  /* Whatever ended up in the box is selected, so the next keystroke is ⌘C. */
  useEffect(() => {
    if (state !== "shown" || !box.current) return;
    box.current.focus();
    box.current.select();
  }, [state]);

  /** The clipboard API first, then the old one, then the box on the page. */
  const putItSomewhere = async (text: string): Promise<boolean> => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard API here");
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* Somewhere that says no: an unfocused document, an iframe without permission, a
         browser that has removed the API. The legacy path is still the one that works
         in all three. */
    }
    try {
      const hidden = document.createElement("textarea");
      hidden.value = text;
      hidden.setAttribute("readonly", "");
      hidden.style.position = "fixed";
      hidden.style.top = "-1000px";
      hidden.style.opacity = "0";
      document.body.appendChild(hidden);
      hidden.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(hidden);
      if (ok) return true;
    } catch {
      /* and if that is gone too, the box below is the answer */
    }
    return false;
  };

  const run = async () => {
    setState("working");
    setProblem("");
    try {
      const response = await fetch(SETUP_URL);
      if (!response.ok) throw new Error(`the file answered ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("the file is empty");
      setSql(text);
      const copied = await putItSomewhere(text);
      setState(copied ? "copied" : "shown");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "it would not load");
      setState("failed");
    }
  };

  const label = (): string => {
    switch (state) {
      case "working":
        return "Fetching the SQL…";
      case "copied":
        return "Copied — paste it into the SQL editor and press Run";
      case "shown":
        return "Select all, then press ⌘C (Ctrl+C)";
      case "failed":
        return "Could not load the SQL here";
      default:
        return "Get the SQL that fixes this";
    }
  };

  return (
    <div className={clsx("mt-2", className)}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={state === "working"}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-[transform,background-color,border-color,color] duration-200 active:scale-[0.97] disabled:opacity-60",
          state === "copied"
            ? "border-jade/50 bg-jade/15 text-jade"
            : "border-line bg-bg/70 text-text/90 hover:border-gold/50 hover:text-goldsoft",
        )}
      >
        <Icon name={state === "copied" ? "check" : "copy"} size={13} />
        {label()}
      </button>

      {state === "failed" ? (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
          {problem}. Open{" "}
          <a
            href={SETUP_URL}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted hover:text-text"
          >
            {SETUP_URL}
          </a>{" "}
          in a new tab and copy it from there — or run{" "}
          <code className="rounded bg-bg/70 px-1 py-0.5 font-mono text-[11px]">
            npm run setup
          </code>{" "}
          on the machine that has the repository.
        </p>
      ) : null}

      {state === "shown" ? (
        <div className="mt-2">
          <textarea
            ref={box}
            readOnly
            value={sql}
            rows={10}
            spellCheck={false}
            aria-label="The SQL that sets up the database"
            className="scroll-slim w-full resize-y rounded-lg border border-line bg-bg/80 p-2.5 font-mono text-[11px] leading-relaxed text-text2 focus:border-gold/50 focus:outline-none"
          />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
            It is already selected — press ⌘C (Ctrl+C), then paste it into{" "}
            <span className="text-text2">Supabase → SQL Editor → New query</span> and
            press Run. It is safe to run more than once.
          </p>
        </div>
      ) : null}
    </div>
  );
}
