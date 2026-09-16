/**
 * The Supabase client, and the four things the rest of the app needs from it.
 *
 *   `hasSupabase`  — are we wired to a project, or is this build standing on its own?
 *   `sb()`         — the browser client (auth, PostgREST, storage, functions)
 *   `invoke()`     — call an Edge Function and get JSON or a real error back
 *   `upload()`     — put a file in a bucket under your own folder
 *
 * The anon key in `VITE_SUPABASE_ANON_KEY` is public on purpose: it is the key a
 * browser is meant to hold, and Row Level Security is what decides what it may do.
 * The service-role key lives only in the Edge Functions, never here.
 *
 * With no credentials configured nothing throws at import time — the app renders and
 * says there is no project connected. There is no local catalogue to fall back to:
 * the catalogue is the database.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AUDIO_BUCKET,
  ARTWORK_BUCKET,
  AVATAR_BUCKET,
  MAX_ARTWORK_BYTES,
  MAX_AVATAR_BYTES,
  MAX_AUDIO_BYTES,
  type StorageBucket,
} from "../../shared/types";
import { ApiError, ApiUnreachable, AuthError, DemoModeError } from "./errors";
import { shrinkAudio, shrinkImage } from "./compress";

/**
 * Read defensively, twice over. A bundler that does not inject `import.meta.env` (a
 * plain `esbuild --format=cjs`, the smoke-test harness) leaves it undefined, and the
 * honest answer then is "no project configured" rather than a crash at import time.
 *
 * `globalThis.__COOLNASHEED_ENV__` is the override the harnesses use: it is read after
 * the build, so a test can point the client at a project that exists — or deliberately
 * at one that does not — without a build flag per case.
 */
type EnvShape = Partial<
  Record<"VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY", string>
>;

const injected: EnvShape =
  (import.meta as unknown as { env?: EnvShape }).env ?? {};
const runtime: EnvShape =
  (globalThis as { __COOLNASHEED_ENV__?: EnvShape }).__COOLNASHEED_ENV__ ?? {};
const env: EnvShape = { ...runtime, ...injected };

const rawUrl = (env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const rawKey = (env.VITE_SUPABASE_ANON_KEY ?? "").trim();

export const supabaseUrl = rawUrl;
export const supabaseAnonKey = rawKey;

/** True when both values look like a real project. */
export const hasSupabase: boolean =
  /^https?:\/\/\S+$/.test(rawUrl) && rawKey.length >= 20;

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
export function publicUrl(
  bucket: StorageBucket,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  // an object URL from a file that has not been uploaded yet, or an absolute URL
  if (/^(https?|blob|data):/.test(path)) return path;
  if (!hasSupabase) return null;
  return `${rawUrl}/storage/v1/object/public/${bucket}/${path.replace(/^\/+/, "")}`;
}

export const audioUrl = (path: string | null | undefined): string | null =>
  publicUrl(AUDIO_BUCKET, path);
export const artworkUrl = (path: string | null | undefined): string | null =>
  publicUrl(ARTWORK_BUCKET, path);
export const avatarUrl = (path: string | null | undefined): string | null =>
  publicUrl(AVATAR_BUCKET, path);

/**
 * `<uid>/<prefix>-<stamp>-<nonce>.<ext>` — the shape the bucket policies expect, so
 * an upload can only ever land in the uploader's own folder.
 */
export function storagePath(
  ownerId: string,
  prefix: string,
  filename: string,
): string {
  const ext =
    (filename.split(".").pop() ?? "bin")
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 6) || "bin";
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${ownerId}/${prefix}-${stamp}-${nonce}.${ext}`;
}

export type UploadOptions = {
  bucket?: StorageBucket;
  contentType?: string;
  /** called with 0‥1 while a recording is being brought under the size limit */
  onStage?: (progress: number) => void;
};

/**
 * Put a file in a bucket. Returns the path (not the URL) because that is what the `songs`
 * row stores — URLs are derived, so a project can move without rewriting rows — plus the
 * size that actually landed, which is what the row must record when the file was
 * compressed on the way out.
 *
 * Anything over the limit is brought under it first — images are resized, mp3s are
 * transcoded — and a file that already fits is uploaded untouched. When the compressor
 * cannot do it honestly (a recording far too long for 5 MB) it says so and stops, which
 * is the correct outcome: quietly shipping a ruined recording is not.
 */
export async function upload(
  ownerId: string,
  prefix: string,
  file: File,
  options: UploadOptions = {},
): Promise<{ path: string; bytes: number; contentType: string }> {
  const client = sb("upload a file");
  const bucket =
    options.bucket ??
    (file.type.startsWith("image/") ? ARTWORK_BUCKET : AUDIO_BUCKET);
  const limit =
    bucket === AUDIO_BUCKET
      ? MAX_AUDIO_BYTES
      : bucket === AVATAR_BUCKET
        ? MAX_AVATAR_BYTES
        : MAX_ARTWORK_BYTES;

  let ready = file;
  try {
    ready =
      bucket === AUDIO_BUCKET
        ? await shrinkAudio(file, limit, options.onStage)
        : await shrinkImage(file, limit);
  } catch (err) {
    // "too long to fit" is a real answer; anything else means carry on and let the
    // size check below report the honest problem in its own words
    if (err instanceof ApiError) throw err;
    ready = file;
  }

  if (ready.size > limit) {
    throw new ApiError(
      `That file is ${(ready.size / 1048576).toFixed(1)} MB; the limit is ${(limit / 1048576).toFixed(1)} MB.`,
      413,
      bucket === AUDIO_BUCKET ? "audio" : "artwork",
    );
  }
  if (ready.size === 0) throw new ApiError("That file is empty.", 400, "file");
  if (bucket === AUDIO_BUCKET && !/\.mp3$/i.test(ready.name)) {
    throw new ApiError("Recordings must be .mp3 files.", 400, "audio");
  }
  if (bucket === AVATAR_BUCKET && !ready.type.startsWith("image/")) {
    throw new ApiError("A picture has to be an image.", 400, "avatar");
  }

  const path = storagePath(ownerId, prefix, ready.name || `${prefix}.bin`);
  const { error } = await client.storage.from(bucket).upload(path, ready, {
    cacheControl: "3600",
    upsert: false,
    contentType: options.contentType ?? (ready.type || undefined),
  });

  if (error) {
    throw new ApiError(
      /policy|row-level/i.test(error.message)
        ? "Storage refused that upload. Sign in again and retry."
        : `The upload failed: ${error.message}`,
      /policy|row-level/i.test(error.message) ? 403 : 400,
    );
  }
  return {
    path,
    bytes: ready.size,
    contentType: options.contentType ?? ready.type ?? "",
  };
}

/* ---------------------------------------------------------------- functions */

export type InvokeInit = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
};

type InvokeFailure = { message: string; name?: string; context?: Response };

/**
 * Read what a failed function call actually said.
 *
 * The rule here is that no sentence may contain `undefined`. This used to end with
 * "The function answered undefined." whenever the response was not a `Response` at all,
 * which tells the person nothing and reads like a bug in the app — because it was. Every
 * path now ends in a sentence that says what happened, and the status is only ever a
 * number.
 */
async function messageFrom(
  error: InvokeFailure,
  name: string,
): Promise<{ message: string; status: number }> {
  const context = error.context as (Response & { status?: number }) | undefined;
  const status = typeof context?.status === "number" ? context.status : 0;
  const label = `the "${name}" function`;

  if (context) {
    // a JSON { error } body is the function speaking for itself
    try {
      const parsed = (await context.clone().json()) as {
        error?: string;
        field?: string;
      };
      if (parsed?.error) return { message: parsed.error, status };
    } catch {
      /* not JSON — try it as text below */
    }

    let body = "";
    try {
      body = (await context.clone().text()).trim();
    } catch {
      /* the body was already read, or there was none */
    }
    const firstLine = body.split("\n")[0]?.slice(0, 160) ?? "";

    if (status === 0) {
      return {
        message: firstLine
          ? `${label[0]!.toUpperCase()}${label.slice(1)} did not answer properly: ${firstLine}`
          : `Could not get a real answer from ${label}. It is most likely not deployed on this project yet — the app will do the work directly instead.`,
        status: 0,
      };
    }
    if (!body) {
      return {
        message:
          status === 404
            ? `${label[0]!.toUpperCase()}${label.slice(1)} is not deployed on this project yet.`
            : `The ${name} function answered ${status} without saying why.`,
        status,
      };
    }
    return { message: firstLine, status };
  }

  if (error.name === "FunctionsFetchError") {
    return {
      message: `Cannot reach ${label}. Are the Edge Functions deployed?`,
      status: 0,
    };
  }
  const fallback = (error.message ?? "").trim();
  return {
    message: fallback || `The ${name} function did not answer.`,
    status: 502,
  };
}

/**
 * Call an Edge Function and get its JSON.
 *
 * supabase-js attaches the apikey and, when there is a session, the caller's JWT —
 * which is what lets a function tell a listener from a member of staff.
 */
export async function invoke<T>(
  name: string,
  init: InvokeInit = {},
): Promise<T> {
  const client = sb(`run ${name}`);

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();

  const { data, error } = await client.functions.invoke<T>(
    `${name}${query ? `?${query}` : ""}`,
    {
      method: init.method ?? "POST",
      body:
        init.body === undefined
          ? undefined
          : (init.body as Record<string, unknown>),
    },
  );

  if (error) {
    const shaped = await messageFrom(error as InvokeFailure, name);
    if (shaped.status === 401 || shaped.status === 403)
      throw new AuthError(shaped.message);
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
  return hasSupabase ? `supabase:${projectRef}` : "no project";
}
