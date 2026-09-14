/**
 * Your library: what you loved, who you follow, the sets you built, what you played.
 *
 * Everything except the settings and the tasbīḥ lives on the server, which is what
 * makes it yours on any device rather than this browser's. Writes are optimistic — the
 * heart fills the instant you tap it, the request follows, and if the server says no the
 * heart goes back and you are told why. That keeps the app feeling immediate without
 * pretending the network is not there.
 *
 * The gate lives here rather than in the components so there is no ungated path — not
 * through a button, not through a keyboard shortcut, not through a menu. Listening,
 * searching and browsing never touch it.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { api, deviceId, errorMessage } from "../lib/api";
import { isPreview } from "../data/catalog";
import { useUi } from "./ui";
import { isSignedIn } from "./session";
import type { Accent } from "../data/types";
import type { SpacePreset } from "../lib/audio/engine";
import type { HistoryRow, Playlist as ServerPlaylist } from "../../shared/types";

export type LyricScript = "tr" | "en" | "ar";

export type Settings = {
  theme: "night" | "dawn";
  space: SpacePreset;
  duff: boolean;
  volume: number;
  lyricScript: LyricScript;
  showArabic: boolean;
  showTranslation: boolean;
  reduceMotion: boolean;
};

export type Playlist = {
  id: string;
  name: string;
  blurb: string;
  seed: string;
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

export const DEFAULT_SETTINGS: Settings = {
  theme: "night",
  space: "hall",
  duff: true,
  volume: 0.85,
  lyricScript: "tr",
  showArabic: true,
  showTranslation: true,
  reduceMotion: false,
};

const ACCENTS: Accent[] = ["jade", "gold", "turq", "madder", "cobalt"];

function fromServer(playlist: ServerPlaylist): Playlist {
  return {
    id: playlist.id,
    name: playlist.name,
    blurb: playlist.blurb,
    seed: playlist.seed,
    accent: playlist.accent,
    trackIds: playlist.songIds,
    createdAt: playlist.createdAt,
  };
}

type LibraryState = {
  liked: string[];
  /** saved collections stay on this device: the server tracks sets you built, not shelves you bookmarked */
  likedCollections: string[];
  followedArtists: string[];
  playlists: Playlist[];
  history: HistoryEntry[];
  tasbih: { id: string; count: number };
  settings: Settings;
  /** a write is in flight — used to keep buttons honest about what is saved */
  syncing: boolean;
  lastError: string | null;

  /** null means "blocked — there is no account", which is not the same as false */
  toggleLike: (id: string) => boolean | null;
  isLiked: (id: string) => boolean;
  toggleCollection: (id: string) => boolean | null;
  toggleArtist: (id: string) => boolean | null;
  createPlaylist: (name: string, trackIds?: string[], blurb?: string) => Promise<Playlist | null>;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, name: string) => void;
  addToPlaylist: (playlistId: string, trackId: string) => boolean | null;
  removeFromPlaylist: (playlistId: string, trackId: string) => void;
  movePlaylistTrack: (playlistId: string, from: number, to: number) => void;
  recordPlay: (id: string) => void;
  clearHistory: () => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  tasbihTick: () => number;
  tasbihReset: () => void;
  tasbihSet: (id: string) => void;

  loadFromServer: () => Promise<void>;
  applyBootstrap: (payload: { liked: string[]; followed: string[]; playlists: ServerPlaylist[]; history?: HistoryRow[] }) => void;
  clearAccountData: () => void;
};

/**
 * Writing to your library needs an account; listening never does.
 */
function signedInFor(label: string, run: () => void): boolean {
  if (isSignedIn()) return true;
  useUi.getState().requestAuth({ label, run });
  return false;
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      liked: [],
      likedCollections: [],
      followedArtists: [],
      playlists: [],
      history: [],
      tasbih: { id: DHIKR[0]!.id, count: 0 },
      settings: { ...DEFAULT_SETTINGS },
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
            set((s) => ({ liked: res.liked ? (s.liked.includes(id) ? s.liked : [...s.liked, id]) : s.liked.filter((x) => x !== id) }));
          })
          .catch((err) => {
            set({ liked: before, lastError: errorMessage(err, "Could not reach the server.") });
          })
          .finally(() => set({ syncing: false }));
        return !now;
      },

      isLiked: (id) => get().liked.includes(id),

      toggleCollection: (id) => {
        if (!signedInFor("Sign in to save sets to your library", () => get().toggleCollection(id))) return null;
        const has = get().likedCollections.includes(id);
        set({ likedCollections: has ? get().likedCollections.filter((x) => x !== id) : [...get().likedCollections, id] });
        return !has;
      },

      toggleArtist: (id) => {
        if (!signedInFor("Sign in to follow reciters", () => get().toggleArtist(id))) return null;
        const before = get().followedArtists;
        const has = before.includes(id);
        set({ followedArtists: has ? before.filter((x) => x !== id) : [...before, id], syncing: true });
        void api
          .follow(id)
          .then((res) => {
            set((s) => ({
              followedArtists: res.following
                ? s.followedArtists.includes(id)
                  ? s.followedArtists
                  : [...s.followedArtists, id]
                : s.followedArtists.filter((x) => x !== id),
            }));
          })
          .catch((err) => set({ followedArtists: before, lastError: errorMessage(err, "Could not reach the server.") }))
          .finally(() => set({ syncing: false }));
        return !has;
      },

      async createPlaylist(name, trackIds = [], blurb) {
        if (!signedInFor("Sign in to build playlists", () => void get().createPlaylist(name, trackIds, blurb))) return null;
        const clean = name.trim();
        if (!clean) return null;
        const ids = trackIds.filter((id, i, arr) => arr.indexOf(id) === i);
        set({ syncing: true });
        try {
          const created = await api.createPlaylist({ name: clean, blurb, songIds: ids });
          const playlist = fromServer(created);
          set((s) => ({ playlists: [playlist, ...s.playlists.filter((p) => p.id !== playlist.id)], syncing: false, lastError: null }));
          return playlist;
        } catch (err) {
          set({ syncing: false, lastError: errorMessage(err, "Could not create that set.") });
          return null;
        }
      },

      deletePlaylist: (id) => {
        if (!signedInFor("Sign in to change your playlists", () => get().deletePlaylist(id))) return;
        const before = get().playlists;
        set({ playlists: before.filter((p) => p.id !== id), syncing: true });
        void api
          .deletePlaylist(id)
          .catch((err) => set({ playlists: before, lastError: errorMessage(err, "Could not delete that set.") }))
          .finally(() => set({ syncing: false }));
      },

      renamePlaylist: (id, name) => {
        if (!signedInFor("Sign in to change your playlists", () => get().renamePlaylist(id, name))) return;
        const before = get().playlists;
        set({ playlists: before.map((p) => (p.id === id ? { ...p, name } : p)), syncing: true });
        void api
          .updatePlaylist(id, { name })
          .catch((err) => set({ playlists: before, lastError: errorMessage(err, "Could not rename that set.") }))
          .finally(() => set({ syncing: false }));
      },

      addToPlaylist: (playlistId, trackId) => {
        if (!signedInFor("Sign in to add this to a playlist", () => get().addToPlaylist(playlistId, trackId))) return null;
        const playlist = get().playlists.find((p) => p.id === playlistId);
        if (!playlist) return false;
        if (playlist.trackIds.includes(trackId)) return false;
        const before = get().playlists;
        set({ playlists: before.map((p) => (p.id === playlistId ? { ...p, trackIds: [...p.trackIds, trackId] } : p)), syncing: true });
        void api
          .playlistSong(playlistId, trackId)
          .catch((err) => set({ playlists: before, lastError: errorMessage(err, "Could not add that.") }))
          .finally(() => set({ syncing: false }));
        return true;
      },

      removeFromPlaylist: (playlistId, trackId) => {
        if (!signedInFor("Sign in to change your playlists", () => get().removeFromPlaylist(playlistId, trackId))) return;
        const before = get().playlists;
        set({ playlists: before.map((p) => (p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((t) => t !== trackId) } : p)), syncing: true });
        void api
          .playlistSong(playlistId, trackId, true)
          .catch((err) => set({ playlists: before, lastError: errorMessage(err, "Could not remove that.") }))
          .finally(() => set({ syncing: false }));
      },

      movePlaylistTrack: (playlistId, from, to) => {
        if (!signedInFor("Sign in to change your playlists", () => get().movePlaylistTrack(playlistId, from, to))) return;
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
        const prev = get().history.find((h) => h.id === id);
        const history = get().history.filter((h) => h.id !== id);
        history.unshift({ id, at: now, count: (prev?.count ?? 0) + 1 });
        set({ history: history.slice(0, 60) });
      },

      clearHistory: () => set({ history: [] }),

      setSetting: (key, value) => set({ settings: { ...get().settings, [key]: value } }),

      tasbihTick: () => {
        const count = get().tasbih.count + 1;
        set({ tasbih: { ...get().tasbih, count } });
        return count;
      },

      tasbihReset: () => set({ tasbih: { ...get().tasbih, count: 0 } }),

      tasbihSet: (id) => set({ tasbih: { id, count: 0 } }),

      async loadFromServer() {
        if (!isSignedIn()) return;
        set({ syncing: true });
        try {
          const [liked, followed, playlists, history] = await Promise.all([
            api.likedIds(),
            api.followedIds(),
            api.playlists(),
            api.history(40),
          ]);
          set({
            liked: liked.songIds,
            followedArtists: followed.artistIds,
            playlists: playlists.map(fromServer),
            history: mergeHistory(history, get().history),
            syncing: false,
            lastError: null,
          });
        } catch (err) {
          set({ syncing: false, lastError: errorMessage(err, "Could not load your library.") });
        }
      },

      applyBootstrap: ({ liked, followed, playlists, history }) => {
        set({
          liked,
          followedArtists: followed,
          playlists: playlists.map(fromServer),
          history: history ? mergeHistory(history, get().history) : get().history,
          lastError: null,
        });
      },

      clearAccountData: () => set({ liked: [], followedArtists: [], playlists: [] }),
    }),
    {
      name: "coolnasheed:library:v2",
      storage: createJSONStorage(() => localStorage),
      // only what genuinely belongs to this device: settings, the tasbīḥ, the local
      // history mirror and saved shelves. Loves, follows and sets come from the server.
      partialize: (s) => ({
        likedCollections: s.likedCollections,
        history: s.history,
        tasbih: s.tasbih,
        settings: s.settings,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LibraryState>;
        return {
          ...current,
          ...p,
          liked: current.liked,
          followedArtists: current.followedArtists,
          playlists: current.playlists,
          settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
        };
      },
    },
  ),
);

/** Server history is authoritative; the local mirror fills in what has not synced yet. */
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

/** The anonymous device id, so a signed-out listener still gets their own history. */
export { deviceId };

export function accentFor(name: string): Accent {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length]!;
}
