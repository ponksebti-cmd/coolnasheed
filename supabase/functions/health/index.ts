/**
 * GET /health — is this project actually working?
 *
 * The first thing the dashboard reads, and the answer a support conversation needs:
 * which part is down. Four checks, each with its own deadline, run in parallel, and
 * **none of them can make the request fail** — a health endpoint that 500s when the
 * database is down is a health endpoint that cannot tell you the database is down.
 *
 * `ok` is true only when everything that must work does. The counts are informative:
 * a project with zero nasheeds is healthy and empty, which is the correct state for a
 * catalogue that fills from uploads.
 */

import { hasServiceKey, serviceClient, anonClient, withTimeout } from "../_shared/db.ts";
import { json, serve } from "../_shared/json.ts";
import type { HealthResponse } from "../../../shared/types.ts";

const VERSION = "2.0.0-matcha";

type Probe = { ok: boolean; detail?: string };

async function checkDatabase(): Promise<Probe> {
  try {
    const db = hasServiceKey() ? serviceClient() : anonClient();
    const { error } = await withTimeout(db.from("songs").select("id").limit(1), 5000, "songs.select");
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        return { ok: false, detail: "the tables are missing — run the migrations" };
      }
      return { ok: false, detail: error.message.slice(0, 160) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message.slice(0, 160) : "unreachable" };
  }
}

async function checkStorage(): Promise<Probe> {
  try {
    const db = hasServiceKey() ? serviceClient() : anonClient();
    const { data, error } = await withTimeout(db.storage.listBuckets(), 5000, "storage.listBuckets");
    if (error) return { ok: false, detail: error.message.slice(0, 160) };
    const ids = (data ?? []).map((bucket) => bucket.id);
    const missing = ["nasheed-audio", "nasheed-artwork", "nasheed-avatars"].filter(
      (id) => !ids.includes(id),
    );
    return missing.length ? { ok: false, detail: `missing buckets: ${missing.join(", ")}` } : { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message.slice(0, 160) : "unreachable" };
  }
}

async function checkAuth(): Promise<Probe> {
  try {
    const db = anonClient();
    const { error } = await withTimeout(db.auth.getSession(), 4000, "auth.getSession");
    return error ? { ok: false, detail: error.message.slice(0, 160) } : { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message.slice(0, 160) : "unreachable" };
  }
}

type Counts = { profiles: number; songs: number; comments: number; playEvents: number; storageBytes: number };

async function counts(): Promise<Counts> {
  const empty: Counts = { profiles: 0, songs: 0, comments: 0, playEvents: 0, storageBytes: 0 };
  if (!hasServiceKey()) return empty;
  try {
    const db = serviceClient();
    const head = { count: "exact" as const, head: true };
    const [profiles, songs, comments, plays] = await Promise.all([
      withTimeout(db.from("profiles").select("id", head), 5000, "count.profiles"),
      withTimeout(db.from("songs").select("id", head), 5000, "count.songs"),
      withTimeout(db.from("comments").select("id", head), 5000, "count.comments"),
      withTimeout(db.from("play_events").select("id", head), 5000, "count.play_events"),
    ]);
    return {
      profiles: profiles.count ?? 0,
      songs: songs.count ?? 0,
      comments: comments.count ?? 0,
      playEvents: plays.count ?? 0,
      storageBytes: 0,
    };
  } catch {
    return empty;
  }
}

async function storageBytes(): Promise<number> {
  if (!hasServiceKey()) return 0;
  try {
    const db = serviceClient();
    const { data } = await withTimeout(
      db.from("storage_usage").select("bytes").maybeSingle(),
      4000,
      "storage_usage",
    );
    const bytes = Number((data as { bytes?: number } | null)?.bytes ?? 0);
    return Number.isFinite(bytes) ? bytes : 0;
  } catch {
    // storage.objects is not readable through PostgREST on every project; the number is
    // nice to have, never a reason to fail a health check
    return 0;
  }
}

Deno.serve(
  serve(["GET"], async ({ id }) => {
    const started = Date.now();
    const [database, storage, auth] = await Promise.all([checkDatabase(), checkStorage(), checkAuth()]);
    const tally = await counts();
    const bytes = await storageBytes();

    const payload: HealthResponse & { details?: Record<string, string> } = {
      ok: database.ok && storage.ok,
      version: VERSION,
      driver: "supabase",
      project: Deno.env.get("SUPABASE_PROJECT_REF") ?? "unknown",
      checks: { database: database.ok, storage: storage.ok, auth: auth.ok },
      counts: {
        profiles: tally.profiles,
        songs: tally.songs,
        comments: tally.comments,
        playEvents: tally.playEvents,
      },
      storageBytes: bytes || tally.storageBytes,
      tookMs: Date.now() - started,
    };

    const details: Record<string, string> = {};
    for (const [name, probe] of Object.entries({ database, storage, auth })) {
      if (!probe.ok && probe.detail) details[name] = probe.detail;
    }
    if (Object.keys(details).length) payload.details = details;

    return json(payload, {}, { "x-request-id": id });
  }, { timeoutMs: 12_000, unlimited: true }),
);
