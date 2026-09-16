/**
 * The studio: publish a recording.
 *
 *  1. upload an mp3 (required; it is the nasheed)
 *  2. optionally upload cover art
 *  3. write the title, the tags and the lyrics — with timings if you have them
 *  4. publish, and it is in the catalogue
 *
 * Editing an existing nasheed goes through the same draft, which is why a draft
 * carries a `songId` when it started from something already published.
 *
 * The draft itself is stored on the server, one row per account, so a half-written
 * nasheed survives closing the laptop and is waiting on the next machine too. Nothing
 * about it is kept in this browser.
 */

import { create } from "zustand";
import { api, errorMessage } from "../lib/api";
import { getTrack } from "../data/catalog";
import { registerPreview, clearPreview } from "../data/preview";
import { useUi } from "./ui";
import { isSignedIn } from "./session";
import type {
  DraftLine,
  LyricLine,
  Song,
  SongDraft,
  SongStatus,
  StorageBucket,
} from "../../shared/types";
import { AUDIO_BUCKET, ARTWORK_BUCKET, DEFAULT_PREFS } from "../../shared/types";

export const EMPTY_LINE: DraftLine = {
  tr: "",
  ar: "",
  en: "",
  note: "",
  t: null,
};

export const EMPTY_DRAFT: SongDraft = {
  title: "",
  titleAr: "",
  note: "",
  tags: [],
  lines: [EMPTY_LINE, EMPTY_LINE, EMPTY_LINE, EMPTY_LINE],
  audioPath: null,
  audioMime: null,
  audioBytes: null,
  durationMs: null,
  artworkPath: null,
  songId: null,
  updatedAt: 0,
};

export type PublishError = { message: string; field?: string };

/**
 * Whether an object in storage is still spoken for.
 *
 * A draft's recording is uploaded under a fresh name every time, and "start over",
 * "replace the audio" and "replace the cover" all leave the old object behind. Deleting
 * one is only safe while no published nasheed points at it — editing an existing
 * nasheed puts *its* paths in the draft, and those files are not the draft's to throw
 * away.
 */
function stillUsed(
  songEntries: { audioPath: string | null; artworkPath: string | null }[],
  path: string | null,
): boolean {
  if (!path) return true;
  return songEntries.some(
    (song) => song.audioPath === path || song.artworkPath === path,
  );
}

export type UploadState = {
  /** 0..1 while an upload is running, null when nothing is uploading */
  progress: number | null;
  error: string | null;
};

type StudioState = {
  draft: SongDraft;
  entries: Song[];
  loading: boolean;
  publishing: boolean;
  savedAt: number;
  /** a save is in flight right now */
  saving: boolean;
  /** why the last save failed — null when the draft is safely stored */
  draftError: string | null;
  error: PublishError | null;
  /** true while a recording is being brought under the size limit, before it uploads */
  preparing: boolean;
  /** 0..1 of that compression pass, so the button can show it */
  uploadProgress: number | null;
  /** the local object URL while an mp3 is uploaded but not yet published */
  previewUrl: string | null;

  hydrate: () => Promise<void>;
  /** replace the published list — what a sign-out, or a fresh publish, does */
  applyServerSongs: (songs: Song[]) => void;
  loadMine: (force?: boolean) => Promise<void>;
  setDraft: (patch: Partial<SongDraft>) => void;
  setLine: (index: number, patch: Partial<DraftLine>) => void;
  addLine: () => void;
  removeLine: (index: number) => void;
  moveLine: (from: number, to: number) => void;
  setTags: (value: string) => void;
  setDuration: (ms: number) => void;

  attachAudio: (file: File) => Promise<boolean>;
  attachArtwork: (file: File) => Promise<boolean>;
  clearAudio: () => void;
  preview: () => string | null;

  saveDraft: (draft?: SongDraft) => Promise<void>;
  publish: () => Promise<Song | null>;
  unpublish: (songId: string) => Promise<void>;
  startEdit: (songId: string) => void;
  resetDraft: () => Promise<void>;
  validate: () => PublishError | null;
};

let saveTimer: number | null = null;

/** A draft is saved on a debounce: typing a lyric line must not be forty writes. */
/**
 * Debounced draft save.
 *
 * Two rules learned the hard way: a failure has to be *visible* (this used to swallow
 * everything, so a database that refused every write looked like a studio that simply
 * did not save), and it has to be retried without the person doing anything — a dropped
 * connection or a cold project should cost nothing but a moment.
 *
 * `flushSave` writes the pending draft immediately; the studio calls it when the tab is
 * hidden or the page is going away, so nothing typed in the last second is lost.
 */
let pendingDraft: SongDraft | null = null;

function queueSave(draft: SongDraft, commit: (draft: SongDraft) => void): void {
  if (!isSignedIn()) return;
  pendingDraft = draft;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    const next = pendingDraft;
    pendingDraft = null;
    if (next) commit(next);
  }, 900);
}

/** Write whatever is waiting right now. Returns true when there was something to write. */
export function flushDraftSave(): boolean {
  if (saveTimer === null || !pendingDraft) return false;
  window.clearTimeout(saveTimer);
  saveTimer = null;
  const next = pendingDraft;
  pendingDraft = null;
  void useStudio.getState().saveDraft(next);
  return true;
}

function linesFrom(draft: SongDraft): LyricLine[] {
  return draft.lines
    .map((line) => {
      const out: LyricLine = {};
      if (line.tr.trim()) out.tr = line.tr.trim();
      if (line.ar.trim()) out.ar = line.ar.trim();
      if (line.en.trim()) out.en = line.en.trim();
      if (line.note.trim()) out.note = line.note.trim();
      if (typeof line.t === "number" && Number.isFinite(line.t) && line.t >= 0)
        out.t = line.t;
      return out;
    })
    .filter((line) => line.tr || line.ar || line.en);
}

export function draftFromSong(song: Song): SongDraft {
  return {
    title: song.title,
    titleAr: song.titleAr ?? "",
    note: song.note,
    tags: song.tags,
    lines: song.lines.length
      ? song.lines.map((line) => ({
          tr: line.tr ?? "",
          ar: line.ar ?? "",
          en: line.en ?? "",
          note: line.note ?? "",
          t: line.t ?? null,
        }))
      : [EMPTY_LINE, EMPTY_LINE, EMPTY_LINE, EMPTY_LINE],
    audioPath: song.audioPath,
    audioMime: song.audioMime,
    audioBytes: song.audioBytes,
    durationMs: song.durationMs,
    artworkPath: song.artworkPath,
    songId: song.id,
    updatedAt: Date.now(),
  };
}

export const useStudio = create<StudioState>((set, get) => ({
  draft: { ...EMPTY_DRAFT },
  entries: [],
  loading: false,
  publishing: false,
  savedAt: 0,
  saving: false,
  draftError: null,
  error: null,
  preparing: false,
  uploadProgress: null,
  previewUrl: null,

  applyServerSongs: (songs) => set({ entries: songs }),

  hydrate: async () => {
    if (!isSignedIn()) return;
    try {
      const stored = await api.draft();
      if (stored)
        set({
          draft: { ...EMPTY_DRAFT, ...stored },
          savedAt: stored.updatedAt ?? 0,
        });
    } catch (err) {
      // a draft that will not load is not worth blocking the studio over — but it is
      // worth one line, because it is also the first symptom of a database that is behind
      set({
        draftError: errorMessage(err, "Your saved draft could not be read."),
      });
    }
  },

  loadMine: async (force = false) => {
    if (!isSignedIn()) {
      set({ entries: [] });
      return;
    }
    if (get().entries.length && !force) return;
    set({ loading: true });
    try {
      const page = await api.songs({
        owner: "me",
        limit: 100,
        sort: "new",
        status: undefined,
      });
      set({ entries: page.items, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: {
          message: errorMessage(err, "Could not load what you published."),
        },
      });
    }
  },

  setDraft: (patch) => {
    const draft = { ...get().draft, ...patch, updatedAt: Date.now() };
    set({ draft, error: null });
    queueSave(draft, (next) => void get().saveDraft(next));
  },

  setLine: (index, patch) => {
    const lines = get().draft.lines.map((line, i) =>
      i === index ? { ...line, ...patch } : line,
    );
    get().setDraft({ lines });
  },

  addLine: () => {
    const lines = get().draft.lines;
    if (lines.length >= 40) {
      set({
        error: {
          message: "A nasheed is at most 40 lines here.",
          field: "lines",
        },
      });
      return;
    }
    get().setDraft({ lines: [...lines, { ...EMPTY_LINE }] });
  },

  removeLine: (index) => {
    const lines = get().draft.lines.filter((_, i) => i !== index);
    get().setDraft({ lines: lines.length ? lines : [{ ...EMPTY_LINE }] });
  },

  moveLine: (from, to) => {
    const lines = get().draft.lines.slice();
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= lines.length ||
      to >= lines.length
    )
      return;
    const [moved] = lines.splice(from, 1);
    lines.splice(to, 0, moved!);
    get().setDraft({ lines });
  },

  setTags: (value) => {
    const tags = value
      .split(",")
      .map((tag) =>
        tag
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9\- ]/g, "")
          .replace(/\s+/g, "-"),
      )
      .filter(Boolean)
      .filter((tag, index, all) => all.indexOf(tag) === index)
      .slice(0, 8);
    get().setDraft({ tags });
  },

  setDuration: (ms) => {
    const current = get().draft.durationMs;
    // the audio element measures it exactly; do not churn the draft on every event
    if (current && Math.abs(current - ms) < 1500) return;
    get().setDraft({ durationMs: ms });
  },

  async attachAudio(file) {
    if (!isSignedIn()) {
      useUi.getState().requestAuth({ label: "Sign in to upload a recording" });
      return false;
    }
    if (!/\.mp3$/i.test(file.name)) {
      set({
        error: { message: "Recordings must be .mp3 files.", field: "audio" },
      });
      return false;
    }
    if (typeof URL !== "undefined" && URL.createObjectURL) {
      const previous = get().previewUrl;
      if (previous) URL.revokeObjectURL(previous);
      set({ previewUrl: URL.createObjectURL(file) });
    }
    const previousAudio = get().draft.audioPath;
    set({ error: null, preparing: true, uploadProgress: null });
    try {
      /* A recording over the limit is transcoded here, in the browser, before a byte
         goes anywhere — which can take a few seconds on a long file. The interface says
         so, rather than looking asleep. */
      const uploaded = await api.uploadAudio(file, (progress) =>
        set({ uploadProgress: progress }),
      );
      get().setDraft({
        audioPath: uploaded.path,
        audioBytes: uploaded.bytes,
        audioMime: uploaded.mime,
      });
      /* the file this one replaces is nobody's now */
      if (!stillUsed(get().entries, previousAudio))
        void api.removeUploads([
          { bucket: AUDIO_BUCKET, path: previousAudio! },
        ]);
      return true;
    } catch (err) {
      set({
        error: {
          message: errorMessage(err, "That upload did not finish."),
          field: "audio",
        },
      });
      return false;
    } finally {
      set({ preparing: false, uploadProgress: null });
    }
  },

  async attachArtwork(file) {
    if (!isSignedIn()) {
      useUi.getState().requestAuth({ label: "Sign in to upload cover art" });
      return false;
    }
    const previousArtwork = get().draft.artworkPath;
    set({ error: null, preparing: true });
    try {
      /* Cover art over 2 MB is resized here before it is uploaded. */
      const uploaded = await api.uploadArtwork(file);
      get().setDraft({ artworkPath: uploaded.path });
      if (!stillUsed(get().entries, previousArtwork))
        void api.removeUploads([
          { bucket: ARTWORK_BUCKET, path: previousArtwork! },
        ]);
      return true;
    } catch (err) {
      set({
        error: {
          message: errorMessage(err, "That image did not upload."),
          field: "artwork",
        },
      });
      return false;
    } finally {
      set({ preparing: false });
    }
  },

  clearAudio: () => {
    const url = get().previewUrl;
    if (url && typeof URL !== "undefined") URL.revokeObjectURL(url);
    const dropped = get().draft.audioPath;
    set({ previewUrl: null });
    get().setDraft({ audioPath: null, audioBytes: null, audioMime: null });
    if (!stillUsed(get().entries, dropped))
      void api.removeUploads([{ bucket: AUDIO_BUCKET, path: dropped! }]);
  },

  /** The URL the player should use for a preview: the local file first, then storage. */
  preview: () => get().previewUrl ?? null,

  saveDraft: async (draftOverride) => {
    if (!isSignedIn()) return;
    const draft = { ...(draftOverride ?? get().draft), updatedAt: Date.now() };
    set({ draft, saving: true });
    try {
      await api.saveDraft(draft);
      set({ savedAt: Date.now(), saving: false, draftError: null });
    } catch (err) {
      /* Say it. A silent catch here is what made "saving does not work" impossible to
         diagnose: the header said nothing, and the reason was thrown away. */
      set({
        saving: false,
        draftError: errorMessage(err, "Your draft could not be saved."),
      });
    }
  },

  validate: () => {
    const draft = get().draft;
    if (draft.title.trim().length < 2)
      return { message: "A title is required.", field: "title" };
    if (draft.title.trim().length > 120)
      return { message: "A title is at most 120 characters.", field: "title" };
    if (!draft.audioPath)
      return { message: "Upload the mp3 before publishing.", field: "audio" };
    if (!linesFrom(draft).length)
      return { message: "Add at least one line of lyrics.", field: "lines" };
    return null;
  },

  async publish() {
    if (!isSignedIn()) {
      useUi.getState().requestAuth({ label: "Sign in to publish" });
      return null;
    }
    const problem = get().validate();
    if (problem) {
      set({ error: problem });
      return null;
    }

    const draft = get().draft;
    set({ publishing: true, error: null, draftError: null });
    try {
      const input = {
        title: draft.title,
        titleAr: draft.titleAr || null,
        note: draft.note || null,
        tags: draft.tags,
        lines: linesFrom(draft),
        audioPath: draft.audioPath!,
        audioMime: draft.audioMime,
        audioBytes: draft.audioBytes,
        durationMs: draft.durationMs,
        artworkPath: draft.artworkPath,
      };

      const result = draft.songId
        ? await api.updateSong(draft.songId, input)
        : await api.publish(input);
      const song = result.song;

      set((s) => ({
        publishing: false,
        savedAt: Date.now(),
        entries: [song, ...s.entries.filter((entry) => entry.id !== song.id)],
        draft: { ...get().draft, songId: song.id },
      }));
      await api.discardDraft().catch(() => {});
      /* the catalogue everyone reads is a module-level registry: refresh it in place so
         the new nasheed is on the home page, in search and on the reciter's page too */
      void import("../lib/boot")
        .then((m) => m.refreshCatalog())
        .catch(() => {});
      return song;
    } catch (err) {
      set({
        publishing: false,
        error: { message: errorMessage(err, "That did not publish.") },
      });
      return null;
    }
  },

  async unpublish(songId) {
    const previous = get().entries;
    set({
      entries: previous.map((song) =>
        song.id === songId
          ? { ...song, status: "removed" as SongStatus }
          : song,
      ),
    });
    try {
      await api.setSongStatus(songId, "removed");
      void import("../lib/boot")
        .then((m) => m.refreshCatalog())
        .catch(() => {});
    } catch (err) {
      set({
        entries: previous,
        error: { message: errorMessage(err, "Could not take that down.") },
      });
    }
  },

  startEdit: (songId) => {
    const song = getTrack(songId);
    if (!song) return;
    set({ draft: draftFromSong(song), error: null, previewUrl: null });
  },

  async resetDraft() {
    const url = get().previewUrl;
    if (url && typeof URL !== "undefined") URL.revokeObjectURL(url);
    clearPreview();
    /* What the draft was holding, before the draft is emptied. */
    const discarded = get().draft;
    set({
      draft: { ...EMPTY_DRAFT, updatedAt: Date.now() },
      error: null,
      previewUrl: null,
      savedAt: 0,
    });
    await api.discardDraft().catch(() => {});
    /* The row is gone; the objects behind it go too, unless a published nasheed is
       still playing them. */
    const entries = get().entries;
    const orphans: { bucket: StorageBucket; path: string }[] = [];
    if (!stillUsed(entries, discarded.audioPath))
      orphans.push({ bucket: AUDIO_BUCKET, path: discarded.audioPath! });
    if (!stillUsed(entries, discarded.artworkPath))
      orphans.push({ bucket: ARTWORK_BUCKET, path: discarded.artworkPath! });
    await api.removeUploads(orphans);
  },
}));

/**
 * Put the current draft into the player, so the publisher hears it through the same
 * player a listener will use — real duration, real progress, real lyrics.
 */
export function previewDraftInPlayer(): Song | null {
  const draft = useStudio.getState().draft;
  const url = useStudio.getState().previewUrl;
  if (!draft.audioPath && !url) return null;

  const song: Song = {
    id: "preview_current_draft",
    ownerId: null,
    ownerHandle: null,
    ownerName: null,
    title: draft.title.trim() || "Untitled draft",
    titleAr: draft.titleAr || null,
    note: draft.note,
    tags: draft.tags,
    lines: linesFrom(draft),
    // the local file wins while it is still on this machine; the storage path works
    // from anywhere, which is what the player falls back to
    audioPath: draft.audioPath ?? url ?? "",
    audioMime: draft.audioMime ?? null,
    audioBytes: draft.audioBytes,
    durationMs: draft.durationMs,
    artworkPath: draft.artworkPath,
    status: "live",
    publishedAt: Date.now(),
    plays: 0,
    likes: 0,
    notes: 0,
  };
  registerPreview(song);
  return song;
}

export { DEFAULT_PREFS };
