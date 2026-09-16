/**
 * Responses, and the one wrapper every endpoint goes through.
 *
 * What the wrapper buys each endpoint, without it having to remember any of it:
 *
 *   · CORS, on successes and on failures alike
 *   · the method allowlist, answered with 405 and an `Allow` header
 *   · a request id, echoed back and in every log line for that request
 *   · a hard deadline, so a slow database cannot hold a function until the platform
 *     kills it with a message nobody can debug
 *   · a rate limit, on reads and writes separately
 *   · one error vocabulary: `{ error, field?, requestId }`, never a stack trace
 */

import { corsHeaders, preflight } from "./cors.ts";
import { clientIp, log, requestId } from "./log.ts";
import { readLimit, writeLimit } from "./rate-limit.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly field?: string;
  readonly headers: Record<string, string>;

  constructor(message: string, status = 400, field?: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.field = field;
    this.headers = headers;
  }
}

export type JsonInit = {
  status?: number;
  cacheSeconds?: number;
  headers?: Record<string, string>;
};

export function json(data: unknown, init: JsonInit = {}, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = {
    ...extra,
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...(init.cacheSeconds
      ? { "cache-control": `public, max-age=${init.cacheSeconds}, s-maxage=${init.cacheSeconds}` }
      : { "cache-control": "no-store" }),
    ...init.headers,
  };

  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

export function fail(
  message: string,
  status = 400,
  field?: string,
  extra: Record<string, string> = {},
): Response {
  return json({ error: message, ...(field ? { field } : {}) }, { status }, extra);
}

/** Errors we raise ourselves are meant for a person; anything else is not. */
export function toResponse(error: unknown, id: string, req: Request): Response {
  const base = corsHeaders(req);
  if (error instanceof HttpError) {
    return fail(error.message, error.status, error.field, { ...base, ...error.headers, "x-request-id": id });
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    log.warn("request.timeout", { requestId: id });
    return fail("That took too long. Try again.", 504, undefined, { ...base, "x-request-id": id });
  }
  const message = error instanceof Error ? error.message : String(error);
  log.error("request.failed", { requestId: id, message });
  return fail("Something went wrong on our side.", 500, undefined, { ...base, "x-request-id": id });
}

/** Bodies are small on purpose: the biggest legitimate payload is 40 lyric lines. */
const MAX_BODY_BYTES = 256 * 1024;

export async function readBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError("That request was too large.", 413);
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    throw new HttpError("Could not read that request.", 400);
  }
  if (!raw.trim()) throw new HttpError("That request had no body.", 400);
  if (raw.length > MAX_BODY_BYTES) throw new HttpError("That request was too large.", 413);

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError("That was not JSON.", 400);
  }
}

export type ServeOptions = {
  /** milliseconds before the request gives up and answers 504 */
  timeoutMs?: number;
  /** count a write against the tighter bucket as well */
  write?: boolean;
  /** skip the read/write buckets entirely (health checks) */
  unlimited?: boolean;
};

export type ServeContext = {
  req: Request;
  url: URL;
  id: string;
  /** the caller's key for rate limiting: their id when signed in, else their IP */
  key: string;
};

export type Handler = (ctx: ServeContext) => Promise<Response>;

/**
 * Wrap an endpoint. `requireAuth` is only used to key the rate limit by account
 * instead of by address; it never blocks the request on its own.
 */
export function serve(allowed: string[], handler: Handler, options: ServeOptions = {}): (req: Request) => Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 15_000;

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return preflight(req);

    const id = requestId(req);
    const url = new URL(req.url);
    const base = () => ({ ...corsHeaders(req), "x-request-id": id });

    if (!allowed.includes(req.method)) {
      return fail(`${req.method} is not served here.`, 405, undefined, {
        ...base(),
        Allow: allowed.join(", "),
      });
    }

    const key = `${url.pathname}:${clientIp(req)}`;
    if (!options.unlimited) {
      const read = readLimit(key);
      if (!read.allowed) {
        return fail("Too many requests. Slow down a moment.", 429, undefined, {
          ...base(),
          "retry-after": String(read.retryAfter),
        });
      }
      if (options.write) {
        const write = writeLimit(key);
        if (!write.allowed) {
          return fail("Too many writes. Wait a moment and retry.", 429, undefined, {
            ...base(),
            "retry-after": String(write.retryAfter),
          });
        }
      }
    }

    const started = Date.now();
    const signal = AbortSignal.timeout(timeoutMs);
    const context: ServeContext = { req, url, id, key };
    const timeout = new Promise<Response>((resolve) => {
      signal.addEventListener("abort", () =>
        resolve(fail("That took too long. Try again.", 504, undefined, base())), { once: true });
    });

    try {
      const response = await Promise.race([handler(context), timeout]);
      const headers = new Headers(response.headers);
      for (const [header, value] of Object.entries(base())) headers.set(header, value);
      log.info("request.done", {
        requestId: id,
        method: req.method,
        path: url.pathname,
        status: response.status,
        ms: Date.now() - started,
      });
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      log.warn("request.error", {
        requestId: id,
        method: req.method,
        path: url.pathname,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      return toResponse(error, id, req);
    }
  };
}
