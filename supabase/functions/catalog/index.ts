/**
 * GET /catalog — the whole catalogue, one call, cached.
 *
 * Publishers, nasheeds, shelves and the tag cloud, assembled by `catalog_payload()` in
 * Postgres. Every field is real: an empty catalogue answers with empty arrays, and
 * nothing is generated to fill a page.
 *
 * Why a function rather than a direct `supabase.rpc("catalog_payload")` from the
 * browser? Because the cache sits in front of it: a thousand visitors in a minute cost
 * one query, not a thousand. The client still falls back to the RPC when this function
 * is not deployed, so nothing here is load-bearing.
 */

import { anonClient, hasServiceKey, serviceClient, withTimeout } from "../_shared/db.ts";
import { cachedJson, invalidate } from "../_shared/cache.ts";
import { HttpError, json, serve } from "../_shared/json.ts";
import { log } from "../_shared/log.ts";
import type { CatalogResponse } from "../../../shared/types.ts";

const CACHE_SECONDS = 60;

async function build(): Promise<CatalogResponse> {
  const client = hasServiceKey() ? serviceClient() : anonClient();
  const { data, error } = await withTimeout(client.rpc("catalog_payload"), 8000, "catalog_payload");
  if (error) {
    // PGRST202 / 42P01 mean the schema is not there yet, which is a setup problem worth
    // naming rather than a 500 that says nothing.
    if (/does not exist|Could not find the function/i.test(error.message)) {
      throw new HttpError("This project has no tables yet — the backend is not set up.", 503, "schema");
    }
    throw new HttpError(`The catalogue would not load: ${error.message}`, 502);
  }

  const payload = (data ?? {}) as Partial<CatalogResponse>;
  return {
    artists: payload.artists ?? [],
    songs: payload.songs ?? [],
    collections: payload.collections ?? [],
    tags: payload.tags ?? [],
    generatedAt: Number(payload.generatedAt ?? Date.now()),
  };
}

Deno.serve(
  serve(["GET", "POST"], async ({ req, url, id }) => {
    // ?fresh=1 is what the studio calls after publishing so the new nasheed is on the
    // home page immediately. It is rate limited like every other read.
    if (url.searchParams.get("fresh") === "1") {
      await invalidate("catalog");
      const payload = await build();
      log.info("catalog.fresh", { requestId: id, songs: payload.songs.length });
      return json(payload, {}, { "x-nasheed-cache": "bypass" });
    }

    return await cachedJson(req, "catalog", "all", CACHE_SECONDS, build);
  }, { timeoutMs: 12_000 }),
);
