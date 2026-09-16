/**
 * Your library: what you loved, who you follow, the sets you built, what you played,
 * the dhikr counter and your settings.
 *
 * All of it lives on the server, under your account. Nothing here is written to
 * `localStorage`: a signed-out visitor gets the defaults and is asked for an account
 * the moment they try to keep something, and somebody who signs in on a second device
 * finds their theme, volume, lyric preferences and count exactly where they left them.
 *
 * Writes are optimistic — the heart fills the instant you tap it, the request follows,
 * and if the server says no the heart goes back and you are told why.
 */

import { create } from "zustand";
import { api, errorMessage, type Bootstrap } from "../lib/api";
import { isPreview } from "../data/preview";
import { useUi } from "./ui";
import { isSignedIn } from "./session";
import { DEFAULT_PREFS, type Accent, type DhikrState, type HistoryRow, type LyricScript, type Playlist as ServerPlaylist } from "../../shared/types";

export type Settings = {
  theme: "night" | "dawn";
  volume: number;
  muted: boolean;
  lyricScript: LyricScript;
  showArabic: boolean;
  showTranslation: boolean;
  reduceMotion: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_PREFS.theme,
  volume: DEFAULT_PREFS.volume,
  muted: false,
  lyricScript: DEFAULT_PREFS.lyricScript,
  showArabic: DEFAULT_PREFS.showArabic,
  showTranslation: DEFAULT_PREFS.showTranslation,
  reduceMotion: DEFAULT_PREFS.reduceMotion,
};

export type Playlist = {
  id: string;
  name: string;
  blurb: string;
  accent: Accent;
  trackIds: string[];
  createdAt: number;
};

export type HistoryEntry = { id: string; at: number; count: number };

export const DHIKR = [
  { id: "subhanallah", ar: "سُبْحَانَ اللهِ", tr: "Subḥān Allāh", en: "Glory be to Allah", target: 33 },
  { id: "alhamdulillah", ar: "الحَمْدُ لِلَّهِ", tr: "Alḥamdulillāh", en: "Praise be to Allah", target: 33 },
  { id: "allahuakbar", ar: "اللهُ أَكْبَرُ", tr: "Allāhu Akbar", en: "Allah is greatest", target: 34 },
  { id: "istighfar", ar: "أَسْتَغْفِرُ اللهَ", tr: "Astaghfirullāh", en: "I seek Allah's forgiveness", target: 100 },
  { id: "tahlil", ar: "لَا إِلَهَ إِلَّا اللهُ", tr: "Lā ilāha illā Allāh", en: "There is no god but Allah", target: 100 },
  { id: "salawat", ar: "صَلَّى اللهُ عَلَيْهِ وَسَلَّمَ", tr: "Ṣallallāhu ʿalayhi wa sallam", en: "Blessings and peace upon him ﷺ", target: 100 },
];

export const DEFAULT_DHIKR: Record<string, DhikrState> = Object.fromEntries(
  DHIKR.map((phrase) => [phrase.id, { count: 0, target: phrase.target }]),
);

const ACCENTS: Accent[] = ["jade", "gold", "turq", "madder", "cobalt"];

function fromServer(playlist: ServerPlaylist): Playlist {
  return {
    id: playlist.id,
    name: playlist.name,
    blurb: playlist.blurb,
    accent: playlist.accent,
    trackIds: playlist.songIds,
    createdAt: playlist.createdAt,
  };
}

type LibraryState = {
  liked: string[];
  likedCollections: string[];
  followedArtists: string[];
  playlists: Playlist[];
  history: HistoryEntry[];
  settings: Settings;
  dhikr: Record<string, DhikrState>;
  dhikrActive: string;
  syncing: boolean;
  lastError: string | null;

  /** null means "blocked — there is no account", which is not the same as false */
  toggleLike: (id: string) => boolean | null;
  isLiked: (id: string) => boolean;
  toggleCollection: (id: string) => boolean | null;
  isCollectionSaved: (id: string) => boolean;
  toggleArtist: (id: string) => boolean | null;
  createPlaylist: (name: string, trackIds?: string[], blurb?: string) => Promise<Playlist | null>;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, name: string) => void;
  addToPlaylist: (playlistId: string, trackId: string) => boolean | null;
  removeFromPlaylist: (playlistId: string, trackId: string) => void;
  movePlaylistTrack: (playlistId: string, from: number, to: number) => void;
  recordPlay: (id: string) => void;
  clearHistory: () => void;

  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
  applySettings: (settings: Settings) => void;

  dhikrSelect: (phrase: string) => void;
  dhikrTick: () => number;
  dhikrReset: (phrase?: string) => void;

  loadFromServer: () => Promise<void>;
  applyBootstrap: (payload: Bootstrap | { liked: string[]; followed: string[]; playlists: ServerPlaylist[]; history?: HistoryRow[] }) => void;
  clearAccountData: () => void;
};

/** Writing to your library needs an account; listening never does. */
function signedInFor(label: string, run: () => void): boolean {
  if (isSignedIn()) return true;
  useUi.getState().requestAuth({ label, run });
  return false;
}

/** Settings are saved on a short debounce: a volume slider must not be 40 writes. */
let settingsTimer: number | null = null;

function persistSettings(settings: Settings): void {
  if (!isSignedIn()) return;
  if (settingsTimer !== null) window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => {
    settingsTimer = null;
    void api.savePrefs(settings).catch(() => {
      /* the interface already has the new value; a failed save is retried on the next change */
    });
  }, 600);
}

/** Dhikr taps are saved on a longer debounce for the same reason. */
let dhikrTimer: number | null = null;

function persistDhikr(phrase: string, state: DhikrState): void {
  if (!isSignedIn()) return;
  if (dhikrTimer !== null) window.clearTimeout(dhikrTimer);
  dhikrTimer = window.setTimeout(() => {
    dhikrTimer = null;
    void api.saveDhikr(phrase, state).catch(() => {});
  }, 1500);
}

export const useLibrary = create<LibraryState>((set, get) => ({
  liked: [],
  likedCollections: [],
  followedArtists: [],
  playlists: [],
  history: [],
  settings: { ...DEFAULT_SETTINGS },
  dhikr: { ...DEFAULT_DHIKR },
  dhikrActive: DHIKR[0]!.id,
  syncing: false,
  lastError: null,

  toggleLike: (id) => {
    if (!signedInFor("Sign in to love nasheeds and keep them here", () => get().toggleLike(id))) return null;
    const before = get().liked;
    const now = before.includes(id);
    set({ liked: now ? before.filter((x) => x !== id) : [...before, id], syncing: true });
    void api
      .like(id)
      .then((res) => {
        // trust the server's answer, not our guess
        set((s) => ({
          liked: res.liked ? (s.liked.includes(id) ? s.liked : [...s.liked, id]) : s.liked.filter((x) => x !== id),
        }));
      })
      .catch((err) => set({ liked: before, lastError: errorMessage(err, "Could not reach the server.") }))
      .finally(() => set({ syncing: false }));
    return !now;
  },

  isLiked: (id) => get().liked.includes(id),

  toggleCollection: (id) => {
    if (!signedInFor("Sign in to save shelves to your library", () => get().toggleCollection(id))) return null;
    const before = get().likedCollections;
    const has = before.includes(id);
    set({ likedCollections: has ? before.filter((x) => x !== id) : [...before, id], syncing: true });
    void api
      .saveCollection(id)
      .then((res) => {
        set((s) => ({
          likedCollections: res.saved
            ? s.likedCollections.includes(id) ? s.likedCollections : [...s.likedCollections, id]
            : s.likedCollections.filter((x) => x !== id),
        }));
      })
      .catch((err) => set({ likedCollections: before, lastError: errorMessage(err, "Could not reach the server.") }))
      .finally(() => set({ syncing: false }));
    return !has;
  },

  isCollectionSaved: (id) => get().likedCollections.includes(id),

  toggleArtist: (id) => {
    if (!signedInFor("Sign in to follow publishers", () => get().toggleArtist(id))) return null;
    const before = get().followedArtists;
    const has = before.includes(id);
    set({ followedArtists: has ? before.filter((x) => x !== id) : [...before, id], syncing: true });
    void api
      .follow(id)
      .then((res) => {
        set((s) => ({
          followedArtists: res.following
            ? s.followedArtists.includes(id) ? s.followedArtists : [...s.followedArtists, id]
            : s.followedArtists.filter((x) => x !== id),
        }));
      })
      .catch((err) => set({ followedArtists: before, lastError: errorMessage(err, "Could not reach the server.") }))
      .finally(() => set({ syncing: false }));
    return !has;
  },

  async createPlaylist(name, trackIds = [], blurb) {
    if (!signedInFor("Sign in to build sets", () => void get().createPlaylist(name, trackIds, blurb))) return null;
    const clean = name.trim();
    if (!clean) return null;
    const ids = trackIds.filter((id, i, arr) => arr.indexOf(id) === i);
    set({ syncing: true });
    try {
      const created = await api.createPlaylist({ name: clean, blurb, songIds: ids });
      const playlist = fromServer(created);
      set((s) => ({
        playlists: [playlist, ...s.playlists.filter((p) => p.id !== playlist.id)],
        syncing: false,
        lastError: null,
      }));
      return playlist;
    } catch (err) {
      set({ syncing: false, lastError: errorMessage(err, "Could not create that set.") });
      return null;
    }
  },

  deletePlaylist: (id) => {
    if (!signedInFor("Sign in to change your sets", () => get().deletePlaylist(id))) return;
    const before = get().playlists;
    set({ playlists: before.filter((p) => p.id !== id), syncing: true });
    void api
      .deletePlaylist(id)
      .catch((err) => set({ playlists: before, lastError: errorMessage(err, "Could not delete that set.") }))
      .finally(() => set({ syncing: false }));
  },

  renamePlaylist: (id, name) => {
    if (!signedInFor("Sign in to change your sets", () => get().renamePlaylist(id, name))) return;
    const before = get().playlists;
    set({ playlists: before.map((p) => (p.id === id ? { ...p, name } : p)), syncing: true });
    void api
      .updatePlaylist(id, { name })
      .catch((err) => set({ playlists: before, lastError: errorMessage(err, "Could not rename that set.") }))
      .finally(() => set({ syncing: false }));
  },

  addToPlaylist: (playlistId, trackId) => {
    if (!signedInFor("Sign in to add this to a set", () => get().addToPlaylist(playlistId, trackId))) return null;
    const playlist = get().playlists.find((p) => p.id === playlistId);
    if (!playlist || playlist.trackIds.includes(trackId)) return false;
    const before = get().playlists;
    set({
      playlists: before.map((p) => (p.id === playlistId ? { ...p, trackIds: [...p.trackIds, trackId] } : p)),
      syncing: true,
    });
    void api
      .playlistSong(playlistId, trackId)
      .catch((err) => set({ playlists: before, lastError: errorMessage(err, "Could not add that.") }))
      .finally(() => set({ syncing: false }));
    return true;
  },

  removeFromPlaylist: (playlistId, trackId) => {
    if (!signedInFor("Sign in to change your sets", () => get().removeFromPlaylist(playlistId, trackId))) return;
    const before = get().playlists;
    set({
      playlists: before.map((p) =>
        p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((t) => t !== trackId) } : p,
      ),
      syncing: true,
    });
    void api
      .playlistSong(playlistId, trackId, true)
      .catch((err) => set({ playlists: before, lastError: errorMessage(err, "Could not remove that.") }))
      .finally(() => set({ syncing: false }));
  },

  movePlaylistTrack: (playlistId, from, to) => {
    if (!signedInFor("Sign in to change your sets", () => get().movePlaylistTrack(playlistId, from, to))) return;
    const before = get().playlists;
    const next = before.map((p) => {
      if (p.id !== playlistId) return p;
      const ids = p.trackIds.slice();
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved!);
      return { ...p, trackIds: ids };
    });
    set({ playlists: next, syncing: true });
    const moved = next.find((p) => p.id === playlistId);
    void api
      .updatePlaylist(playlistId, { songIds: moved?.trackIds ?? [] })
      .catch((err) => set({ playlists: before, lastError: errorMessage(err, "Could not reorder that set.") }))
      .finally(() => set({ syncing: false }));
  },

  recordPlay: (id) => {
    // a studio preview is not a listen
    if (isPreview(id)) return;
    const now = Date.now();
    const prev = get().history.find((entry) => entry.id === id);
    const history = get().history.filter((entry) => entry.id !== id);
    history.unshift({ id, at: now, count: (prev?.count ?? 0) + 1 });
    set({ history: history.slice(0, 60) });
  },

  clearHistory: () => set({ history: [] }),

  async setSetting(key, value) {
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    persistSettings(settings);
  },

  applySettings: (settings) => set({ settings: { ...DEFAULT_SETTINGS, ...settings } }),

  dhikrSelect: (phrase) => set({ dhikrActive: phrase }),

  dhikrTick: () => {
    const phrase = get().dhikrActive;
    const current = get().dhikr[phrase] ?? { count: 0, target: 33 };
    const next: DhikrState = { ...current, count: current.count + 1 };
    set({ dhikr: { ...get().dhikr, [phrase]: next } });
    persistDhikr(phrase, next);
    return next.count;
  },

  dhikrReset: (phrase) => {
    const target = phrase ?? get().dhikrActive;
    const current = get().dhikr[target] ?? { count: 0, target: 33 };
    const next: DhikrState = { ...current, count: 0 };
    set({ dhikr: { ...get().dhikr, [target]: next } });
    persistDhikr(target, next);
  },

  async loadFromServer() {
    if (!isSignedIn()) return;
    set({ syncing: true });
    try {
      const payload = await api.bootstrap();
      get().applyBootstrap(payload);
      set({ syncing: false, lastError: null });
    } catch (err) {
      set({ syncing: false, lastError: errorMessage(err, "Could not load your library.") });
    }
  },

  applyBootstrap: (payload) => {
    const boot = payload as Partial<Bootstrap>;
    set((s) => ({
      liked: boot.liked ?? s.liked,
      followedArtists: boot.followed ?? s.followedArtists,
      playlists: boot.playlists ? boot.playlists.map(fromServer) : s.playlists,
      likedCollections: boot.savedCollections ?? s.likedCollections,
      history: boot.history ? mergeHistory(boot.history, s.history) : s.history,
      settings: boot.prefs ? { ...DEFAULT_SETTINGS, ...boot.prefs } : s.settings,
      dhikr: boot.dhikr ? { ...DEFAULT_DHIKR, ...boot.dhikr } : s.dhikr,
      lastError: null,
    }));
  },

  clearAccountData: () =>
    set({
      liked: [],
      followedArtists: [],
      playlists: [],
      likedCollections: [],
      history: [],
      settings: { ...DEFAULT_SETTINGS },
      dhikr: { ...DEFAULT_DHIKR },
    }),
}));

/**
 * Server history is authoritative; the local mirror fills in what has not synced yet,
 * so a nasheed played a second ago does not vanish from the list while the beacon is
 * still in flight.
 */
function mergeHistory(rows: HistoryRow[], local: HistoryEntry[]): HistoryEntry[] {
  const merged = new Map<string, HistoryEntry>();
  for (const entry of local) merged.set(entry.id, entry);
  for (const row of rows) {
    const existing = merged.get(row.songId);
    merged.set(row.songId, {
      id: row.songId,
      at: Math.max(existing?.at ?? 0, row.lastAt),
      count: Math.max(existing?.count ?? 0, row.plays),
    });
  }
  return [...merged.values()].sort((a, b) => b.at - a.at).slice(0, 60);
}

/** The five accents are assigned by handle, deterministically, for avatars. */
export function accentFor(name: string): Accent {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length]!;
}
