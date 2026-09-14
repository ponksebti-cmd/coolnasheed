import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Accent } from "../data/types";
import type { SpacePreset } from "../lib/audio/engine";
import { hashString, mulberry32 } from "../lib/prng";

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

type LibraryState = {
  liked: string[];
  likedCollections: string[];
  followedArtists: string[];
  playlists: Playlist[];
  history: HistoryEntry[];
  tasbih: { id: string; count: number };
  settings: Settings;

  toggleLike: (id: string) => boolean;
  isLiked: (id: string) => boolean;
  toggleCollection: (id: string) => void;
  toggleArtist: (id: string) => void;
  createPlaylist: (name: string, trackIds?: string[], blurb?: string) => Playlist;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, name: string) => void;
  addToPlaylist: (playlistId: string, trackId: string) => boolean;
  removeFromPlaylist: (playlistId: string, trackId: string) => void;
  movePlaylistTrack: (playlistId: string, from: number, to: number) => void;
  recordPlay: (id: string) => void;
  clearHistory: () => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  tasbihTick: () => number;
  tasbihReset: () => void;
  tasbihSet: (id: string) => void;
};

function seedPlaylist(name: string): Playlist {
  const rng = mulberry32(hashString(name));
  return {
    id: `pl-${Date.now().toString(36)}-${Math.floor(rng() * 1e4).toString(36)}`,
    name,
    blurb: "Your set. Nothing here but what you chose.",
    seed: `playlist-${name}-${Date.now()}`,
    accent: ACCENTS[Math.floor(rng() * ACCENTS.length)]!,
    trackIds: [],
    createdAt: Date.now(),
  };
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

      toggleLike: (id) => {
        const liked = get().liked.includes(id) ? get().liked.filter((x) => x !== id) : [...get().liked, id];
        set({ liked });
        return liked.includes(id);
      },

      isLiked: (id) => get().liked.includes(id),

      toggleCollection: (id) => {
        const has = get().likedCollections.includes(id);
        set({ likedCollections: has ? get().likedCollections.filter((x) => x !== id) : [...get().likedCollections, id] });
      },

      toggleArtist: (id) => {
        const has = get().followedArtists.includes(id);
        set({ followedArtists: has ? get().followedArtists.filter((x) => x !== id) : [...get().followedArtists, id] });
      },

      createPlaylist: (name, trackIds = [], blurb) => {
        const pl = seedPlaylist(name);
        pl.trackIds = trackIds.filter((id, i, arr) => arr.indexOf(id) === i);
        if (blurb) pl.blurb = blurb;
        set({ playlists: [pl, ...get().playlists] });
        return pl;
      },

      deletePlaylist: (id) => set({ playlists: get().playlists.filter((p) => p.id !== id) }),

      renamePlaylist: (id, name) =>
        set({ playlists: get().playlists.map((p) => (p.id === id ? { ...p, name } : p)) }),

      addToPlaylist: (playlistId, trackId) => {
        const pl = get().playlists.find((p) => p.id === playlistId);
        if (!pl || pl.trackIds.includes(trackId)) return false;
        set({
          playlists: get().playlists.map((p) =>
            p.id === playlistId ? { ...p, trackIds: [...p.trackIds, trackId] } : p,
          ),
        });
        return true;
      },

      removeFromPlaylist: (playlistId, trackId) =>
        set({
          playlists: get().playlists.map((p) =>
            p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((t) => t !== trackId) } : p,
          ),
        }),

      movePlaylistTrack: (playlistId, from, to) =>
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== playlistId) return p;
            const next = p.trackIds.slice();
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved!);
            return { ...p, trackIds: next };
          }),
        }),

      recordPlay: (id) => {
        const now = Date.now();
        const history = get().history.filter((h) => h.id !== id);
        const prev = get().history.find((h) => h.id === id);
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
    }),
    {
      name: "coolnasheed:library:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        liked: s.liked,
        likedCollections: s.likedCollections,
        followedArtists: s.followedArtists,
        playlists: s.playlists,
        history: s.history,
        tasbih: s.tasbih,
        settings: s.settings,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LibraryState>;
        return {
          ...current,
          ...p,
          settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
        };
      },
    },
  ),
);
