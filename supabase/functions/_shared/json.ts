/**
 * Response helpers.
 *
 * Every function answers in the same shape: `{ ...data }` on success, `{ error }` on
 * failure, with CORS on both. Keeping that in one file means no endpoint can forget
 * the preflight headers or invent its own error vocabulary.
 */

import { preflight, withCors } from "./cors.ts";

/** Thrown by the auth helpers, caught once per request in `serve()`. */
export class HttpError extends Error {
  readonly status: number;
  readonly field?: string;

  constructor(message: string, status = 400, field?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.field = field;
  }
}

export type JsonInit = {
  status?: number;
  cacheSeconds?: number;
  headers?: Record<string, string>;
};

export function json(data: unknown, init: JsonInit = {}): Response {
  const headers = withCors({
    "content-type": "application/json; charset=utf-8",
    ...(init.cacheSeconds
      ? {
          "cache-control": `public, max-age=${init.cacheSeconds}, s-maxage=${init.cacheSeconds}`,
        }
      : { "cache-control": "no-store" }),
    ...init.headers,
  });

  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

export function fail(message: string, status = 400, field?: string): Response {
  return json({ error: message, ...(field ? { field } : {}) }, { status });
}

/** Turn any thrown value into the one error shape the client understands. */
export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return fail(error.message, error.status, error.field);
  const message = error instanceof Error ? error.message : String(error);
  console.error("coolnasheed function error:", message);
  return fail("Something went wrong on our side.", 500);
}

/** Parse a JSON body, or throw a 400 that says what was wrong. */
export async function readBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    throw new HttpError("Could not read that request.", 400);
  }
  if (!raw.trim()) throw new HttpError("That request had no body.", 400);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError("That was not JSON.", 400);
  }
}

/**
 * Wrap a handler so OPTIONS, method checks and error mapping are all handled once.
 * `allowed` is the list of methods the endpoint answers.
 */
export function serve(
  allowed: string[],
  handler: (req: Request, url: URL) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return preflight();
    if (!allowed.includes(req.method)) {
      return fail(`${req.method} is not served here.`, 405);
    }
    try {
      return await handler(req, new URL(req.url));
    } catch (error) {
      return toResponse(error);
    }
  };
}
