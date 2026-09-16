import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { Avatar } from "../art/CoverArt";
import { useToast } from "../ui/Primitives";
import { useAccount } from "../../lib/hooks";
import { useUi } from "../../store/ui";
import { useCommunity, timeAgoLabel, COMMENT_MAX, type UserComment } from "../../store/community";
import { useSession } from "../../store/session";
import type { Track } from "../../data/types";
import { usePlayer } from "../../store/player";
import type { LyricLine } from "../../../shared/types";

const REPORT_REASONS = [
  "Disrespectful to the dīn",
  "Harsh or personal",
  "Spam or advertising",
  "Wrong place for this",
];

/**
 * The thread under a nasheed.
 *
 * Every note here is a row on the server, written by an account, with an amīn count that
 * counts real amīns. There is no offline copy: when the server cannot be reached the
 * thread says so rather than showing notes that nobody wrote.
 */
export function CommentThread({
  track,
  song,
  compact = false,
  startAtLine,
}: {
  track: Track;
  song?: { lines: LyricLine[] };
  compact?: boolean;
  /** pre-fill "on line N" — the immersive player passes the line you are on */
  startAtLine?: number;
}) {
  const account = useAccount();
  const online = useSession((s) => s.online);
  const requestAuth = useUi((s) => s.requestAuth);
  const toast = useToast();
  const player = usePlayer();

  /* select the thread object, not a derived array: a selector that builds a new array
     every call gives useSyncExternalStore a fresh snapshot each render and loops forever */
  const thread = useCommunity((s) => s.threads[track.id]);
  const amened = useCommunity((s) => s.amened);
  const loadThread = useCommunity((s) => s.loadThread);
  const addComment = useCommunity((s) => s.addComment);
  const editComment = useCommunity((s) => s.editComment);
  const deleteComment = useCommunity((s) => s.deleteComment);
  const toggleAmen = useCommunity((s) => s.toggleAmen);
  const reportComment = useCommunity((s) => s.reportComment);

  const [text, setText] = useState("");
  const [atLine, setAtLine] = useState<number | undefined>(startAtLine);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [reporting, setReporting] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    void loadThread(track.id);
  }, [track.id, loadThread]);

  const rows = useMemo<UserComment[]>(() => {
    const items = thread?.items ?? [];
    return compact ? items.slice(0, 3) : items;
  }, [thread, compact]);

  const jumpToLine = (n: number) => {
    const line = song?.lines[Math.min((song?.lines.length ?? 1) - 1, n - 1)];
    if (!line) return;
    const isCurrent = player.trackId === track.id;
    if (!isCurrent) player.playTrack(track.id, { kind: "home", label: track.title });
    const at = line.t;
    if (typeof at !== "number") return;
    window.setTimeout(() => player.seek(at + 0.05), isCurrent ? 0 : 260);
  };

  const submit = async () => {
    const clean = text.trim();
    if (!clean || posting) return;
    if (!account) {
      requestAuth({ label: "Sign in to leave a note on this nasheed" }, "signup");
      return;
    }
    setPosting(true);
    const made = await addComment({ trackId: track.id, text: clean, atLine });
    setPosting(false);
    if (!made) {
      toast.push({ title: "That note did not post", msg: `${COMMENT_MAX} characters at most, and the server has to be reachable.`, kind: "warn" });
      return;
    }
    setText("");
    setAtLine(undefined);
    if (window.navigator.vibrate) window.navigator.vibrate(10);
    toast.push({ title: "Note left", msg: atLine ? `Pinned to line ${atLine}.` : undefined, kind: "ok" });
  };

  const onAmen = async (row: UserComment) => {
    if (!account) {
      requestAuth({ label: "Sign in to say amīn" }, "signin");
      return;
    }
    const now = await toggleAmen(row.id);
    if (window.navigator.vibrate) window.navigator.vibrate(6);
    if (now) toast.push({ title: "Amīn", msg: `You said amīn to @${row.authorHandle}.`, kind: "ok" });
  };

  const onReport = async (row: UserComment, reason: string) => {
    if (!account) {
      requestAuth({ label: "Sign in to report a note" }, "signin");
      return;
    }
    setReporting(null);
    const ok = await reportComment(row.id, reason);
    toast.push(
      ok
        ? { title: "Reported", msg: "Staff will look at it. Thank you for keeping this place decent.", kind: "ok" }
        : { title: "Could not send that", msg: "The server did not take the report.", kind: "warn" },
    );
  };

  const loading = thread?.loading && !thread.items.length;

  return (
    <div className="space-y-3">
      {/* composer */}
      {account ? (
        <div className="rounded-xl border border-line bg-surface/60 p-3">
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-line2">
              <Avatar name={account.name} accent="jade" size={36} picture={account.avatarPath} />
            </span>
            <div className="min-w-0 flex-1">
              <textarea
                className="field scroll-slim !rounded-xl resize-y"
                rows={compact ? 2 : 3}
                value={text}
                maxLength={COMMENT_MAX + 40}
                placeholder="What did this do to you?"
                onChange={(e) => setText(e.target.value.slice(0, COMMENT_MAX))}
                aria-label="Leave a note"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {song ? (
                  <button
                    type="button"
                    className={clsx("chip", atLine ? "" : "hover:border-line2 hover:text-text")}
                    data-active={!!atLine}
                    onClick={() => setAtLine((v) => (v ? undefined : (currentLine(song) ?? 1)))}
                    aria-pressed={!!atLine}
                    title="Pin this note to the line playing now"
                  >
                    <Icon name="lyrics" size={11} />
                    {atLine ? `on line ${atLine}` : "pin to a line"}
                  </button>
                ) : null}
                <span className={clsx("ml-auto text-[11px] tabular-nums", text.length > COMMENT_MAX - 60 ? "text-goldsoft" : "text-muted")}>
                  {text.length}/{COMMENT_MAX}
                </span>
                <button className="btn btn-primary !px-4 !py-2" onClick={() => void submit()} disabled={!text.trim() || posting}>
                  <Icon name="check" size={14} strokeWidth={2.4} /> {posting ? "Posting" : "Post"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line2 bg-surface2/30 px-3.5 py-3">
          <Icon name="lyrics" size={16} className="text-jade" />
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted">Listening needs no account. Leaving a note does.</p>
          <button className="btn btn-ghost !px-3.5 !py-2" onClick={() => requestAuth({ label: "Sign in to leave a note on this nasheed" }, "signup")}>
            <Icon name="user" size={14} /> Sign in
          </button>
        </div>
      )}

      {thread?.error ? (
        <p className="rounded-lg border border-madder/25 bg-madder/[0.06] px-3 py-2 text-[12px] text-madder">{thread.error}</p>
      ) : null}

      {!online ? (
        <p className="flex items-center gap-2 rounded-lg border border-line bg-surface2/40 px-3 py-2 text-[11.5px] text-muted">
          <Icon name="cloudOff" size={12} className="text-gold" />
          The backend is unreachable — the thread cannot be read or written until it answers.
        </p>
      ) : null}

      {/* the thread */}
      {loading ? (
        <ul className="space-y-2.5" aria-busy="true" aria-live="polite">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-line bg-surface/40 p-3.5">
              <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-surface3" />
              <span className="flex-1 space-y-2">
                <span className="block h-2.5 w-28 animate-pulse rounded bg-surface3" />
                <span className="block h-2.5 w-full animate-pulse rounded bg-surface3/70" />
                <span className="block h-2.5 w-2/3 animate-pulse rounded bg-surface3/50" />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="space-y-2.5">
        {rows.map((c) => {
          if (c.removed) {
            return (
              <li key={c.id} className="rounded-xl border border-dashed border-line bg-surface/20 px-3.5 py-3 text-[12px] text-muted/70">
                A note here was removed by its author or by the moderators.
              </li>
            );
          }

          const isAmened = !!account && amened[c.id] === true;
          const mine = account?.id === c.authorId;
          return (
            <li
              key={c.id}
              className={clsx("flex gap-3 rounded-xl border p-3.5", mine ? "border-jade/28 bg-jade/[0.05]" : "border-line bg-surface/50")}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-line2">
                <Avatar name={c.authorName} accent={c.authorAccent} size={36} picture={c.authorAvatar} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
                  <span className="font-semibold text-text">{c.authorName}</span>
                  <span className="text-muted">@{c.authorHandle}</span>
                  <span
                    className={clsx(
                      "flex items-center gap-1 rounded-full px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wider",
                      mine ? "bg-jade/14 text-jade" : "bg-surface3 text-muted",
                    )}
                  >
                    <Icon name="check" size={9} strokeWidth={3} /> {mine ? "you" : "listener"}
                  </span>
                  <span className="text-muted">{timeAgoLabel(c.at)}</span>
                  {c.atLine && song ? (
                    <button
                      className="ml-auto flex items-center gap-1 rounded-full border border-line px-2 py-1 text-[10px] text-muted transition-colors hover:border-line2 hover:text-text2"
                      onClick={() => jumpToLine(c.atLine!)}
                    >
                      <Icon name="lyrics" size={10} /> line {c.atLine}
                    </button>
                  ) : null}
                </div>

                {editing === c.id ? (
                  <div className="mt-2">
                    <textarea
                      className="field scroll-slim !rounded-xl resize-y"
                      rows={2}
                      value={editText}
                      maxLength={COMMENT_MAX}
                      onChange={(e) => setEditText(e.target.value)}
                      aria-label="Edit your note"
                      autoFocus
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        className="btn btn-primary !px-3 !py-1.5"
                        onClick={() => {
                          void editComment(c.id, editText).then((ok) => {
                            if (ok) toast.push({ title: "Note updated", kind: "ok" });
                            else toast.push({ title: "That did not save", kind: "warn" });
                          });
                          setEditing(null);
                        }}
                      >
                        Save
                      </button>
                      <button className="btn btn-ghost !px-3 !py-1.5" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-text2">{c.text}</p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                  <button
                    className={clsx("flex items-center gap-1 transition-colors", isAmened ? "text-gold" : "text-muted hover:text-gold")}
                    onClick={() => void onAmen(c)}
                    aria-pressed={isAmened}
                    aria-label={`Say amīn — ${c.amens} amīns`}
                  >
                    <Icon name={isAmened ? "starFill" : "star"} size={12} /> {c.amens}
                  </button>
                  {c.editedAt ? <span className="text-muted/70">edited {timeAgoLabel(c.editedAt)}</span> : null}
                  {mine && editing !== c.id ? (
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        className="flex items-center gap-1 text-muted transition-colors hover:text-text2"
                        onClick={() => {
                          setEditing(c.id);
                          setEditText(c.text);
                        }}
                      >
                        <Icon name="pencil" size={11} /> edit
                      </button>
                      <button
                        className="flex items-center gap-1 text-muted transition-colors hover:text-madder"
                        onClick={() => {
                          void deleteComment(c.id).then((ok) => {
                            toast.push(ok ? { title: "Note removed", kind: "info" } : { title: "Could not remove that", kind: "warn" });
                          });
                        }}
                      >
                        <Icon name="trash" size={11} /> delete
                      </button>
                    </span>
                  ) : !mine ? (
                    <span className="ml-auto">
                      {reporting === c.id ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {REPORT_REASONS.map((reason) => (
                            <button key={reason} className="chip !py-1 text-[10px]" onClick={() => void onReport(c, reason)}>
                              {reason}
                            </button>
                          ))}
                          <button className="chip !py-1 text-[10px]" onClick={() => setReporting(null)}>
                            cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          className="flex items-center gap-1 text-muted/70 transition-colors hover:text-madder"
                          onClick={() => {
                            if (!account) {
                              requestAuth({ label: "Sign in to report a note" }, "signin");
                              return;
                            }
                            setReporting(c.id);
                          }}
                        >
                          <Icon name="flag" size={11} /> report
                        </button>
                      )}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!loading && !rows.length ? (
        <p className="rounded-xl border border-dashed border-line px-3.5 py-6 text-center text-[12.5px] text-muted">
          No notes yet. Be the first to say what this did to you.
        </p>
      ) : null}
    </div>
  );
}

/** The line the voice is on right now, 1-based — what "pin to a line" pins to. */
function currentLine(song: { lines: LyricLine[] }): number {
  const t = usePlayer.getState().time;
  let idx = 0;
  for (let i = 0; i < song.lines.length; i++) {
    const at = song.lines[i]!.t;
    if (typeof at === "number" && at <= t) idx = i;
    else break;
  }
  return Math.min(song.lines.length, idx + 1);
}
