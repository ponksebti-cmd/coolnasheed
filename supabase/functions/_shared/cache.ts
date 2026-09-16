/**
 * The cache in front of the database.
 *
 * Two payloads are asked for by everybody — the catalogue and the public charts — and
 * on a free-tier project the database is the thing that throttles, not the function
 * invocations. Three behaviours, and each of them is there for a reason:
 *
 *   · a TTL, so a thousand visitors in a minute cost one query
 *   · stale-while-revalidate, so the visitor who arrives as the entry expires waits
 *     for nothing: they get the previous payload while one refresh happens behind them
 *   · single-flight, so twenty simultaneous arrivals do not become twenty queries
 *
 * An `ETag` goes out with every response and `If-None-Match` is honoured, which turns a
 * repeat visit into a 304 with no body at all.
 *
 * The platform's Cache API is used when it exists (it is what makes the cache shared
 * across isolates); when it does not, an in-memory map still gives an isolate the same
 * behaviour. Neither is load-bearing: if both are missing, `cached()` simply builds.
 */

import { corsHeaders } from "./cors.ts";
import { log } from "./log.ts";

type Entry = { body: string; etag: string; storedAt: number; status: number };

const MEMORY = new Map<string, Entry>();
const IN_FLIGHT = new Map<string, Promise<Entry>>();

const MAX_ENTRIES = 64;

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open("coolnasheed");
  } catch {
    return null;
  }
}

function keyFor(name: string, vary: string): Request {
  return new Request(`https://coolnasheed.cache/${name}${vary ? `?${vary}` : ""}`);
}

async function read(name: string, vary: string): Promise<Entry | null> {
  const memory = MEMORY.get(`${name}?${vary}`);
  if (memory) return memory;
  const cache = await openCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(keyFor(name, vary));
    if (!hit) return null;
    const body = await hit.text();
    const entry: Entry = {
      body,
      etag: hit.headers.get("etag") ?? etagFor(body),
      storedAt: Number(hit.headers.get("x-stored-at") ?? Date.now()),
      status: hit.status,
    };
    MEMORY.set(`${name}?${vary}`, entry);
    return entry;
  } catch {
    return null;
  }
}

async function write(name: string, vary: string, entry: Entry): Promise<void> {
  MEMORY.set(`${name}?${vary}`, entry);
  if (MEMORY.size > MAX_ENTRIES) {
    const oldest = [...MEMORY.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
    if (oldest) MEMORY.delete(oldest[0]);
  }
  const cache = await openCache();
  if (!cache) return;
  try {
    await cache.put(
      keyFor(name, vary),
      new Response(entry.body, {
        status: entry.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          etag: entry.etag,
          "x-stored-at": String(entry.storedAt),
        },
      }),
    );
  } catch {
    // a full or unavailable cache is never worth failing a request over
  }
}

/** A short, stable hash of the payload — enough to tell two payloads apart. */
function etagFor(body: string): string {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `W/"${(hash >>> 0).toString(36)}-${body.length.toString(36)}"`;
}

async function build(name: string, vary: string, seconds: number, build_: () => Promise<unknown>): Promise<Entry> {
  const payload = await build_();
  const body = JSON.stringify(payload);
  const entry: Entry = { body, etag: etagFor(body), storedAt: Date.now(), status: 200 };
  await write(name, vary, entry);
  log.info("cache.built", { name, vary, bytes: body.length, seconds });
  return entry;
}

function fresh(entry: Entry, seconds: number): boolean {
  return Date.now() - entry.storedAt < seconds * 1000;
}

function respond(entry: Entry, req: Request, seconds: number, state: "hit" | "stale" | "miss"): Response {
  const headers: Record<string, string> = {
    ...corsHeaders(req),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    etag: entry.etag,
    "x-nasheed-cache": state,
    // the browser may hold it briefly; the CDN holds it for the full window, and a
    // stale payload may be served while the next one is built
    "cache-control": `public, max-age=${Math.min(seconds, 30)}, s-maxage=${seconds}, stale-while-revalidate=${seconds}`,
  };
  if (req.headers.get("if-none-match") === entry.etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(entry.body, { status: entry.status, headers });
}

/**
 * Serve a JSON payload from cache, or build it once and share the result.
 *
 * `staleSeconds` is how long past its TTL an entry may still be handed out while it is
 * refreshed — a minute of staleness in a chart is invisible; a chart that waits on the
 * database is not.
 */
export async function cachedJson(
  req: Request,
  name: string,
  vary: string,
  seconds: number,
  build_: () => Promise<unknown>,
  staleSeconds = seconds * 2,
): Promise<Response> {
  const entry = await read(name, vary);

  if (entry) {
    if (fresh(entry, seconds)) return respond(entry, req, seconds, "hit");

    if (Date.now() - entry.storedAt < (seconds + staleSeconds) * 1000) {
      // hand out what we have, refresh behind the visitor, and never more than once
      if (!IN_FLIGHT.has(vary)) {
        const refresh = build(name, vary, seconds, build_)
          .catch((error) => {
            log.warn("cache.refresh_failed", { name, error: error instanceof Error ? error.message : String(error) });
            return entry;
          })
          .finally(() => IN_FLIGHT.delete(vary));
        IN_FLIGHT.set(vary, refresh);
        // the runtime may cancel background work when the response is returned, which
        // is why the refresh is also awaited by the next caller rather than only fired
        void refresh;
      }
      return respond(entry, req, seconds, "stale");
    }
  }

  const pending = IN_FLIGHT.get(vary) ?? build(name, vary, seconds, build_);
  if (!IN_FLIGHT.has(vary)) IN_FLIGHT.set(vary, pending);
  try {
    const built = await pending;
    return respond(built, req, seconds, "miss");
  } finally {
    if (IN_FLIGHT.get(vary) === pending) IN_FLIGHT.delete(vary);
  }
}

/** Drop a cached payload — what publishing does so the new nasheed shows up at once. */
export async function invalidate(name: string, vary = ""): Promise<void> {
  MEMORY.delete(`${name}?${vary}`);
  const cache = await openCache();
  if (!cache) return;
  await cache.delete(keyFor(name, vary)).catch(() => {});
}
