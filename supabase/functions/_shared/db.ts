/**
 * Database access.
 *
 * Two clients, and the difference is the whole security story:
 *
 *   `anonClient(auth)`  — speaks with the caller's own JWT, so Row Level Security
 *                         applies exactly as it does for the browser. Anything that
 *                         writes on somebody's behalf uses this one where possible,
 *                         because then "you may only write your own rows" is enforced
 *                         by Postgres rather than by code here remembering to check.
 *
 *   `serviceClient()`   — the service-role key, which steps past RLS. Used only for
 *                         genuinely administrative work: verifying that an uploaded
 *                         object exists, counting rows for the health page, deleting
 *                         an account. Every write made with it is guarded by an
 *                         explicit ownership check in the handler first.
 *
 * A fresh client per request keeps one caller's auth state away from the next, and
 * every call has a deadline: a function that hangs is worse than a function that
 * fails, because it burns the invocation budget while it waits.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./json.ts";
import { log } from "./log.ts";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// A project on the legacy JWT keys is handed SUPABASE_SERVICE_ROLE_KEY; one on the
// new API-key system (sb_secret_…) is handed SUPABASE_SECRET_KEY. Either is the key
// that steps past RLS, and either is fine here — what must never happen is this file
// inventing one, or a browser ever seeing it.
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  "";

/** e.g. "abcdefghijklm" from https://abcdefghijklm.supabase.co — used in health output */
export const PROJECT_REF = (() => {
  const fromEnv = Deno.env.get("SUPABASE_PROJECT_REF");
  if (fromEnv) return fromEnv;
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0] ?? "unknown";
  } catch {
    return "unknown";
  }
})();

const OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

function assertUrl(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new HttpError(
      "This function has no database to talk to: SUPABASE_URL / SUPABASE_ANON_KEY are missing.",
      503,
    );
  }
}

export function anonClient(authorization?: string | null): SupabaseClient {
  assertUrl();
  const headers: Record<string, string> = {};
  if (authorization) headers.authorization = authorization;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { ...OPTIONS, global: { headers } });
}

export function serviceClient(): SupabaseClient {
  assertUrl();
  if (!SERVICE_ROLE_KEY) {
    throw new HttpError(
      "This action needs the service role key, which is not set on this project.",
      503,
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, OPTIONS);
}

export function hasServiceKey(): boolean {
  return SERVICE_ROLE_KEY.length > 0;
}

/* ------------------------------------------------------------------- timing */

/** Reject after `ms` with a TimeoutError, so a slow dependency cannot hold a request. */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label} timed out after ${ms}ms`);
          error.name = "TimeoutError";
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A query the caller is allowed to fail. Used for anything that is decoration
 * rather than the answer — a count on a dashboard, the second half of a payload.
 */
export async function optional<T>(work: Promise<T>, label: string, fallback: T, ms = 4000): Promise<T> {
  try {
    return await withTimeout(work, ms, label);
  } catch (error) {
    log.warn("query.optional_failed", { label, error: error instanceof Error ? error.message : String(error) });
    return fallback;
  }
}

/** Turn a PostgREST error into something a person can read. */
export function dbError(error: { message?: string; code?: string } | null, action: string): HttpError {
  const message = error?.message ?? action;
  switch (error?.code) {
    case "23505":
      return new HttpError("That is already there.", 409);
    case "23503":
      return new HttpError("That does not line up with the rest of the catalogue.", 400);
    case "23514":
      return new HttpError(message.replace(/^.*check constraint\s+"?\w+"?\s*/, "") || message, 400);
    case "42501":
      return new HttpError("You are not allowed to do that.", 403);
    case "PGRST116":
      return new HttpError("Nothing matched that.", 404);
    default:
      if (/row-level security|permission denied/i.test(message)) {
        return new HttpError("You are not allowed to do that.", 403);
      }
      return new HttpError(message, 400);
  }
}

/** Absolute public URL for an object in a public bucket. */
export function publicUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path.replace(/^\/+/, "")}`;
}

export type StoredObject = { size: number; contentType: string | null; updatedAt: string | null };

/**
 * What storage actually holds for a path — the only trustworthy answer to "did the
 * upload land, and is it an mp3". A client can lie about a file; the bucket cannot.
 */
export async function storageObject(
  bucket: string,
  path: string,
  ms = 5000,
): Promise<StoredObject | null> {
  const db = serviceClient();
  const { data, error } = await withTimeout(
    db.storage.from(bucket).list(path.split("/").slice(0, -1).join("/"), {
      search: path.split("/").pop() ?? path,
      limit: 1,
    }),
    ms,
    "storage.list",
  );
  if (error) throw new HttpError(`Storage would not answer: ${error.message}`, 502);
  const found = (data ?? [])[0] as
    | { metadata?: { size?: number; mimetype?: string }; updated_at?: string }
    | undefined;
  if (!found) return null;
  const size = Number(found.metadata?.size ?? 0);
  return {
    size: Number.isFinite(size) ? size : 0,
    contentType: found.metadata?.mimetype ?? null,
    updatedAt: found.updated_at ?? null,
  };
}
