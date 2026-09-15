import { useCallback, useEffect, useRef, useState } from "react";
import { player } from "./audio/player";
import { currentTime } from "../store/player";
import { useSession } from "../store/session";
import { useUi } from "../store/ui";

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

export function useKeyboard(map: Record<string, (e: KeyboardEvent) => void>, active = true) {
  const saved = useRef(map);
  saved.current = map;
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      const key = e.key;
      const combo = `${e.metaKey || e.ctrlKey ? "mod+" : ""}${e.shiftKey && key.length > 1 ? "shift+" : ""}${key.toLowerCase()}`;
      const fn = saved.current[combo] ?? (typing ? undefined : saved.current[key]);
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
