import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { player } from "./audio/player";
import { currentTime } from "../store/player";
import { useSession } from "../store/session";
import { useUi } from "../store/ui";
import { catalogVersion, subscribeCatalog } from "../data/catalog";

/**
 * Re-render when the catalogue changes. Hydration and a publish both mutate the live
 * arrays in place, so a memo that only depends on its query would otherwise keep a
 * stale answer forever.
 */
export function useCatalogVersion(): number {
  return useSyncExternalStore(subscribeCatalog, catalogVersion, () => 0);
}

/** rAF loop that only re-renders when the value actually moves (≈25fps). */
export function useSmoothTime(active = true): number {
  const [t, setT] = useState(() => (active ? currentTime() : 0));
  const last = useRef(-1);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      const now = player.getTime();
      if (Math.abs(now - last.current) > 0.035) {
        last.current = now;
        setT(now);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return t;
}

export function useAnimationFrame(cb: (dt: number) => void, active = true) {
  const saved = useRef(cb);
  saved.current = cb;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let prev = performance.now();
    const loop = (now: number) => {
      const dt = now - prev;
      prev = now;
      saved.current(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useOnClickAway<T extends HTMLElement>(onAway: () => void, active = true) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    };
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [onAway, active]);
  return ref;
}

/**
 * Is this element taking text, rather than navigating the app?
 *
 * `tagName` alone is not enough: a rich-text box is a `div` with `contenteditable`,
 * and a click can land on a child of either one, so the check has to be about where
 * the event went, not about the element the listener was attached to.
 */
export function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "OPTION") return true;
  /* A rich-text box, or anything inside one — the event target is often a child
     element rather than the editable root itself. */
  const editable = typeof el.closest === "function"
    ? el.closest('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]')
    : null;
  return editable !== null;
}

export function useKeyboard(map: Record<string, (e: KeyboardEvent) => void>, active = true) {
  const saved = useRef(map);
  saved.current = map;
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const typing = isTextField(e.target);
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      /* While a field has focus, the keyboard belongs to the field. A space is a space
         and "n" is an n: a global shortcut that eats them is a text field you cannot
         type in. Shift does not make a key a shortcut either — "?" is a question mark
         while someone is typing their name, not the shortcuts sheet. Modified
         combinations still go through, and Escape still closes what is open. */
      if (typing && !mod && key !== "Escape") return;

      const combo = `${mod ? "mod+" : ""}${e.shiftKey && key.length > 1 ? "shift+" : ""}${key.toLowerCase()}`;
      const fn = saved.current[combo] ?? saved.current[key];
      if (fn) fn(e);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active]);
}

/* ---------------------------------------------------------------- accounts */

/**
 * Gate an action behind an account without ever blocking the app.
 *
 * Listening, searching and browsing need nothing. Loving, following, commenting
 * and publishing do. Returns true when the action may proceed; when it may not,
 * it opens the sign-in sheet carrying the intent, so the thing the listener was
 * trying to do happens the moment they have an account.
 */
export function useAccountGuard() {
  const signedIn = useSession((s) => s.currentId !== null);
  const requestAuth = useUi((s) => s.requestAuth);

  return useCallback(
    (label: string, run?: () => void, mode: "signin" | "signup" = "signin") => {
      if (signedIn) return true;
      requestAuth({ label, run }, mode);
      return false;
    },
    [signedIn, requestAuth],
  );
}

/** The signed-in account, reactively. */
export function useAccount() {
  const accounts = useSession((s) => s.accounts);
  const currentId = useSession((s) => s.currentId);
  return accounts.find((a) => a.id === currentId) ?? null;
}
