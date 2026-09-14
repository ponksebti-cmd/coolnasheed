/**
 * Database clients.
 *
 * Two, and the difference is the whole security story:
 *
 *   `anonClient(auth)`  — speaks with the caller's own JWT, so Row Level Security
 *                         applies exactly as it does for the browser. Anything that
 *                         writes on somebody's behalf uses this one, because then
 *                         "you may only write your own rows" is enforced by Postgres
 *                         rather than by code here remembering to check.
 *
 *   `serviceClient()`   — the service role key, which steps past RLS. Used only where
 *                         the work is genuinely administrative: verifying a storage
 *                         object exists, counting rows for the health page, deleting
 *                         an account.
 *
 * A fresh client per request keeps one caller's auth state away from the next.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./json.ts";

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
      500,
    );
  }
}

/** A client that acts as the caller (or as `anon` when no Authorization header). */
export function anonClient(authorization?: string | null): SupabaseClient {
  assertUrl();
  const headers: Record<string, string> = {};
  if (authorization) headers.authorization = authorization;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    ...OPTIONS,
    global: { headers },
  });
}

/** A client that steps past RLS. Only for administrative work. */
export function serviceClient(): SupabaseClient {
  assertUrl();
  if (!SERVICE_ROLE_KEY) {
    throw new HttpError(
      "This action needs the service role key, which is not set on this project.",
      500,
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, OPTIONS);
}

export function hasServiceKey(): boolean {
  return SERVICE_ROLE_KEY.length > 0;
}

/** Absolute public URL for an object in a public bucket. */
export function publicUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}
