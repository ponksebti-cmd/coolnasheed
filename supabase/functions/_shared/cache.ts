/**
 * The Cache API in front of the database.
 *
 * This is the reason a cold catalogue costs one query per minute instead of one per
 * visitor. On the free tier a function invocation is free up to 500,000 a month and
 * the database is the thing that actually throttles, so caching the two payloads
 * everybody asks for — the catalogue and the charts — is what keeps a busy day cheap.
 *
 * The runtime may not offer `caches` (local `deno serve` does not, by default), so
 * every branch here degrades to "just build it".
 */

const BUCKET = "coolnasheed";

function keyFor(name: string, vary = ""): Request {
  return new Request(`https://coolnasheed.cache/${name}${vary ? `?${vary}` : ""}`);
}

async function bucket(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(BUCKET);
  } catch {
    return null;
  }
}

export async function cacheGet(name: string, vary = ""): Promise<Response | null> {
  const cache = await bucket();
  if (!cache) return null;
  try {
    const hit = await cache.match(keyFor(name, vary));
    return hit ?? null;
  } catch {
    return null;
  }
}

export async function cachePut(name: string, vary: string, response: Response): Promise<void> {
  const cache = await bucket();
  if (!cache) return;
  try {
    await cache.put(keyFor(name, vary), response.clone());
  } catch {
    // a full or unavailable cache is not an error worth failing a request over
  }
}

/**
 * Serve from cache, or build, cache and serve. `seconds` is both the Cache API
 * lifetime and the `cache-control` the browser is given.
 */
export async function cached(
  name: string,
  vary: string,
  seconds: number,
  build: () => Promise<Response>,
): Promise<Response> {
  const hit = await cacheGet(name, vary);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set("x-nasheed-cache", "hit");
    return new Response(hit.body, { status: hit.status, headers });
  }

  const fresh = await build();
  if (fresh.ok) await cachePut(name, vary, fresh);

  const headers = new Headers(fresh.headers);
  headers.set("x-nasheed-cache", "miss");
  headers.set("cache-control", `public, max-age=${seconds}, s-maxage=${seconds}`);
  return new Response(fresh.body, { status: fresh.status, headers });
}
