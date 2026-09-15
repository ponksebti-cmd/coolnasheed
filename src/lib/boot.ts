/**
 * What happens between "the bundle parsed" and "the home page means something".
 *
 *   1. the beacon is armed, so the first play is counted like every other
 *   2. the catalogue is fetched — one cached Edge Function call, or the RPC behind it
 *      if the functions are not deployed — and poured into the in-memory registry the
 *      whole app already reads from. Until it answers, the registry stays empty and
 *      the pages say so rather than filling the room with something invented.
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
import { ApiError, errorMessage } from "./errors";
import { bindAuthListener, isSignedIn, useSession } from "../store/session";
import { useLibrary } from "../store/library";
import { useStudio } from "../store/studio";
import { useCommunity } from "../store/community";

export type CatalogSource = "supabase" | "empty";

export type BootStatus = {
  backend: string;
  source: CatalogSource;
  songs: number;
  at: number;
  /** what went wrong, when the database was configured but would not answer */
  error: string | null;
  /** the project answers, but has no schema yet — one command away from working */
  needsSetup: boolean;
};

let started = false;
let unbindAuth: (() => void) | null = null;
let lastStatus: BootStatus | null = null;

/** Is this the "there is no database yet" failure, rather than a network or auth one? */
const isMissingSchema = (err: unknown): boolean => err instanceof ApiError && err.field === "schema";

function status(source: CatalogSource, error: string | null, needsSetup = false): BootStatus {
  lastStatus = {
    backend: backendLabel(),
    source,
    songs: TRACKS.length,
    at: catalogSyncedAt(),
    error,
    needsSetup,
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

  if (started) return lastStatus ?? status("empty", null);
  started = true;

  if (!unbindAuth) {
    unbindAuth = bindAuthListener((signedIn) => {
      if (signedIn) void loadAccountData();
      else clearAccountData();
    });
  }

  /* the catalogue -------------------------------------------------------- */
  if (!hasSupabase) {
    // no project configured: an empty room, and the shell says what is missing
    await useSession.getState().load();
    return status("empty", null);
  }

  let source: CatalogSource = "empty";
  let error: string | null = null;
  let needsSetup = false;
  try {
    const payload = await api.catalog();
    // A project with a schema but no nasheeds yet answers with an empty list, and an
    // empty list is the honest answer: hydrate it and let the pages say so.
    hydrateCatalog(payload);
    source = "supabase";
  } catch (err) {
    error = errorMessage(err, "The catalogue would not load.");
    needsSetup = isMissingSchema(err);
  }

  /* the account ---------------------------------------------------------- */
  try {
    await useSession.getState().load();
    await loadAccountData();
  } catch (err) {
    error = error ?? errorMessage(err, "Your library would not load.");
    needsSetup = needsSetup || isMissingSchema(err);
  }

  return status(source, error, needsSetup);
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
 * the moment the registry can be trusted to hold what the database holds.
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
