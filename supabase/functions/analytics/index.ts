/**
 * GET /analytics — the charts, and the staff dashboard behind them.
 *
 *   ?view=trending&window=7d&limit=10   public, cached 60s
 *   ?view=curve&days=14                 public, cached 60s
 *   ?view=song&id=sng_…                 public, cached 30s
 *   ?view=history&limit=30              yours (or this device's, by client id)
 *   ?view=admin&days=14                 staff only
 *
 * Everything public is cached at the edge, so a chart that a thousand people look at
 * costs the database one query a minute. The admin view is never cached: it is a
 * different number for every minute it is looked at, and only staff can ask.
 *
 * Both halves are Postgres functions; this file is the door, the cache and the
 * permission check, which is exactly what an Edge Function should be.
 */

import { cached } from "../_shared/cache.ts";
import { anonClient } from "../_shared/db.ts";
import { HttpError, fail, json, serve } from "../_shared/json.ts";
import { maybeCaller, requireStaff } from "../_shared/auth.ts";
import type {
  AdminSummary,
  DailyPointDb,
  HistoryRow,
  SongStats,
  TrendingDbRow,
  TrendingRow,
  TrendingWindow,
} from "../../../shared/types.ts";

const WINDOWS: TrendingWindow[] = ["24h", "7d", "30d", "all"];

function clamp(value: string | null, min: number, max: number, fallback: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

const trendingRow = (row: TrendingDbRow): TrendingRow => ({
  songId: row.song_id,
  title: row.title,
  accent: row.accent,
  maqam: row.maqam,
  ownerName: row.owner_name,
  plays: Number(row.plays ?? 0),
  listeners: Number(row.listeners ?? 0),
  seconds: Number(row.seconds ?? 0),
  likes: Number(row.likes ?? 0),
});

async function trending(window: TrendingWindow, limit: number): Promise<Response> {
  const db = anonClient();
  const { data, error } = await db.rpc("trending", { p_window: window, p_limit: limit });
  if (error) return fail(`The chart would not load: ${error.message}`, 502);
  const rows = ((data ?? []) as unknown as TrendingDbRow[]).map(trendingRow);
  return json({ window, rows, generatedAt: Date.now() }, { cacheSeconds: 60 });
}

async function curve(days: number): Promise<Response> {
  const db = anonClient();
  const { data, error } = await db.rpc("daily_curve", { p_days: days });
  if (error) return fail(`The curve would not load: ${error.message}`, 502);
  const points = ((data ?? []) as unknown as DailyPointDb[]).map((p) => ({
    day: String(p.day).slice(0, 10),
    plays: Number(p.plays ?? 0),
    listeners: Number(p.listeners ?? 0),
    signups: Number(p.signups ?? 0),
  }));
  return json({ days, points, generatedAt: Date.now() }, { cacheSeconds: 60 });
}

async function songStats(id: string): Promise<Response> {
  const db = anonClient();
  const { data, error } = await db.rpc("song_stats", { p_song_id: id });
  if (error) return fail(`Those numbers would not load: ${error.message}`, 502);
  const stats = data as unknown as SongStats;
  return json(
    {
      ...stats,
      daily: (stats?.daily ?? []).map((d) => ({ ...d, day: String(d.day).slice(0, 10) })),
    },
    { cacheSeconds: 30 },
  );
}

Deno.serve(
  serve(["GET"], async (req, url) => {
    const view = url.searchParams.get("view") ?? "trending";

    if (view === "trending") {
      const window = (url.searchParams.get("window") ?? "7d") as TrendingWindow;
      if (!WINDOWS.includes(window)) throw new HttpError("That window is not a chart.", 400, "window");
      const limit = clamp(url.searchParams.get("limit"), 1, 50, 10);
      return cached("trending", `w=${window}&l=${limit}`, 60, () => trending(window, limit));
    }

    if (view === "curve") {
      const days = clamp(url.searchParams.get("days"), 1, 90, 14);
      return cached("curve", `d=${days}`, 60, () => curve(days));
    }

    if (view === "song") {
      const id = url.searchParams.get("id");
      if (!id) throw new HttpError("Which nasheed?", 400, "id");
      return cached("song-stats", `id=${id}`, 30, () => songStats(id));
    }

    if (view === "history") {
      const limit = clamp(url.searchParams.get("limit"), 1, 100, 30);
      const caller = await maybeCaller(req);
      const clientId = url.searchParams.get("clientId");
      const db = caller?.client ?? anonClient();
      const { data, error } = await db.rpc("my_history", {
        p_limit: limit,
        p_client_id: caller ? null : clientId,
      });
      if (error) return fail(`Your history would not load: ${error.message}`, 502);
      return json({ rows: (data ?? []) as unknown as HistoryRow[] });
    }

    if (view === "admin") {
      const caller = await requireStaff(req);
      const days = clamp(url.searchParams.get("days"), 1, 90, 14);
      const { data, error } = await caller.client.rpc("admin_summary", { p_days: days });
      if (error) return fail(`The dashboard would not load: ${error.message}`, 502);
      const summary = data as unknown as AdminSummary;
      return json({
        ...summary,
        daily: (summary.daily ?? []).map((d) => ({ ...d, day: String(d.day).slice(0, 10) })),
      });
    }

    throw new HttpError("That view does not exist here.", 404, "view");
  }),
);
