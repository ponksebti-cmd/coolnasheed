/**
 * The Supabase client, and the four things the rest of the app needs from it.
 *
 *   `hasSupabase`  — are we wired to a project, or running on the bundled catalogue?
 *   `sb()`         — the browser client (auth, PostgREST, storage, functions)
 *   `invoke()`     — call an Edge Function and get JSON or a real error back
 *   `upload()`     — put a file in a bucket under your own folder
 *
 * The anon key in `VITE_SUPABASE_ANON_KEY` is public on purpose: it is the key a
 * browser is meant to hold, and Row Level Security is what decides what it may do.
 * The service-role key lives only in the Edge Functions, never here.
 *
 * With no credentials configured nothing throws at import time — the app boots into
 * demo mode, the bundled catalogue plays, and any write raises `DemoModeError`, which
 * the interface turns into "connect a project" instead of a failure.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AUDIO_BUCKET, ARTWORK_BUCKET, MAX_ARTWORK_BYTES, MAX_AUDIO_BYTES, type StorageBucket } from "../../shared/types";
import { ApiError, ApiUnreachable, AuthError, DemoModeError } from "./errors";

/**
 * Read defensively: a bundler that does not inject `import.meta.env` (the smoke-test
 * harness, a plain `esbuild --format=cjs`) leaves it undefined, and the honest answer
 * in that case is "no project configured" rather than a crash at import time.
 */
const env: ImportMetaEnv = (import.meta as unknown as { env?: ImportMetaEnv }).env ?? {};

const rawUrl = (env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const rawKey = (env.VITE_SUPABASE_ANON_KEY ?? "").trim();

export const supabaseUrl = rawUrl;
export const supabaseAnonKey = rawKey;

/** True when both values look like a real project. */
export const hasSupabase: boolean = /^https?:\/\/\S+$/.test(rawUrl) && rawKey.length >= 20;

/** e.g. "abcdefghijklm" — shown on the dashboard so you know which project is live. */
export const projectRef: string = (() => {
  if (!hasSupabase) return "";
  try {
    return new URL(rawUrl).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
})();

let client: SupabaseClient | null = null;

/** The client, or null in demo mode. Never throws. */
export function maybeSb(): SupabaseClient | null {
  if (!hasSupabase) return null;
  if (!client) {
    client = createClient(rawUrl, rawKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "coolnasheed:auth",
      },
      global: { headers: { "x-client-info": "coolnasheed-web" } },
    });
  }
  return client;
}

/** The client, or a `DemoModeError` explaining what to put in `.env`. */
export function sb(action = "that"): SupabaseClient {
  const existing = maybeSb();
  if (!existing) throw new DemoModeError(action);
  return existing;
}

/* ------------------------------------------------------------------- storage */

/** Absolute public URL for an object, or null when there is nothing to point at. */
export function publicUrl(bucket: StorageBucket, path: string | null | undefined): string | null {
  if (!path || !hasSupabase) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${rawUrl}/storage/v1/object/public/${bucket}/${path.replace(/^\/+/, "")}`;
}

export const audioUrl = (path: string | null | undefined): string | null => publicUrl(AUDIO_BUCKET, path);
export const artworkUrl = (path: string | null | undefined): string | null => publicUrl(ARTWORK_BUCKET, path);

/**
 * `<uid>/<prefix>-<stamp>-<nonce>.<ext>` — the shape the bucket policies expect, so
 * an upload can only ever land in the uploader's own folder.
 */
export function storagePath(ownerId: string, prefix: string, filename: string): string {
  const ext = (filename.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 6) || "bin";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${ownerId}/${prefix}-${stamp}-${nonce}.${ext}`;
}

export type UploadOptions = { bucket?: StorageBucket; contentType?: string };

/**
 * Put a file in a bucket. Returns the path (not the URL) because that is what the
 * `songs` row stores; URLs are derived, so a project can move without rewriting rows.
 */
export async function upload(
  ownerId: string,
  prefix: string,
  file: File,
  options: UploadOptions = {},
): Promise<string> {
  const client = sb("upload a file");
  const bucket = options.bucket ?? (file.type.startsWith("image/") ? ARTWORK_BUCKET : AUDIO_BUCKET);
  const limit = bucket === AUDIO_BUCKET ? MAX_AUDIO_BYTES : MAX_ARTWORK_BYTES;

  if (file.size > limit) {
    throw new ApiError(
      `That file is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${(limit / 1048576).toFixed(0)} MB.`,
      413,
      bucket === AUDIO_BUCKET ? "audio" : "artwork",
    );
  }
  if (file.size === 0) throw new ApiError("That file is empty.", 400, "file");

  const path = storagePath(ownerId, prefix, file.name || `${prefix}.bin`);
  const { error } = await client.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: options.contentType ?? (file.type || undefined),
  });

  if (error) {
    throw new ApiError(
      /policy|row-level/i.test(error.message)
        ? "Storage refused that upload. Sign in again and retry."
        : `The upload failed: ${error.message}`,
      /policy|row-level/i.test(error.message) ? 403 : 400,
    );
  }
  return path;
}

/* ---------------------------------------------------------------- functions */

export type InvokeInit = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
};

type InvokeFailure = { message: string; name?: string; context?: Response };

/** Read the `{ error }` body a function answered with, when there is one. */
async function messageFrom(error: InvokeFailure): Promise<{ message: string; status: number }> {
  const context = error.context;
  if (context) {
    try {
      const parsed = (await context.json()) as { error?: string; field?: string };
      if (parsed?.error) return { message: parsed.error, status: context.status };
    } catch {
      // a non-JSON body: fall through to the generic message
    }
    return { message: `The function answered ${context.status}.`, status: context.status };
  }
  if (error.name === "FunctionsFetchError") {
    return { message: "Cannot reach the Edge Functions. Are they deployed?", status: 0 };
  }
  return { message: error.message || "The function did not answer.", status: 502 };
}

/**
 * Call an Edge Function and get its JSON.
 *
 * supabase-js attaches the apikey and, when there is a session, the caller's JWT —
 * which is what lets a function tell a listener from a member of staff.
 */
export async function invoke<T>(name: string, init: InvokeInit = {}): Promise<T> {
  const client = sb(`run ${name}`);

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();

  const { data, error } = await client.functions.invoke<T>(`${name}${query ? `?${query}` : ""}`, {
    method: init.method ?? "POST",
    body: init.body === undefined ? undefined : (init.body as Record<string, unknown>),
  });

  if (error) {
    const shaped = await messageFrom(error as InvokeFailure);
    if (shaped.status === 401 || shaped.status === 403) throw new AuthError(shaped.message);
    if (shaped.status === 0) throw new ApiUnreachable(shaped.message);
    throw new ApiError(shaped.message, shaped.status);
  }
  return data as T;
}

/** The current access token, for the rare call that has to set its own header. */
export async function accessToken(): Promise<string | null> {
  const client = maybeSb();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Where the app is pointed, in one line, for the boot log and the dashboard. */
export function backendLabel(): string {
  return hasSupabase ? `supabase:${projectRef}` : "demo (bundled catalogue)";
}
