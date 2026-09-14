/**
 * The thread under a nasheed, from the server.
 *
 * Notes are rows in the database now: they belong to the account that wrote them, they
 * are visible to everyone on every device, and the amīn count is a count of amīns that
 * actually happened. Moderation is real too — a note can be reported, and staff can hide
 * it, which leaves a gap in the thread rather than quietly rewriting history.
 *
 * When the API cannot be reached the thread falls back to generated notes (the same
 * stable per-track set the catalogue ships with), clearly marked as generated, so an
 * offline visit still looks like a room with people in it rather than an empty box.
 */

import { create } from "zustand";
import { api, ApiError, errorMessage } from "../lib/api";
import { isDemoError } from "../lib/errors";
import { notesFor } from "../lib/comments";
import { getTrack } from "../data/catalog";
import { currentUser } from "./session";
import type { Comment } from "../../shared/types";

export type UserComment = {
  id: string;
  trackId: string;
  authorId: string;
  /** snapshot, so a deleted account's notes do not become anonymous mid-thread */
  authorName: string;
  authorHandle: string;
  authorSeed: string;
  at: number;
  text: string;
  /** optional "on line N" — the thread can jump the voice there */
  atLine?: number;
  editedAt?: number;
  amens: number;
  reports: number;
  /** hidden by moderation; kept as a gap so the thread does not silently renumber */
  removed: boolean;
  /** generated locally because the server was unreachable */
  generated?: boolean;
};

export type CommentDraft = { trackId: string; text: string; atLine?: number };

export const COMMENT_MAX = 600;

type Thread = {
  items: UserComment[];
  total: number;
  loaded: boolean;
  loading: boolean;
  error: string | null;
};

const EMPTY_THREAD: Thread = { items: [], total: 0, loaded: false, loading: false, error: null };

function fromServer(comment: Comment): UserComment {
  return {
    id: comment.id,
    trackId: comment.songId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    authorHandle: comment.authorHandle,
    authorSeed: comment.authorSeed,
    at: comment.createdAt,
    text: comment.text,
    atLine: comment.atLine ?? undefined,
    editedAt: comment.editedAt ?? undefined,
    amens: comment.amens,
    reports: comment.reports,
    removed: comment.removed === true,
  };
}

/** The offline fallback: the same generated notes the catalogue has always shipped. */
function generatedFor(trackId: string): UserComment[] {
  const track = getTrack(trackId);
  if (!track) return [];
  const now = Date.now();
  return notesFor(track, 6).map((note, i) => ({
    id: `gen-${note.id}`,
    trackId,
    authorId: `gen-${note.handle}`,
    authorName: note.handle,
    authorHandle: note.handle,
    authorSeed: note.handle,
    at: now - note.daysAgo * 86_400_000 - i * 3_600_000,
    text: note.text,
    atLine: note.atLine,
    amens: note.likes,
    reports: 0,
    removed: false,
    generated: true,
  }));
}

type CommunityState = {
  threads: Record<string, Thread>;
  /** comment id → whether the signed-in account amened it */
  amened: Record<string, boolean>;
  /** everything this account has written, for the profile page */
  mine: UserComment[];
  mineLoaded: boolean;

  loadThread: (trackId: string, force?: boolean) => Promise<void>;
  loadMine: (force?: boolean) => Promise<void>;
  addComment: (draft: CommentDraft) => Promise<UserComment | null>;
  editComment: (id: string, text: string) => Promise<boolean>;
  deleteComment: (id: string) => Promise<boolean>;
  toggleAmen: (id: string) => Promise<boolean>;
  reportComment: (id: string, reason: string) => Promise<boolean>;
  amensFor: (id: string) => number;
  isAmened: (id: string) => boolean;
  commentsFor: (trackId: string) => UserComment[];
  countFor: (trackId: string) => number;
  byAuthor: (accountId: string) => UserComment[];
  ownsComment: (id: string) => boolean;
  /** drop every thread — used when the account changes */
  reset: () => void;
};

function patchThread(state: CommunityState, trackId: string, patch: Partial<Thread>): Record<string, Thread> {
  const current = state.threads[trackId] ?? EMPTY_THREAD;
  return { ...state.threads, [trackId]: { ...current, ...patch } };
}

function removeComment(state: CommunityState, trackId: string, id: string): Record<string, Thread> {
  const current = state.threads[trackId] ?? EMPTY_THREAD;
  return {
    ...state.threads,
    [trackId]: {
      ...current,
      items: current.items.filter((c) => c.id !== id),
      total: Math.max(0, current.total - 1),
    },
  };
}

function patchComment(state: CommunityState, trackId: string, id: string, patch: Partial<UserComment>): Record<string, Thread> {
  const current = state.threads[trackId] ?? EMPTY_THREAD;
  return {
    ...state.threads,
    [trackId]: { ...current, items: current.items.map((c) => (c.id === id ? { ...c, ...patch } : c)) },
  };
}

export const useCommunity = create<CommunityState>()((set, get) => ({
  threads: {},
  amened: {},
  mine: [],
  mineLoaded: false,

  async loadMine(force = false) {
    if (get().mineLoaded && !force) return;
    if (!currentUser()) {
      set({ mine: [], mineLoaded: true });
      return;
    }
    try {
      const rows = await api.myComments(100);
      set({ mine: rows.map(fromServer), mineLoaded: true });
    } catch {
      // a profile page without notes is not an error worth shouting about
      set({ mineLoaded: true });
    }
  },

  async loadThread(trackId, force = false) {
    const existing = get().threads[trackId];
    if (existing && (existing.loaded || existing.loading) && !force) return;
    set((s) => ({ threads: patchThread(s, trackId, { loading: true, error: null }) }));
    try {
      const page = await api.comments(trackId, { order: "desc", limit: 60 });
      const items = page.items.map(fromServer);
      const amened: Record<string, boolean> = {};
      for (const row of page.items) if (row.amened) amened[row.id] = true;
      set((s) => ({
        threads: patchThread(s, trackId, { items, total: page.total, loaded: true, loading: false, error: null }),
        amened: { ...s.amened, ...amened },
      }));
    } catch (err) {
      const offline = isDemoError(err) || (err instanceof ApiError && err.status === 0);
      set((s) => ({
        threads: patchThread(s, trackId, {
          items: offline ? generatedFor(trackId) : s.threads[trackId]?.items ?? [],
          total: offline ? generatedFor(trackId).length : s.threads[trackId]?.total ?? 0,
          loaded: offline,
          loading: false,
          error: offline ? null : errorMessage(err, "Could not load the notes."),
        }),
      }));
    }
  },

  async addComment(draft) {
    const user = currentUser();
    const text = draft.text.trim().replace(/\s+/g, " ");
    if (!user) return null;
    if (!text || text.length > COMMENT_MAX) return null;
    try {
      const { comment } = await api.addComment(draft.trackId, text, draft.atLine ?? null);
      const row = fromServer(comment);
      set((s) => {
        const current = s.threads[draft.trackId] ?? EMPTY_THREAD;
        return {
          threads: {
            ...s.threads,
            [draft.trackId]: { ...current, items: [row, ...current.items], total: current.total + 1, loaded: true },
          },
          mine: [row, ...s.mine],
        };
      });
      return row;
    } catch {
      return null;
    }
  },

  async editComment(id, text) {
    const clean = text.trim().replace(/\s+/g, " ");
    if (!clean || clean.length > COMMENT_MAX) return false;
    const trackId = findTrack(get(), id);
    try {
      const res = await api.editComment(id, clean);
      if (!res.comment || !trackId) return false;
      set((s) => (trackId ? { threads: patchComment(s, trackId, id, fromServer(res.comment!)) } : s));
      return true;
    } catch {
      return false;
    }
  },

  async deleteComment(id) {
    const trackId = findTrack(get(), id);
    try {
      const res = await api.deleteComment(id);
      set((s) => ({
        mine: s.mine.filter((c) => c.id !== id),
        threads: trackId ? removeComment(s, trackId, id) : s.threads,
      }));
      return res.ok === true;
    } catch {
      return false;
    }
  },

  async toggleAmen(id) {
    const user = currentUser();
    if (!user) return false;
    const trackId = findTrack(get(), id);
    try {
      const res = await api.amen(id);
      set((s) => ({
        amened: { ...s.amened, [id]: res.amened },
        threads: trackId
          ? patchComment(s, trackId, id, { amens: res.amens })
          : s.threads,
      }));
      return res.amened;
    } catch {
      return false;
    }
  },

  async reportComment(id, reason) {
    const trackId = findTrack(get(), id);
    try {
      await api.report(id, reason.trim() || "Not appropriate here.");
      set((s) => (trackId ? { threads: patchComment(s, trackId, id, { reports: (s.threads[trackId]?.items.find((c) => c.id === id)?.reports ?? 0) + 1 }) } : s));
      return true;
    } catch {
      return false;
    }
  },

  amensFor: (id) => findComment(get(), id)?.amens ?? 0,

  isAmened: (id) => !!currentUser() && get().amened[id] === true,

  commentsFor: (trackId) => get().threads[trackId]?.items ?? [],

  countFor: (trackId) => {
    const thread = get().threads[trackId];
    if (!thread) return 0;
    return thread.items.filter((c) => !c.removed).length;
  },

  byAuthor: (accountId) =>
    Object.values(get().threads)
      .flatMap((t) => t.items)
      .filter((c) => c.authorId === accountId)
      .sort((a, b) => b.at - a.at),

  ownsComment: (id) => {
    const user = currentUser();
    const comment = findComment(get(), id);
    return !!user && !!comment && comment.authorId === user.id;
  },

  reset: () => set({ threads: {}, amened: {}, mine: [], mineLoaded: false }),
}));

function findComment(state: CommunityState, id: string): UserComment | undefined {
  for (const thread of Object.values(state.threads)) {
    const hit = thread.items.find((c) => c.id === id);
    if (hit) return hit;
  }
  return undefined;
}

function findTrack(state: CommunityState, id: string): string | null {
  for (const [trackId, thread] of Object.entries(state.threads)) {
    if (thread.items.some((c) => c.id === id)) return trackId;
  }
  return null;
}

/* ------------------------------------------------------------------ helpers */

export function timeAgoLabel(at: number, now = Date.now()): string {
  const secs = Math.max(1, Math.round((now - at) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 31) return `${Math.round(days / 7)} wk ago`;
  return `${Math.round(days / 30)} mo ago`;
}
