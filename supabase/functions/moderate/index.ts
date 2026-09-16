/**
 * /moderate — the staff room.
 *
 * Every action here is staff-only, checked against `profiles.role` on the server before
 * a single row is touched, and every action is written to the log with the request id
 * so a removal can be accounted for afterwards.
 *
 * The writes go through Postgres functions (`resolve_report`) or through the service
 * client with an explicit, narrow statement. Nothing takes a table name, a column list
 * or an `owner_id` from the request body: an endpoint that lets a client describe the
 * write is an endpoint that lets a client describe a write to somebody else's row.
 *
 * GET lists the queue; POST acts on it.
 */

import { serviceClient, withTimeout } from "../_shared/db.ts";
import { invalidate } from "../_shared/cache.ts";
import { HttpError, json, readBody, serve } from "../_shared/json.ts";
import { log } from "../_shared/log.ts";
import { requireStaff } from "../_shared/auth.ts";
import type { Report } from "../../../shared/types.ts";

const ACTIONS = [
  "resolve_report",
  "hide_comment",
  "restore_comment",
  "delete_comment",
  "remove_song",
  "restore_song",
  "set_role",
] as const;

type Action = (typeof ACTIONS)[number];

function idOf(value: unknown, field: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 64) throw new HttpError(`A ${field} is required.`, 400, field);
  return id;
}

async function queue(): Promise<Report[]> {
  const db = serviceClient();
  const { data, error } = await withTimeout(
    db
      .from("reports")
      .select("id, comment_id, reporter_id, reason, resolved, created_at, comment_text, author_handle, song_id, song_title")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(100),
    6000,
    "reports.select",
  );
  if (error) throw new HttpError("The moderation queue would not load.", 502);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    commentId: String(row.comment_id),
    reporterId: String(row.reporter_id),
    reason: String(row.reason ?? ""),
    createdAt: Date.parse(row.created_at as string) || Date.now(),
    resolved: Boolean(row.resolved),
    commentText: String(row.comment_text ?? ""),
    authorHandle: String(row.author_handle ?? ""),
    songId: String(row.song_id ?? ""),
    songTitle: String(row.song_title ?? ""),
  }));
}

/** Patch one row, and prove that one row was patched. */
async function patch(table: "comments" | "songs" | "profiles", id: string, values: Record<string, unknown>): Promise<void> {
  const db = serviceClient();
  const { data, error } = await withTimeout(
    db.from(table).update(values).eq("id", id).select("id"),
    6000,
    `${table}.update`,
  );
  if (error) throw new HttpError(`That change was refused: ${error.message}`, 400);
  if (!data || data.length === 0) throw new HttpError("Nothing matched that.", 404);
}

async function deleteRow(table: "comments", id: string): Promise<void> {
  const db = serviceClient();
  const { error } = await withTimeout(db.from(table).delete().eq("id", id), 6000, `${table}.delete`);
  if (error) throw new HttpError(`That delete was refused: ${error.message}`, 400);
}

async function act(caller: Awaited<ReturnType<typeof requireStaff>>, body: Record<string, unknown>): Promise<unknown> {
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) throw new HttpError("That is not a moderation action.", 400, "action");

  switch (action) {
    case "resolve_report": {
      const reportId = idOf(body.reportId, "reportId");
      const hide = body.hide === true;
      const { error } = await withTimeout(
        caller.client.rpc("resolve_report", { p_report_id: reportId, p_hide: hide }),
        8000,
        "resolve_report",
      );
      if (error) throw new HttpError(error.message, 400);
      return { ok: true, action, reportId, hidden: hide };
    }

    case "hide_comment":
    case "restore_comment": {
      const commentId = idOf(body.commentId, "commentId");
      await patch("comments", commentId, { removed: action === "hide_comment" });
      return { ok: true, action, commentId };
    }

    case "delete_comment": {
      const commentId = idOf(body.commentId, "commentId");
      await deleteRow("comments", commentId);
      return { ok: true, action, commentId };
    }

    case "remove_song":
    case "restore_song": {
      const songId = idOf(body.songId, "songId");
      await patch("songs", songId, { status: action === "remove_song" ? "removed" : "live" });
      await invalidate("catalog");
      return { ok: true, action, songId };
    }

    case "set_role": {
      const profileId = idOf(body.profileId, "profileId");
      const role = body.role === "staff" ? "staff" : body.role === "listener" ? "listener" : null;
      if (!role) throw new HttpError("Role must be staff or listener.", 400, "role");
      if (profileId === caller.profile!.id && role === "listener") {
        throw new HttpError("You cannot take your own staff access away.", 400, "role");
      }
      await patch("profiles", profileId, { role });
      return { ok: true, action, profileId, role };
    }
  }
}

Deno.serve(
  serve(["GET", "POST"], async ({ req }) => {
    if (req.method === "GET") {
      await requireStaff(req);
      return json({ reports: await queue() });
    }

    const caller = await requireStaff(req);
    const body = await readBody<Record<string, unknown>>(req);
    const result = await act(caller, body);
    log.info("moderate.action", { requestId: caller.id, action: body.action, result });
    return json(result);
  }, { timeoutMs: 20_000, write: true }),
);
