/**
 * The studio: the draft you are writing, and what you have published.
 *
 * Publishing here can mean two things, and both end up as a real nasheed on the server:
 *
 *   1. a composition — a maqām, a tempo, a voice arrangement and some lines of poetry.
 *      The browser's synthesis engine performs it, and because the lyric timings come
 *      from the same schedule the engine plays, the karaoke view cannot drift.
 *   2. a recording — an mp3 or wav you attach. It is uploaded to storage, streamed back
 *      with range support so seeking works, and sung over by nobody: your voices, your
 *      take. The composition you wrote alongside it still drives the lyric timeline.
 *
 * The draft itself is kept on this device, so a half-written nasheed survives a reload.
 * The moment you publish, it belongs to your account and follows you everywhere.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { api, errorMessage } from "../lib/api";
import { applySong, forgetSong, getTrack } from "../data/catalog";
import type { Accent, Artist, LyricLine, Track } from "../data/types";
import type { MaqamName } from "../lib/theory";
import { MAQAMAT } from "../lib/theory";
import { currentUser, useSession, type Account } from "./session";
import type { Song, SongInput, SongStatus } from "../../shared/types";

export const DUFF_PATTERNS: { id: string; label: string; pattern: string }[] = [
  { id: "malfuf", label: "Malfūf — rolling", pattern: "D..T..D.T..T.D.." },
  { id: "simple", label: "Simple — dum and tak", pattern: "D...T...D...T..." },
  { id: "ayyub", label: "Ayyūb — driving", pattern: "D..TD..TD.T.D..T" },
  { id: "roll", label: "Roll — busy tak", pattern: "D..TD..TD..TD..T" },
  { id: "sparse", label: "Sparse — two a bar", pattern: "D.......D...T..." },
];

export type DraftLine = { tr: string; ar: string; en: string; note: string };

export type Draft = {
  title: string;
  titleAr: string;
  note: string;
  maqam: MaqamName;
  root: number;
  bpm: number;
  voices: Track["voices"];
  duff: string | null;
  duffEnter: "intro" | "verse";
  passes: number;
  accent: Accent;
  tags: string[];
  lines: DraftLine[];
};

export const EMPTY_LINE: DraftLine = { tr: "", ar: "", en: "", note: "" };

export const DEFAULT_DRAFT: Draft = {
  title: "",
  titleAr: "",
  note: "",
  maqam: "bayati",
  root: 57,
  bpm: 68,
  voices: "solo",
  duff: null,
  duffEnter: "verse",
  passes: 2,
  accent: "jade",
  tags: ["original"],
  lines: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }],
};

/** A published nasheed, as the studio lists it. */
export type PublishedEntry = Omit<Draft, "lines"> & {
  id: string;
  /** the publisher's uuid — what the database keys ownership by */
  ownerId: string;
  /** the publisher's handle — what the catalogue and its URLs key publishers by */
  ownerHandle?: string;
  publishedAt: number;
  lines: LyricLine[];
  /** an uploaded recording exists, so this plays your voices rather than the engine */
  hasAudio: boolean;
  hasArtwork: boolean;
  status: SongStatus;
  plays: number;
  likes: number;
  notes: number;
};

export type PublishError = { ok: false; field: "title" | "lines" | "audio" | "form"; msg: string };
export type PublishResult = { ok: true; track: Track } | PublishError;

/** Attachments waiting to go up with the next publish. */
export type Attachment = {
  file: File;
  name: string;
  bytes: number;
  /** decoded length, when the browser could read it */
  durationMs: number | null;
};

/* ------------------------------------------------------------------ helpers */

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[\u0600-\u06FF\u0750-\u077F]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || "nasheed";
}

export function draftToLines(lines: DraftLine[]): LyricLine[] {
  return lines
    .map((l) => ({
      tr: l.tr.trim() || undefined,
      ar: l.ar.trim() || undefined,
      en: l.en.trim() || undefined,
      note: l.note.trim() || undefined,
    }))
    .filter((l) => l.tr || l.ar || l.en);
}

/** Returns the failure, or null when the draft is publishable. */
export function validateDraft(draft: Draft, account: Account | null, audio?: Attachment | null): PublishError | null {
  if (!account) return { ok: false, field: "form", msg: "You need an account to publish." };
  if (draft.title.trim().length < 2) return { ok: false, field: "title", msg: "Give it a title — two characters at least." };
  if (draft.title.trim().length > 120) return { ok: false, field: "title", msg: "That title is too long to set." };
  if (draftToLines(draft.lines).length === 0)
    return { ok: false, field: "lines", msg: "Add at least one line. Transliteration or Arabic is what gets sung." };
  if (draftToLines(draft.lines).length > 40) return { ok: false, field: "lines", msg: "Forty lines is a book, not a nasheed." };
  if (draft.bpm < 40 || draft.bpm > 180) return { ok: false, field: "form", msg: "Tempo has to sit between 40 and 180 bpm." };
  if (draft.root < 36 || draft.root > 84) return { ok: false, field: "form", msg: "Pick a tonic between C2 and C6." };
  if (draft.passes < 1 || draft.passes > 6) return { ok: false, field: "form", msg: "Between one and six repetitions." };
  if (draft.duff && !/^[DT.]{16}$/.test(draft.duff)) return { ok: false, field: "form", msg: "A duff pattern is 16 steps of D, T or ." };
  if (audio && audio.bytes <= 0) return { ok: false, field: "audio", msg: "That audio file is empty." };
  return null;
}

/** The composition part of a publish — everything except the attached files. */
export function songInputFromDraft(draft: Draft, extra: Partial<SongInput> = {}): SongInput {
  return {
    title: draft.title.trim(),
    titleAr: draft.titleAr.trim() || null,
    note: draft.note.trim() || null,
    maqam: draft.maqam,
    root: draft.root,
    bpm: draft.bpm,
    voices: draft.voices,
    duff: draft.duff,
    duffEnter: draft.duffEnter,
    passes: draft.passes,
    accent: draft.accent,
    tags: draft.tags.length ? draft.tags.slice(0, 8) : ["original"],
    lines: draftToLines(draft.lines),
    ...extra,
  };
}

export function entryFromSong(song: Song): PublishedEntry {
  return {
    id: song.id,
    ownerId: song.ownerId ?? "",
    ownerHandle: song.ownerHandle ?? "",
    publishedAt: song.publishedAt,
    title: song.title,
    titleAr: song.titleAr ?? "",
    note: song.note,
    maqam: song.maqam,
    root: song.root,
    bpm: song.bpm,
    voices: song.voices,
    duff: song.duff,
    duffEnter: song.duffEnter,
    passes: song.passes,
    accent: song.accent,
    tags: song.tags,
    lines: song.lines.map((l) => ({ ...l })),
    hasAudio: !!song.audioPath,
    hasArtwork: !!song.artworkPath,
    status: song.status,
    plays: song.plays,
    likes: song.likes,
    notes: song.notes,
  };
}

export function trackForEntry(entry: PublishedEntry, account: Account | null): Track {
  const who = account?.name ?? "a listener";
  const maqam = MAQAMAT[entry.maqam];
  return {
    id: entry.id,
    title: entry.title,
    titleAr: entry.titleAr || undefined,
    artistId: entry.ownerHandle || entry.ownerId,
    collections: [],
    tags: entry.tags.length ? entry.tags : ["original"],
    maqam: entry.maqam,
    root: entry.root,
    bpm: entry.bpm,
    voices: entry.voices,
    duff: entry.duff ?? undefined,
    duffEnter: entry.duff ? entry.duffEnter : undefined,
    introBars: entry.duff && entry.duffEnter === "intro" ? 2 : 1,
    passes: entry.passes,
    blurb:
      entry.note.trim() ||
      `Published by ${who}. ${maqam?.name ?? entry.maqam} at ${entry.bpm} bpm, ${entry.voices}${entry.duff ? " with duff" : ", vocals only"}.`,
    year: new Date(entry.publishedAt).getFullYear(),
    seed: `published-${entry.id}`,
    accent: entry.accent,
    lines: entry.lines,
    ownerId: entry.ownerId,
    stats: { plays: entry.plays, likes: entry.likes, notes: entry.notes },
    status: entry.status,
    publishedAt: entry.publishedAt,
  };
}

/** A publisher page for yourself, until the server's own copy is loaded. */
export function artistForAccount(account: Account, entries: PublishedEntry[]): Artist {
  const first = entries[0];
  return {
    id: account.id,
    name: account.name,
    role: "listener · publisher",
    origin: account.city || "—",
    bio: account.bio.trim() || `@${account.handle} publishes on CoolNasheed.`,
    seed: account.seed,
    accent: first?.accent ?? "jade",
    verified: false,
  };
}

/** The same, for a draft that has not been published yet — used by the preview player. */
export function draftTrack(draft: Draft, account: Account | null): Track | null {
  const lines = draftToLines(draft.lines);
  if (!account || !lines.length || draft.title.trim().length < 2) return null;
  const entry: PublishedEntry = {
    ...draft,
    id: `draft-${account.id}`,
    ownerId: account.id,
    ownerHandle: account.handle,
    publishedAt: Date.now(),
    lines,
    hasAudio: false,
    hasArtwork: false,
    status: "live",
    plays: 0,
    likes: 0,
    notes: 0,
  };
  return trackForEntry(entry, account);
}

/** Read a recording's length in the browser, so the server can store it. */
export function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolvePromise) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolvePromise(value);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null);
    el.onerror = () => done(null);
    el.src = url;
    // a file that never reports metadata should not hang the publish form
    window.setTimeout(() => done(null), 8000);
  });
}

/* -------------------------------------------------------------------- store */

type StudioState = {
  /** what this account has on the server */
  entries: PublishedEntry[];
  draft: Draft;
  audio: Attachment | null;
  artwork: Attachment | null;
  publishing: boolean;
  loading: boolean;
  error: string | null;

  setDraft: (patch: Partial<Draft>) => void;
  setLine: (index: number, patch: Partial<DraftLine>) => void;
  addLine: () => void;
  removeLine: (index: number) => void;
  moveLine: (from: number, to: number) => void;
  resetDraft: () => void;

  setAudio: (file: File | null) => Promise<void>;
  setArtwork: (file: File | null) => Promise<void>;

  publish: () => Promise<PublishResult>;
  unpublish: (trackId: string) => Promise<boolean>;
  owns: (trackId: string) => boolean;
  byOwner: (accountId: string) => PublishedEntry[];
  loadMine: (force?: boolean) => Promise<void>;
  applyServerSongs: (songs: Song[]) => void;
};

const MAX_AUDIO_BYTES = 48 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function attachment(file: File, durationMs: number | null): Attachment {
  return { file, name: file.name, bytes: file.size, durationMs };
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      entries: [],
      draft: { ...DEFAULT_DRAFT, lines: DEFAULT_DRAFT.lines.map((l) => ({ ...l })) },
      audio: null,
      artwork: null,
      publishing: false,
      loading: false,
      error: null,

      setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),

      setLine: (index, patch) =>
        set((s) => ({ draft: { ...s.draft, lines: s.draft.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) } })),

      addLine: () => set((s) => ({ draft: { ...s.draft, lines: [...s.draft.lines, { ...EMPTY_LINE }] } })),

      removeLine: (index) => set((s) => ({ draft: { ...s.draft, lines: s.draft.lines.filter((_, i) => i !== index) } })),

      moveLine: (from, to) =>
        set((s) => {
          const lines = [...s.draft.lines];
          if (to < 0 || to >= lines.length) return s;
          const [moved] = lines.splice(from, 1);
          lines.splice(to, 0, moved!);
          return { draft: { ...s.draft, lines } };
        }),

      resetDraft: () =>
        set({ draft: { ...DEFAULT_DRAFT, lines: DEFAULT_DRAFT.lines.map((l) => ({ ...l })) }, audio: null, artwork: null, error: null }),

      async setAudio(file) {
        if (!file) {
          set({ audio: null, error: null });
          return;
        }
        if (!/^audio\//.test(file.type) && !/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(file.name)) {
          set({ error: "That is not an audio file. mp3, wav, m4a, ogg or flac." });
          return;
        }
        if (file.size > MAX_AUDIO_BYTES) {
          set({ error: "That recording is bigger than 48 MB. Trim it or export it smaller." });
          return;
        }
        set({ error: null, audio: attachment(file, null) });
        const durationMs = await probeDuration(file);
        // they may have swapped the file while we were reading it
        if (get().audio?.name === file.name && get().audio?.bytes === file.size) set({ audio: attachment(file, durationMs) });
      },

      async setArtwork(file) {
        if (!file) {
          set({ artwork: null, error: null });
          return;
        }
        if (!/^image\//.test(file.type)) {
          set({ error: "Cover art has to be an image: png, jpg, webp or svg." });
          return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          set({ error: "That image is bigger than 8 MB." });
          return;
        }
        set({ error: null, artwork: attachment(file, null) });
      },

      async publish() {
        const account = currentUser() ? { ...currentUser()! } as Account : null;
        const draft = get().draft;
        const invalid = validateDraft(draft, account, get().audio);
        if (invalid) return invalid;

        set({ publishing: true, error: null });
        try {
          const audio = get().audio;
          const artwork = get().artwork;
          const res = await api.publish(songInputFromDraft(draft), {
            audio: audio?.file ?? null,
            artwork: artwork?.file ?? null,
            durationMs: audio?.durationMs ?? null,
          });
          const track = applySong(res.song);
          set((s) => ({
            publishing: false,
            audio: null,
            artwork: null,
            entries: [entryFromSong(res.song), ...s.entries.filter((e) => e.id !== res.song.id)],
            draft: { ...DEFAULT_DRAFT, lines: DEFAULT_DRAFT.lines.map((l) => ({ ...l })) },
          }));
          return { ok: true, track };
        } catch (err) {
          const message = errorMessage(err, "Publishing did not go through.");
          set({ publishing: false, error: message });
          return { ok: false, field: "form", msg: message };
        }
      },

      async unpublish(trackId) {
        const user = currentUser();
        if (!user) return false;
        try {
          await api.removeSong(trackId);
          forgetSong(trackId);
          set((s) => ({ entries: s.entries.filter((e) => e.id !== trackId) }));
          return true;
        } catch (err) {
          set({ error: errorMessage(err, "Could not take that down.") });
          return false;
        }
      },

      owns: (trackId) => {
        const user = currentUser();
        if (!user) return false;
        if (get().entries.some((e) => e.id === trackId && (e.ownerId === user.profileId || e.ownerHandle === user.handle))) {
          return true;
        }
        const track = getTrack(trackId);
        return track?.ownerId === user.profileId;
      },

      byOwner: (accountId) =>
        get()
          .entries.filter((e) => e.ownerId === accountId || e.ownerHandle === accountId)
          .sort((a, b) => b.publishedAt - a.publishedAt),

      async loadMine(force = false) {
        const user = currentUser();
        if (!user) {
          set({ entries: [] });
          return;
        }
        if (get().entries.length && !force) return;
        set({ loading: true });
        try {
          const page = await api.songs({ owner: "me", limit: 100, sort: "new" });
          const entries = page.items.map(entryFromSong);
          for (const song of page.items) applySong(song);
          set({ entries, loading: false, error: null });
        } catch (err) {
          set({ loading: false, error: errorMessage(err, "Could not load what you published.") });
        }
      },

      applyServerSongs: (songs) => {
        const user = currentUser();
        if (!user) {
          set({ entries: [] });
          return;
        }
        const mine = songs.filter((s) => s.ownerId === user.profileId).map(entryFromSong);
        set((s) => ({ entries: [...mine, ...s.entries.filter((e) => !mine.some((m) => m.id === e.id))] }));
      },
    }),
    {
      name: "coolnasheed:studio:v2",
      storage: createJSONStorage(() => localStorage),
      // the draft survives a reload; the published list and any attachment do not
      partialize: (s) => ({ draft: s.draft }),
    },
  ),
);

/** Signing out empties the studio's list of what you published. */
useSession.subscribe((state, prev) => {
  if (prev.user?.id && !state.user) useStudio.setState({ entries: [], audio: null, artwork: null });
});
