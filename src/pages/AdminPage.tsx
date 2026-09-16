/**
 * The staff room.
 *
 * Everything here comes from one call — `admin_summary()` in Postgres, reached through
 * the `analytics` Edge Function, which checks the caller's JWT against `profiles.role`
 * before it answers. A listener who finds this page gets an empty state, and a listener
 * who calls the function directly gets a 403 from the database, not from this file.
 *
 * What it is for, in order of how often it gets used:
 *   1. the moderation queue — notes that were reported, with the two honest answers
 *   2. whether anything is growing — plays, listeners, signups, per day
 *   3. what is being played — the thirty-day chart, and who published it
 *   4. what a month of free tier is costing — storage, rows, the retention window
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../components/ui/Icons";
import { EmptyState, SectionHeader, useErrorToast, useToast } from "../components/ui/Primitives";
import { Avatar } from "../components/art/CoverArt";
import { api, errorMessage, functionsAvailable } from "../lib/api";
import { backendLabel, hasSupabase, projectRef } from "../lib/supabase";
import { formatCount } from "../data/catalog";
import { formatTotal, plural, relativeTime } from "../lib/format";
import { useSession } from "../store/session";
import { refreshCatalog } from "../lib/boot";
import type { AdminSummary, Report } from "../../shared/types";

const DAY_OPTIONS = [7, 14, 30, 90] as const;

function bytes(n: number): string {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/* ------------------------------------------------------------------- chart */

function Curve({ points }: { points: AdminSummary["daily"] }) {
  const width = 640;
  const height = 170;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };

  const max = Math.max(1, ...points.map((p) => p.plays));
  const stepX = points.length > 1 ? (width - pad.left - pad.right) / (points.length - 1) : 0;
  const x = (i: number) => pad.left + i * stepX;
  const y = (v: number) => pad.top + (height - pad.top - pad.bottom) * (1 - v / max);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.plays).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${height - pad.bottom} L${x(0).toFixed(1)},${height - pad.bottom} Z`;
  const listenerLine = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.listeners).toFixed(1)}`)
    .join(" ");

  // labels: first, middle, last — anything more is noise at this size
  const marks = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, all) => all.indexOf(v) === i);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full" role="img" aria-label="Plays per day">
      <defs>
        <linearGradient id="admin-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--jade)" stopOpacity="0.42" />
          <stop offset="100%" stopColor="var(--jade)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={pad.left}
          x2={width - pad.right}
          y1={y(max * f)}
          y2={y(max * f)}
          stroke="var(--line)"
          strokeWidth="1"
          strokeDasharray="2 5"
        />
      ))}

      <path d={area} fill="url(#admin-fill)" />
      <path d={line} fill="none" stroke="var(--jade)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <path d={listenerLine} fill="none" stroke="var(--gold)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.85" />

      {points.map((p, i) => (
        <circle key={p.day} cx={x(i)} cy={y(p.plays)} r="2.4" fill="var(--jade)" opacity={p.plays ? 1 : 0.25} />
      ))}

      {marks.map((i) => (
        <text
          key={i}
          x={x(i)}
          y={height - 6}
          textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
          className="fill-[var(--muted)] text-[10px]"
        >
          {points[i]?.day.slice(5)}
        </text>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------- tiles */

function Tile({
  icon,
  label,
  value,
  hint,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="panel rounded-2xl p-3.5">
      <div className="flex items-center gap-2 text-muted">
        <Icon name={icon} size={13} />
        <span className="label !mb-0">{label}</span>
      </div>
      <div className="mt-1.5 text-[1.35rem] leading-none text-text">{value}</div>
      {hint ? <div className="mt-1.5 text-[11.5px] text-muted">{hint}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export default function AdminPage() {
  const user = useSession((s) => s.user);
  const ready = useSession((s) => s.ready);
  const toast = useToast();

  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(14);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useErrorToast(error);
  const [busyReport, setBusyReport] = useState<string | null>(null);

  const staff = user?.role === "staff";

  const load = useCallback(async () => {
    if (!staff) return;
    setLoading(true);
    setError(null);
    try {
      setSummary(await api.adminOverview(days));
    } catch (err) {
      setError(errorMessage(err, "The dashboard would not load."));
    } finally {
      setLoading(false);
    }
  }, [days, staff]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (report: Report, action: "resolve" | "hide" | "delete") => {
    setBusyReport(report.id);
    try {
      if (action === "delete") {
        // the note goes first, then the report closes over the gap it left
        await api.moderate("deleteComment", { commentId: report.commentId });
        await api.resolveReport(report.id, true);
      } else {
        await api.resolveReport(report.id, action === "hide");
      }
      toast.push({
        title: action === "resolve" ? "Report closed" : action === "hide" ? "Note hidden" : "Note deleted",
        msg: report.songTitle || report.authorHandle,
        kind: "ok",
      });
      await load();
    } catch (err) {
      toast.push({ title: "That did not work", msg: errorMessage(err), kind: "warn" });
    } finally {
      setBusyReport(null);
    }
  };

  const toggleSong = async (songId: string, title: string, removed: boolean) => {
    try {
      await api.moderate(removed ? "restoreSong" : "removeSong", { songId });
      toast.push({ title: removed ? "Back up" : "Taken down", msg: title, kind: "info" });
      await Promise.all([load(), refreshCatalog()]);
    } catch (err) {
      toast.push({ title: "That did not work", msg: errorMessage(err), kind: "warn" });
    }
  };

  const topPlays = useMemo(() => Math.max(1, ...(summary?.topSongs ?? []).map((s) => s.plays)), [summary]);

  if (!hasSupabase || (ready && !staff)) {
    return (
      <div className="space-y-6">
        <SectionHeader label="staff" title="The staff room" />
        <EmptyState
          icon="shield"
          title={hasSupabase ? "Staff only" : "No project, no staff room"}
          msg={
            hasSupabase
              ? "Moderation and the numbers behind it belong to staff. The first account created on a fresh Supabase project is made staff automatically — sign in with that one."
              : "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, run the migrations, and the first account you create will be staff."
          }
          action={
            <Link to="/" className="btn btn-primary mt-1 !px-4 !py-2.5">
              <Icon name="home" size={14} /> Back home
            </Link>
          }
        />
      </div>
    );
  }

  const totals = summary?.totals;

  return (
    <div className="space-y-7 pb-8">
      {/* ---------------------------------------------------------- header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label mb-1.5">staff room</div>
          <h1 className="text-2xl text-text sm:text-3xl">What this place is doing</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="server" size={12} /> {backendLabel()}
            </span>
            <span aria-hidden>·</span>
            <span>
              {functionsAvailable() === false
                ? "no Edge Functions deployed — this room is talking to Postgres directly"
                : "numbers straight from Postgres"}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface2/50 p-1">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={clsx(
                  "rounded-full px-2.5 py-1 text-[12px] transition-colors",
                  days === d ? "bg-jade/18 text-text" : "text-muted hover:text-text2",
                )}
                aria-pressed={days === d}
              >
                {d}d
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost !px-3 !py-2" onClick={() => void load()} disabled={loading}>
            <Icon name={loading ? "waveform" : "check"} size={14} className={loading ? "animate-pulse" : undefined} />
            {loading ? "Reading" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------- totals */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Tile icon="users" label="listeners" value={formatCount(totals?.users ?? 0)} hint="accounts, not devices" />
        <Tile icon="mic" label="publishers" value={formatCount(totals?.artists ?? 0)} hint="profiles with nasheeds" />
        <Tile icon="waveform" label="nasheeds" value={formatCount(totals?.songs ?? 0)} hint={`${totals?.removed ?? 0} taken down`} />
        <Tile icon="trending" label="plays" value={formatCount(totals?.plays ?? 0)} hint="counted, not estimated" />
        <Tile icon="clock" label="listened" value={formatTotal(totals?.listenSeconds ?? 0)} hint="total ear time" />
        <Tile icon="lyrics" label="notes" value={formatCount(totals?.notes ?? 0)} hint="under the nasheeds" />
        <Tile icon="star" label="loves" value={formatCount(totals?.likes ?? 0)} />
        <Tile icon="beads" label="amens" value={formatCount(totals?.amens ?? 0)} />
        <Tile
          icon="flag"
          label="open reports"
          value={formatCount(totals?.reportsOpen ?? 0)}
          hint={totals?.reportsOpen ? "the queue below" : "nothing waiting"}
        />
        <Tile
          icon="server"
          label="storage"
          value={bytes(totals?.storageBytes ?? 0)}
          hint={`of 1 GB free · ${projectRef || "no project"}`}
        />
      </section>

      {/* ------------------------------------------------------------ curve */}
      <section>
        <SectionHeader
          label={`last ${days} days`}
          title="Plays, listeners and signups"
          subtitle="Rolled up per day in Postgres as the beacons arrive — the raw events are pruned after 90 days, this is not."
        />
        <div className="panel rounded-2xl p-3 sm:p-4">
          {summary && summary.daily.length ? (
            <>
              <Curve points={summary.daily} />
              <div className="mt-2 flex flex-wrap items-center gap-4 text-[11.5px] text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-jade" /> plays
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded-full bg-gold" /> listeners
                </span>
                <span className="ml-auto">
                  {formatCount(summary.daily.reduce((n, d) => n + d.signups, 0))} signed up in this window
                </span>
              </div>
            </>
          ) : (
            <p className="px-1 py-8 text-center text-sm text-muted">
              {loading ? "Reading the rollups…" : "No plays in this window yet. Play something and come back."}
            </p>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------------- queue */}
      <section>
        <SectionHeader
          label="moderation"
          title="Reported notes"
          subtitle="Three reports hide a note automatically. Everything here is still waiting on a person."
        />
        {summary && summary.reports.length ? (
          <ul className="space-y-2.5">
            {summary.reports.map((report) => (
              <li key={report.id} className="panel rounded-2xl p-3.5">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                  <span className="inline-flex items-center gap-1.5 text-madder">
                    <Icon name="flag" size={12} /> reported
                  </span>
                  <span aria-hidden>·</span>
                  <span>@{report.authorHandle || "somebody"}</span>
                  <span aria-hidden>·</span>
                  <span>{relativeTime(report.createdAt)}</span>
                  {report.songId ? (
                    <>
                      <span aria-hidden>·</span>
                      <Link to={`/t/${report.songId}`} className="hover:text-jadesoft">
                        {report.songTitle || report.songId}
                      </Link>
                    </>
                  ) : null}
                </div>

                <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-text2">
                  {report.commentText || <span className="italic text-muted">the note is gone</span>}
                </p>
                <p className="mt-1.5 text-[11.5px] text-muted">reason: {report.reason}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost !px-3 !py-1.5 !text-[12.5px]"
                    disabled={busyReport === report.id}
                    onClick={() => void act(report, "resolve")}
                  >
                    <Icon name="check" size={13} /> Leave it, close the report
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost !px-3 !py-1.5 !text-[12.5px] hover:text-gold"
                    disabled={busyReport === report.id}
                    onClick={() => void act(report, "hide")}
                  >
                    <Icon name="eyeOff" size={13} /> Hide the note
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost !px-3 !py-1.5 !text-[12.5px] hover:text-madder"
                    disabled={busyReport === report.id}
                    onClick={() => void act(report, "delete")}
                  >
                    <Icon name="trash" size={13} /> Delete it
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="panel rounded-2xl px-4 py-8 text-center text-sm text-muted">
            {loading ? "Reading the queue…" : "Nothing reported. The room is behaving."}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ charts */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <SectionHeader label="30 days" title="Most played" />
          <div className="panel space-y-2.5 rounded-2xl p-3.5">
            {summary?.topSongs.length ? (
              summary.topSongs.map((song, i) => (
                <Link key={song.songId} to={`/t/${song.songId}`} className="block group">
                  <div className="flex items-baseline gap-2.5 text-[13px]">
                    <span className="w-4 shrink-0 text-right text-[11.5px] text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-text2 group-hover:text-jadesoft">{song.title}</span>
                    <span className="shrink-0 text-[11.5px] text-muted">
                      {formatCount(song.plays)} · {formatCount(song.listeners)} heard it
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface2">
                    <div
                      className="h-full rounded-full bg-jade/70 transition-all"
                      style={{ width: `${Math.max(2, (song.plays / topPlays) * 100)}%` }}
                    />
                  </div>
                </Link>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-muted">No plays in the last thirty days.</p>
            )}
          </div>
        </section>

        <section>
          <SectionHeader label="publishers" title="Who carries the catalogue" />
          <div className="panel space-y-2.5 rounded-2xl p-3.5">
            {summary?.topOwners.length ? (
              summary.topOwners.map((owner) => (
                <Link key={owner.ownerId} to={`/a/${owner.handle}`} className="flex items-center gap-3 group">
                  <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-line">
                    <Avatar name={owner.name} accent="gold" size={36} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-text2 group-hover:text-jadesoft">{owner.name}</span>
                    <span className="block truncate text-[11.5px] text-muted">
                      @{owner.handle} · {plural(owner.songs, "nasheed")}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted">{formatCount(owner.plays)} plays</span>
                </Link>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-muted">Nobody has published yet.</p>
            )}
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------- recent rows */}
      <section>
        <SectionHeader
          label="catalogue"
          title="Recently published"
          subtitle="Taking a nasheed down sets its status; the row and its notes stay, which is what an audit trail is."
        />
        <div className="panel overflow-hidden rounded-2xl">
          {summary?.recentSongs.length ? (
            <ul className="divide-y divide-line">
              {summary.recentSongs.map((song) => (
                <li key={song.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                  <Link to={`/t/${song.id}`} className="min-w-0 flex-1 truncate text-[13px] text-text2 hover:text-jadesoft">
                    {song.title}
                  </Link>
                  <span className="text-[11.5px] text-muted">@{song.owner ?? "—"}</span>
                  <span className="text-[11.5px] text-muted">{formatCount(song.plays)} plays</span>
                  <span className="text-[11.5px] text-muted">{relativeTime(song.publishedAt)}</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10.5px] text-muted">
                    <Icon name="upload" size={10} /> recording
                  </span>
                  <button
                    type="button"
                    className={clsx(
                      "btn btn-ghost !px-2.5 !py-1 !text-[11.5px]",
                      song.status === "removed" ? "text-jade" : "hover:text-madder",
                    )}
                    onClick={() => void toggleSong(song.id, song.title, song.status === "removed")}
                  >
                    <Icon name={song.status === "removed" ? "check" : "trash"} size={12} />
                    {song.status === "removed" ? "restore" : "take down"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted">
              {loading ? "Reading the catalogue…" : "Nothing published yet."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
