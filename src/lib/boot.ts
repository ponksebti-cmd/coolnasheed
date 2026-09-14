/**
 * What happens between "the bundle parsed" and "the home page means something".
 *
 *   1. the beacon is armed, so the first play is counted like every other
 *   2. the catalogue is fetched — one cached Edge Function call, or the RPC behind it
 *      if the functions are not deployed — and poured into the in-memory registry the
 *      whole app already reads from. If that fails for any reason the bundled
 *      catalogue stays where it is and the app carries on playing.
 *   3. the session is restored from Supabase Auth, and everything that belongs to it
 *      (loves, follows, sets, history, what you published) follows in one bootstrap
 *   4. auth changes are subscribed to, so signing in on another tab updates this one
 *
 * None of it blocks the first paint: the shell renders immediately and the catalogue
 * swaps underneath it. That is why hydration mutates the existing arrays rather than
 * replacing them.
 */

import { useEffect, useState } from "react";
import { TRACKS, catalogSyncedAt, hydrateCatalog } from "../data/catalog";
import { api, invalidateCatalog } from "./api";
import { backendLabel, hasSupabase } from "./supabase";
import { bindBeacon } from "./beacon";
import { errorMessage } from "./errors";
import { bindAuthListener, isSignedIn, useSession } from "../store/session";
import { useLibrary } from "../store/library";
import { useStudio } from "../store/studio";
import { useCommunity } from "../store/community";

export type CatalogSource = "supabase" | "bundled";

export type BootStatus = {
  backend: string;
  source: CatalogSource;
  songs: number;
  at: number;
  /** what went wrong, when the database was configured but would not answer */
  error: string | null;
};

let started = false;
let unbindAuth: (() => void) | null = null;
let lastStatus: BootStatus | null = null;

function status(source: CatalogSource, error: string | null): BootStatus {
  lastStatus = {
    backend: backendLabel(),
    source,
    songs: TRACKS.length,
    at: catalogSyncedAt(),
    error,
  };
  return lastStatus;
}

/** Pull everything that belongs to the signed-in account. Safe to call repeatedly. */
async function loadAccountData(): Promise<void> {
  if (!isSignedIn()) return;
  await Promise.allSettled([
    useLibrary.getState().loadFromServer(),
    useStudio.getState().loadMine(true),
    useCommunity.getState().loadMine(true),
  ]);
}

/** Drop everything that belonged to whoever just signed out. */
function clearAccountData(): void {
  useLibrary.getState().clearAccountData();
  useCommunity.getState().reset();
  useStudio.getState().applyServerSongs([]);
}

export async function bootApp(): Promise<BootStatus> {
  bindBeacon();

  if (started) return lastStatus ?? status("bundled", null);
  started = true;

  if (!unbindAuth) {
    unbindAuth = bindAuthListener((signedIn) => {
      if (signedIn) void loadAccountData();
      else clearAccountData();
    });
  }

  /* the catalogue -------------------------------------------------------- */
  if (!hasSupabase) {
    // demo mode: the bundled nasheeds are the catalogue, and nothing is missing
    await useSession.getState().load();
    return status("bundled", null);
  }

  let source: CatalogSource = "bundled";
  let error: string | null = null;
  try {
    const payload = await api.catalog();
    // A project that is set up but not seeded yet answers with nothing. Pouring that
    // over the registry would leave an empty room with a working backend, which is
    // the worst of both: so the bundled catalogue stays until the database has
    // nasheeds of its own, and the shell says which one is on screen.
    if (payload.songs.length > 0) {
      hydrateCatalog(payload);
      source = "supabase";
    }
  } catch (err) {
    error = errorMessage(err, "The catalogue would not load.");
  }

  /* the account ---------------------------------------------------------- */
  try {
    await useSession.getState().load();
    await loadAccountData();
  } catch (err) {
    error = error ?? errorMessage(err, "Your library would not load.");
  }

  return status(source, error);
}

/** Re-read the catalogue after publishing, so the new nasheed is everywhere at once. */
export async function refreshCatalog(): Promise<number> {
  if (!hasSupabase) return TRACKS.length;
  invalidateCatalog();
  try {
    const payload = await api.catalog(true);
    return payload.songs.length > 0 ? hydrateCatalog(payload) : TRACKS.length;
  } catch {
    return TRACKS.length;
  }
}

/**
 * Boot once, from the shell. Returns null until the catalogue has answered, which is
 * the moment the registry can be trusted to hold more than the bundled nasheeds.
 */
export function useBoot(): BootStatus | null {
  const [state, setState] = useState<BootStatus | null>(lastStatus);

  useEffect(() => {
    let live = true;
    void bootApp().then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, []);

  return state;
}
