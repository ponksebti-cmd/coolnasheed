/**
 * What happens between "the bundle parsed" and "the home page means something".
 *
 *   1. the play beacon is armed, so the first listen is counted like every other
 *   2. the catalogue is fetched — one cached Edge Function call, or the RPC behind it
 *      when the functions are not deployed — and poured into the registry the whole app
 *      reads from. A project with nothing published answers with nothing published.
 *   3. the session is restored from Supabase Auth, and everything that belongs to it
 *      (settings, loves, sets, dhikr, the studio draft, history) follows in one call
 *   4. auth changes are subscribed to, so signing in on another tab updates this one
 *
 * None of it blocks the first paint: the shell renders immediately and the catalogue
 * fills underneath it, which is why hydration mutates the existing arrays rather than
 * replacing them.
 */

import { useEffect, useState } from "react";
import { TRACKS, catalogSyncedAt, hydrateCatalog } from "../data/catalog";
import { api, invalidateCatalog } from "./api";
import { backendLabel, hasSupabase } from "./supabase";
import { checkSchema, schemaProblem, type SchemaState } from "./schema";
import { bindBeacon } from "./beacon";
import { ApiError, errorMessage } from "./errors";
import { bindAuthListener, isSignedIn, useSession } from "../store/session";
import { useLibrary } from "../store/library";
import { useStudio } from "../store/studio";
import { useCommunity } from "../store/community";

export type CatalogSource = "supabase" | "none";

export type BootStatus = {
  backend: string;
  source: CatalogSource;
  songs: number;
  at: number;
  /** what went wrong, when the database was configured but would not answer */
  error: string | null;
  /** the project answers, but has no schema yet — one command away from working */
  needsSetup: boolean;
  /** what the database said about its own version, when it was asked */
  schema: SchemaState | null;
};

let started = false;
let unbindAuth: (() => void) | null = null;
let lastStatus: BootStatus | null = null;

/** The sentence for a database that is missing or older than this build. */
const schemaProblemFor = (schema: SchemaState): string => schemaProblem(schema) ?? "The database is not ready.";

/** Is this the "there is no database yet" failure, rather than a network or auth one? */
const isMissingSchema = (err: unknown): boolean => err instanceof ApiError && err.field === "schema";

function status(
  source: CatalogSource,
  error: string | null,
  needsSetup = false,
  schema: SchemaState | null = null,
): BootStatus {
  lastStatus = {
    backend: backendLabel(),
    source,
    songs: TRACKS.length,
    at: catalogSyncedAt(),
    error,
    needsSetup,
    schema,
  };
  return lastStatus;
}

/** Pull everything that belongs to the signed-in account. Safe to call repeatedly. */
async function loadAccountData(): Promise<void> {
  if (!isSignedIn()) return;
  await Promise.allSettled([
    useLibrary.getState().loadFromServer(),
    useStudio.getState().hydrate(),
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

  if (started) return lastStatus ?? status("none", null);
  started = true;

  if (!unbindAuth) {
    unbindAuth = bindAuthListener((signedIn) => {
      if (signedIn) void loadAccountData();
      else clearAccountData();
    });
  }

  /* the catalogue -------------------------------------------------------- */
  if (!hasSupabase) {
    await useSession.getState().load();
    return status("none", "No Supabase project is configured, so there is no catalogue to load.");
  }

  /* The schema check is started first and awaited last: it runs beside the catalogue
     read rather than after it, so a slow project costs nothing extra. */
  const schemaPromise = checkSchema();

  let source: CatalogSource = "none";
  let error: string | null = null;
  let needsSetup = false;
  try {
    const payload = await api.catalog();
    hydrateCatalog(payload);
    source = "supabase";
  } catch (err) {
    error = errorMessage(err, "The catalogue would not load.");
    needsSetup = isMissingSchema(err);
  }

  /* the schema ------------------------------------------------------------ */
  /* Asked before anything writes, so a project running an older schema is identified
     as such rather than through a constraint violation three screens later. */
  const schema = await schemaPromise;
  /* A database that is behind is worth saying out loud even when the catalogue read
     worked: reads survive a stale schema, writes do not. */
  if (schema.state === "behind" || schema.state === "missing") {
    error = schemaProblemFor(schema);
    needsSetup = true;
  }

  /* the account ---------------------------------------------------------- */
  try {
    await useSession.getState().load();
    await loadAccountData();
  } catch (err) {
    error = error ?? errorMessage(err, "Your library would not load.");
    needsSetup = needsSetup || isMissingSchema(err);
  }

  return status(source, error, needsSetup, schema);
}

/** Re-read the catalogue after publishing, so the new nasheed is everywhere at once. */
export async function refreshCatalog(): Promise<number> {
  if (!hasSupabase) return TRACKS.length;
  invalidateCatalog();
  try {
    const payload = await api.catalog(true);
    return hydrateCatalog(payload);
  } catch {
    return TRACKS.length;
  }
}

/**
 * Boot once, from the shell. Returns null until the catalogue has answered, which is
 * the moment the registry can be trusted to hold the live catalogue.
 */
export function useBoot(): BootStatus | null {
  const [state, setState] = useState<BootStatus | null>(lastStatus);

  useEffect(() => {
    let live = true;
    void bootApp().then((result) => {
      if (live) setState(result);
    });
    return () => {
      live = false;
    };
  }, []);

  return state;
}
