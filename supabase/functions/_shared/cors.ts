/**
 * CORS for the Edge Functions.
 *
 * The functions are called from a browser, so every response carries these headers and
 * every preflight is answered without touching the database. `*` is right here because
 * nothing in a response is secret: authentication travels in the Authorization header,
 * and authorization happens in Postgres.
 */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-nasheed-client",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** Answer an OPTIONS preflight. Costs no database read and no auth check. */
export function preflight(): Response {
  return new Response("ok", { status: 204, headers: CORS_HEADERS });
}

export function withCors(headers: Record<string, string> = {}): Record<string, string> {
  return { ...CORS_HEADERS, ...headers };
}
