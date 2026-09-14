/**
 * /moderate — the staff room.
 *
 *   POST { action, ... }
 *
 *     resolveReport  { reportId, hide }   close a report, optionally hiding the note
 *     hideComment    { commentId }        take a note off the page, keep the row
 *     restoreComment { commentId }        put it back
 *     deleteComment  { commentId }        remove the row entirely
 *     removeSong     { songId, files }    take a nasheed down
 *     restoreSong    { songId }           put it back
 *     setRole        { profileId, role }  listener ↔ staff
 *     verify         { profileId, verified }
 *     queue                                the open reports, again, on demand
 *
 * Every action needs a staff profile. `requireStaff` checks the caller's JWT against
 * `profiles.role`, and the database checks it a second time inside `resolve_report()`
 * and in the column guards, so a function bug cannot hand out moderation by accident.
 */

import { requireStaff, type Caller } from "../_shared/auth.ts";
import { HttpError, json, readBody, serve } from "../_shared/json.ts";
import { ARTWORK_BUCKET, AUDIO_BUCKET, type Report, type UserRole } from "../../../shared/types.ts";

type Action =
  | "resolveReport"
  | "hideComment"
  | "restoreComment"
  | "deleteComment"
  | "removeSong"
  | "restoreSong"
  | "setRole"
  | "verify"
  | "queue";

const ROLES: UserRole[] = ["listener", "staff"];

function need<T>(value: unknown, field: string): T {
  if (typeof value !== "string" || !value) throw new HttpError(`${field} is required.`, 400, field);
  return value as T;
}

async function setComment(caller: Caller, commentId: string, removed: boolean): Promise<{ id: string; removed: boolean }> {
  const { data, error } = await caller.client
    .from("comments")
    .update({ removed })
    .eq("id", commentId)
    .select("id, removed")
    .maybeSingle();
  if (error) throw new HttpError(`That note would not change: ${error.message}`, 400);
  if (!data) throw new HttpError("There is no note by that id.", 404, "commentId");
  return { id: String(data.id), removed: Boolean(data.removed) };
}

async function setSong(caller: Caller, songId: string, status: "live" | "removed", files: boolean) {
  const { data: existing } = await caller.client
    .from("songs")
    .select("id, audio_path, artwork_path")
    .eq("id", songId)
    .maybeSingle();
  if (!existing) throw new HttpError("There is no nasheed by that id.", 404, "songId");

  const { error } = await caller.client.from("songs").update({ status }).eq("id", songId);
  if (error) throw new HttpError(`That nasheed would not change: ${error.message}`, 400);

  let filesRemoved = 0;
  if (status === "removed" && files) {
    const targets: { bucket: string; path: string }[] = [];
    if (existing.audio_path) targets.push({ bucket: AUDIO_BUCKET, path: String(existing.audio_path) });
    if (existing.artwork_path) targets.push({ bucket: ARTWORK_BUCKET, path: String(existing.artwork_path) });

    for (const target of targets) {
      const { error: removeError } = await caller.client.storage.from(target.bucket).remove([target.path]);
      if (!removeError) filesRemoved += 1;
    }
  }
  return { id: songId, status, filesRemoved };
}

async function queue(caller: Caller): Promise<Report[]> {
  const { data, error } = await caller.client
    .from("reports")
    .select("id, comment_id, reporter_id, reason, resolved, created_at, comment_text, author_handle, song_id, song_title")
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new HttpError(`The queue would not load: ${error.message}`, 502);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    commentId: String(row.comment_id),
    reporterId: String(row.reporter_id),
    reason: String(row.reason ?? ""),
    createdAt: Date.parse(String(row.created_at)) || Date.now(),
    resolved: Boolean(row.resolved),
    commentText: String(row.comment_text ?? ""),
    authorHandle: String(row.author_handle ?? ""),
    songId: String(row.song_id ?? ""),
    songTitle: String(row.song_title ?? ""),
  }));
}

Deno.serve(
  serve(["POST", "GET"], async (req, _url) => {
    const caller = await requireStaff(req);

    if (req.method === "GET") return json({ ok: true, reports: await queue(caller) });

    const body = await readBody<Record<string, unknown>>(req);
    const action = need<Action>(body.action, "action");

    switch (action) {
      case "queue":
        return json({ ok: true, reports: await queue(caller) });

      case "resolveReport": {
        const reportId = need<string>(body.reportId, "reportId");
        const hide = body.hide === true;
        const { data, error } = await caller.client.rpc("resolve_report", {
          p_report_id: reportId,
          p_hide: hide,
        });
        if (error) throw new HttpError(`That report would not close: ${error.message}`, 400);
        return json({ ok: true, reportId, ...(data as object) });
      }

      case "hideComment":
        return json({ ok: true, ...(await setComment(caller, need<string>(body.commentId, "commentId"), true)) });

      case "restoreComment":
        return json({ ok: true, ...(await setComment(caller, need<string>(body.commentId, "commentId"), false)) });

      case "deleteComment": {
        const commentId = need<string>(body.commentId, "commentId");
        const { error } = await caller.client.from("comments").delete().eq("id", commentId);
        if (error) throw new HttpError(`That note would not delete: ${error.message}`, 400);
        return json({ ok: true, commentId, deleted: true });
      }

      case "removeSong":
        return json({
          ok: true,
          ...(await setSong(caller, need<string>(body.songId, "songId"), "removed", body.files === true)),
        });

      case "restoreSong":
        return json({ ok: true, ...(await setSong(caller, need<string>(body.songId, "songId"), "live", false)) });

      case "setRole": {
        const profileId = need<string>(body.profileId, "profileId");
        const role = body.role;
        if (typeof role !== "string" || !ROLES.includes(role as UserRole)) {
          throw new HttpError(`A role is one of: ${ROLES.join(", ")}.`, 400, "role");
        }
        if (profileId === caller.id && role !== "staff") {
          throw new HttpError("You cannot take your own staff away here; ask another member.", 400, "role");
        }
        const { error } = await caller.client.from("profiles").update({ role }).eq("id", profileId);
        if (error) throw new HttpError(`That role would not save: ${error.message}`, 400);
        return json({ ok: true, profileId, role });
      }

      case "verify": {
        const profileId = need<string>(body.profileId, "profileId");
        const verified = body.verified !== false;
        const { error } = await caller.client.from("profiles").update({ verified }).eq("id", profileId);
        if (error) throw new HttpError(`That would not save: ${error.message}`, 400);
        return json({ ok: true, profileId, verified });
      }

      default:
        throw new HttpError("That action does not exist here.", 404, "action");
    }
  }),
);
