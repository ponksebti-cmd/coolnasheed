import { TRACKS as SHIPPED_TRACKS } from "./tracks";
import type { Artist, Collection, Mood, Track } from "./types";
import { hashString, mulberry32 } from "../lib/prng";
import { artworkUrl, audioUrl } from "../lib/supabase";
import { songFor } from "../lib/song";
import type { ArtistCard, CatalogCollection, Song } from "../../shared/types";

/**
 * The live tables.
 *
 * They start out as the catalogue bundled with the client and are replaced *in place*
 * by `hydrateCatalog()` the moment the server answers, so every reader in the app —
 * shelves, search, the player, Nūr — sees what the database has without knowing or
 * caring where it came from. In-place mutation (rather than reassigning) is what keeps
 * the dozen modules that import these arrays working, and it is why an offline visit
 * still shows the shipped catalogue instead of an empty room.
 */
export const TRACKS: Track[] = [...SHIPPED_TRACKS];

export const ARTISTS: Artist[] = [
  {
    id: "yusuf",
    name: "Yusuf Karim",
    nameAr: "يوسف كريم",
    role: "voice, no instruments",
    origin: "Madinah → Istanbul",
    bio: "Refuses the drum on principle and the reverb on principle too. Records at 4am in a tiled hallway because 'the walls already know the maqām'. Twelve releases, all of them quiet.",
    seed: "yusuf-karim",
    accent: "jade",
    verified: true,
  },
  {
    id: "rawda",
    name: "Al-Rawḍa Ensemble",
    nameAr: "فرقة الروضة",
    role: "seven voices & duff",
    origin: "Cairo",
    bio: "A Cairo gathering that turned into an ensemble in 1998 and never quite stopped. Three generations of singers, one frame drum older than two of them, and a standing rule: whoever arrives first leads.",
    seed: "rawda-ensemble",
    accent: "gold",
    verified: true,
  },
  {
    id: "hanan",
    name: "Hanan Siddiqui",
    nameAr: "حنان صديقي",
    role: "voice & duff",
    origin: "Birmingham → Amman",
    bio: "Sings for women's gatherings and for the last third of the night. Known for Ṣabā — the maqām of tears — and for stopping mid-phrase when the room gets too loud.",
    seed: "hanan-siddiqui",
    accent: "madder",
    verified: true,
  },
  {
    id: "muadh",
    name: "Muʿādh & the Night Choir",
    nameAr: "معاذ وكورال الليل",
    role: "choir & frame drum",
    origin: "Kuala Lumpur",
    bio: "Twelve singers who only meet after ʿIshāʾ. They record standing in a circle, once, no edits, and whatever the room does that night is on the record.",
    seed: "muadh-night-choir",
    accent: "cobalt",
  },
  {
    id: "ibrahim",
    name: "Ibrahim Folarin",
    nameAr: "إبراهيم فولارين",
    role: "voice, claps & duff",
    origin: "Sokoto → Lagos",
    bio: "Carries the West African qaṣīda tradition into the street: call-and-response, hand claps behind the beat, and a drum that is allowed to be happy.",
    seed: "ibrahim-folarin",
    accent: "madder",
  },
  {
    id: "halabi",
    name: "ʿAbdurraḥmān al-Ḥalabī",
    nameAr: "عبد الرحمن الحلبي",
    role: "voice & qaṣīda",
    origin: "Aleppo → Konya",
    bio: "Sings the Burda the way Aleppo still teaches it, quarter tones intact. Will not use a metronome; says the phrase knows its own length.",
    seed: "halabi-qasida",
    accent: "gold",
    verified: true,
  },
  {
    id: "sami",
    name: "Sami Deen",
    nameAr: "سامي دين",
    role: "voice & loops",
    origin: "Toronto",
    bio: "Makes minimal devotional music in a basement with one microphone. Writes his own words. Believes a nasheed should be able to survive being whispered.",
    seed: "sami-deen",
    accent: "jade",
  },
  {
    id: "zayd",
    name: "Zayd Amīn",
    nameAr: "زيد أمين",
    role: "voice & story",
    origin: "Sarajevo",
    bio: "Storyteller first, singer second. His tracks are long, they have plots, and they always end somewhere quieter than they started.",
    seed: "zayd-amin",
    accent: "turq",
  },
];

export const COLLECTIONS: Collection[] = [
  {
    id: "nur",
    kind: "album",
    title: "Nūr — Vocals of Light",
    titleAr: "نور",
    curator: "CoolNasheed Originals",
    blurb:
      "The house compilation: eight tracks chosen because they all sound like a lit room. Mostly voices, almost no drum, a lot of Ḥijāz.",
    seed: "nur-compilation",
    accent: "gold",
    tags: ["featured", "light", "vocals"],
    year: 2024,
    trackIds: [
      "talaa-al-badru",
      "ya-nabi-salam",
      "mawlaya-salli",
      "nur-ala-nur",
      "asma-al-husna",
      "city-of-fajr",
      "letters-to-madinah",
      "the-night-journey",
      "dust-and-light",
      "laylat-al-qadr",
    ],
  },
  {
    id: "ramadan-nights",
    kind: "mukhtarat",
    title: "Ramadan Nights",
    titleAr: "ليالي رمضان",
    curator: "Hanan Siddiqui",
    blurb: "Tarāwīḥ to suḥūr. Slow things for full stomachs and empty streets.",
    seed: "ramadan-nights",
    accent: "cobalt",
    tags: ["ramadan", "night", "tarawih"],
    year: 2025,
    trackIds: ["ramadan-ya-nur", "laylat-al-qadr", "astaghfirullah", "sakina", "subhanallah-bihamdihi", "qad-jaakum-rasul", "before-the-dawn"],
  },
  {
    id: "salawat",
    kind: "mukhtarat",
    title: "Ṣalawāt — Blessings Upon Him ﷺ",
    titleAr: "صلوات",
    curator: "CoolNasheed Editorial",
    blurb: "Greetings, salāms and qaṣīdas in praise of the Prophet ﷺ, from Cairo to Sarajevo.",
    seed: "salawat-set",
    accent: "jade",
    tags: ["salawat", "praise", "madinah"],
    year: 2024,
    trackIds: ["ya-nabi-salam", "mawlaya-salli", "allahumma-salli", "ya-habib-al-qalb", "qad-jaakum-rasul", "letters-to-madinah", "burda-dhi-salam"],
  },
  {
    id: "sakina",
    kind: "mukhtarat",
    title: "Sakīna — Stillness & Sleep",
    titleAr: "سكينة",
    curator: "CoolNasheed Editorial",
    blurb: "Under 70 beats a minute, no surprises. For the anxious heart, the long night, and the child who will not settle.",
    seed: "sakina-calm",
    accent: "turq",
    tags: ["calm", "sleep", "stillness"],
    year: 2025,
    trackIds: ["sakina", "asma-al-husna", "nur-ala-nur", "laylat-al-qadr", "ya-rabb", "before-the-dawn", "dust-and-light", "astaghfirullah", "burda-dhi-salam"],
  },
  {
    id: "dhikr-dawn",
    kind: "mukhtarat",
    title: "Dhikr at Dawn",
    titleAr: "ذكر الفجر",
    curator: "Muʿādh & the Night Choir",
    blurb: "Repetition as a technology: tasbīḥ, tahlīl and istiġhfār set to a pulse you can keep while you work.",
    seed: "dhikr-dawn",
    accent: "gold",
    tags: ["dhikr", "morning", "focus"],
    year: 2024,
    trackIds: ["subhanallah-bihamdihi", "la-ilaha-illa-allah", "astaghfirullah", "alhamdulillah", "allahu-akbar-kabira", "city-of-fajr", "before-the-dawn", "asma-al-husna"],
  },
  {
    id: "qasida",
    kind: "mukhtarat",
    title: "Qaṣīda Classics",
    titleAr: "قصائد",
    curator: "ʿAbdurraḥmān al-Ḥalabī",
    blurb: "The long poems: al-Burda, the welcome songs, and the meters people memorised before they could read them.",
    seed: "qasida-classics",
    accent: "madder",
    tags: ["classical", "poetry", "arabic"],
    year: 2023,
    trackIds: ["burda-dhi-salam", "mawlaya-salli", "talaa-al-badru", "the-night-journey", "allahumma-salli"],
  },
  {
    id: "eid",
    kind: "mukhtarat",
    title: "ʿĪd Mubārak",
    titleAr: "عيد مبارك",
    curator: "Ibrahim Folarin",
    blurb: "Fast, loud, allowed to be happy. The drum does most of the talking.",
    seed: "eid-mubarak-set",
    accent: "jade",
    tags: ["eid", "celebration", "duff"],
    year: 2025,
    trackIds: ["eid-mubarak", "allahu-akbar-kabira", "talaa-al-badru", "ramadan-ya-nur", "alhamdulillah"],
  },
  {
    id: "ayat",
    kind: "mukhtarat",
    title: "Āyāt — Qurʾān Set to Voice",
    titleAr: "آيات",
    curator: "CoolNasheed Editorial",
    blurb: "Recitation-adjacent settings of Qurʾānic text, sung in maqām. Translations are renderings of meaning, not scripture.",
    seed: "ayat-quran",
    accent: "turq",
    tags: ["quran", "ayat", "reflection"],
    year: 2024,
    trackIds: ["nur-ala-nur", "qad-jaakum-rasul", "laylat-al-qadr", "the-night-journey"],
  },
  {
    id: "welcome",
    kind: "mukhtarat",
    title: "Ṭalaʿa al-Badru — Songs of Welcome",
    titleAr: "طلع البدر",
    curator: "Al-Rawḍa Ensemble",
    blurb: "Every greeting in the catalogue: the moon over Madinah, the takbīr, the ʿĪd salām, the letter posted to a city you have not seen.",
    seed: "welcome-songs",
    accent: "gold",
    tags: ["welcome", "madinah", "gathering"],
    year: 2023,
    trackIds: ["talaa-al-badru", "la-ilaha-illa-allah", "eid-mubarak", "allahu-akbar-kabira", "alhamdulillah"],
  },
];

export const MOODS: Mood[] = [
  { id: "still", label: "Stillness", labelAr: "سكينة", blurb: "under 70 bpm, no drum, room to breathe", accent: "turq", seed: "mood-still", match: (t) => t.bpm <= 70 || t.tags.includes("stillness") },
  { id: "longing", label: "Longing", labelAr: "شوق", blurb: "Ḥijāz, Bayātī and the space between", accent: "madder", seed: "mood-longing", match: (t) => ["hijaz", "bayati", "saba", "kurd"].includes(t.maqam) || t.tags.includes("longing") },
  { id: "praise", label: "Praise", labelAr: "مدح", blurb: "ṣalawāt and salāms upon the Prophet ﷺ", accent: "jade", seed: "mood-praise", match: (t) => t.tags.includes("salawat") || t.tags.includes("praise") },
  { id: "dawn", label: "Dawn", labelAr: "فجر", blurb: "for the hour before Fajr", accent: "cobalt", seed: "mood-dawn", match: (t) => t.tags.includes("dawn") || t.tags.includes("morning") },
  { id: "night", label: "Night", labelAr: "ليل", blurb: "last third of it, mostly", accent: "cobalt", seed: "mood-night", match: (t) => t.tags.includes("night") || t.tags.includes("sleep") },
  { id: "celebration", label: "Celebration", labelAr: "فرح", blurb: "ʿĪd energy, drum forward", accent: "gold", seed: "mood-celebration", match: (t) => t.tags.includes("celebration") || t.tags.includes("eid") },
  { id: "dhikr", label: "Dhikr", labelAr: "ذكر", blurb: "repetition as a technology", accent: "jade", seed: "mood-dhikr", match: (t) => t.tags.includes("dhikr") },
  { id: "quran", label: "Āyāt", labelAr: "آيات", blurb: "Qurʾānic text set to voice", accent: "turq", seed: "mood-quran", match: (t) => t.tags.includes("quran") },
];

/* ------------------------------------------------------------ derived data */

const trackById = new Map(TRACKS.map((t) => [t.id, t]));
const artistById = new Map(ARTISTS.map((a) => [a.id, a]));
const collectionById = new Map(COLLECTIONS.map((c) => [c.id, c]));

function reindex(): void {
  trackById.clear();
  TRACKS.forEach((t) => trackById.set(t.id, t));
  artistById.clear();
  ARTISTS.forEach((a) => artistById.set(a.id, a));
  collectionById.clear();
  COLLECTIONS.forEach((c) => collectionById.set(c.id, c));
}

/* ------------------------------------------------------- server hydration

   Song → Track, ArtistCard → Artist, CatalogCollection → Collection. The server owns
   the truth about what exists; these mappers are the only place that knows the two
   vocabularies are different. */

export function trackFromSong(song: Song): Track {
  return {
    id: song.id,
    title: song.title,
    titleAr: song.titleAr ?? undefined,
    // the catalogue keys its publishers by handle, which is what a URL carries
    artistId: song.ownerHandle ?? song.ownerId ?? "",
    collections: [],
    tags: song.tags,
    maqam: song.maqam,
    root: song.root,
    bpm: song.bpm,
    voices: song.voices,
    duff: song.duff ?? undefined,
    duffEnter: song.duffEnter,
    passes: song.passes,
    motifBank: song.motifBank ?? undefined,
    blurb: song.note,
    year: song.year ?? new Date(song.publishedAt).getFullYear(),
    seed: `${song.id}-${song.maqam}`,
    accent: song.accent,
    lines: song.lines.map((l) => ({ ...l })),
    ownerId: song.ownerId,
    audioUrl: audioUrl(song.audioPath),
    artworkUrl: artworkUrl(song.artworkPath),
    durationMs: song.durationMs ?? null,
    stats: { plays: song.plays, likes: song.likes, notes: song.notes },
    status: song.status,
    publishedAt: song.publishedAt,
  };
}

export function artistFromCard(card: ArtistCard): Artist {
  return {
    id: card.id,
    name: card.name,
    nameAr: card.nameAr ?? undefined,
    role: card.role,
    origin: card.origin,
    bio: card.bio,
    seed: card.seed,
    accent: card.accent,
    verified: card.verified,
  };
}

export function collectionFromServer(collection: CatalogCollection): Collection {
  return {
    id: collection.id,
    kind: collection.kind,
    title: collection.title,
    titleAr: collection.titleAr ?? undefined,
    curator: collection.curator,
    blurb: collection.blurb,
    seed: collection.seed,
    accent: collection.accent,
    tags: collection.tags,
    year: collection.year,
    trackIds: collection.songIds,
  };
}

let serverCatalogAt = 0;

/**
 * Replace the in-memory catalogue with what the server sent.
 * Returns the number of nasheeds it now holds, so the boot log can say what happened.
 */
export function hydrateCatalog(payload: { artists: ArtistCard[]; songs: Song[]; collections: CatalogCollection[] }): number {
  const artists = payload.artists.map(artistFromCard);
  const tracks = payload.songs.map(trackFromSong);

  ARTISTS.length = 0;
  ARTISTS.push(...artists);
  TRACKS.length = 0;
  TRACKS.push(...tracks);
  COLLECTIONS.length = 0;
  COLLECTIONS.push(...payload.collections.map(collectionFromServer));

  // a track's collections are the ones that list it
  for (const track of TRACKS) {
    track.collections = COLLECTIONS.filter((c) => c.trackIds.includes(track.id)).map((c) => c.id);
  }

  serverCatalogAt = Date.now();
  registryVersion++;
  reindex();
  return TRACKS.length;
}

/** Swap in (or update) a single nasheed — used right after publishing or editing. */
export function applySong(song: Song): Track {
  const track = trackFromSong(song);
  const index = TRACKS.findIndex((t) => t.id === track.id);
  if (index >= 0) TRACKS[index] = track;
  else TRACKS.push(track);
  track.collections = COLLECTIONS.filter((c) => c.trackIds.includes(track.id)).map((c) => c.id);
  registryVersion++;
  reindex();
  return track;
}

/** Drop a nasheed that was taken down or deleted. */
export function forgetSong(id: string): void {
  const index = TRACKS.findIndex((t) => t.id === id);
  if (index >= 0) TRACKS.splice(index, 1);
  registryVersion++;
  reindex();
}

/** When the catalogue last came from the server; 0 means it never did. */
export function catalogSyncedAt(): number {
  return serverCatalogAt;
}

export function isFromServer(track: Track | undefined): boolean {
  return !!track?.stats;
}

/* ------------------------------------------------------ published by listeners

   The shipped catalogue is static, but an account can publish a nasheed. Those
   live in localStorage and are registered here, so every reader — the track page,
   search, the player, artist pages — resolves a published nasheed exactly the way
   it resolves a shipped one. Publishing works at all because a nasheed in this app
   is data: the same composer that sings the catalogue sings what you wrote. */

const publishedTracksById = new Map<string, Track>();
const publishedArtistsById = new Map<string, Artist>();
let registryVersion = 0;

export function registerPublished(tracks: Track[], artists: Artist[]): void {
  publishedTracksById.clear();
  publishedArtistsById.clear();
  tracks.forEach((t) => publishedTracksById.set(t.id, t));
  artists.forEach((a) => publishedArtistsById.set(a.id, a));
  registryVersion++;
}

/** Bumped whenever the registry changes, so memoised lists can invalidate. */
export function catalogVersion(): number {
  return registryVersion;
}

export function isPublished(id: string | null | undefined): boolean {
  return !!id && publishedTracksById.has(id);
}

/** The whole catalogue: shipped nasheeds first, then whatever listeners published. */
export function allTracks(): Track[] {
  return publishedTracksById.size ? [...TRACKS, ...publishedTracksById.values()] : TRACKS;
}

export function allArtists(): Artist[] {
  return publishedArtistsById.size ? [...ARTISTS, ...publishedArtistsById.values()] : ARTISTS;
}

export function publishedTracks(): Track[] {
  return Array.from(publishedTracksById.values());
}

/* The studio's work-in-progress resolves like a track — so you can hear it in the
   real player, with real synced lyrics, before you commit to publishing it — but it
   never appears in a list, a search result or a shelf. */
let previewTrack: Track | null = null;

export function registerPreview(track: Track | null): void {
  previewTrack = track;
  registryVersion++;
}

export function isPreview(id: string | null | undefined): boolean {
  return !!id && previewTrack?.id === id;
}

export function getTrack(id: string | null | undefined): Track | undefined {
  if (!id) return undefined;
  return trackById.get(id) ?? publishedTracksById.get(id) ?? (previewTrack?.id === id ? previewTrack : undefined);
}
export function getArtist(id: string | null | undefined): Artist | undefined {
  if (!id) return undefined;
  return artistById.get(id) ?? publishedArtistsById.get(id);
}
export function getCollection(id: string | null | undefined): Collection | undefined {
  return id ? collectionById.get(id) : undefined;
}

export function artistOf(track: Track): Artist {
  return getArtist(track.artistId) ?? ARTISTS[0]!;
}

export function tracksOf(collection: Collection): Track[] {
  return collection.trackIds.map((id) => trackById.get(id)).filter((t): t is Track => !!t);
}

export function tracksByArtist(artistId: string): Track[] {
  return allTracks().filter((t) => t.artistId === artistId);
}

export function collectionsOf(track: Track): Collection[] {
  return COLLECTIONS.filter((c) => c.trackIds.includes(track.id));
}

export function durationOf(track: Track): number {
  // an uploaded recording has a real length; a synthesized one is computed
  if (track.durationMs && track.durationMs > 0) return track.durationMs / 1000;
  return songFor(track).duration;
}

export function totalDuration(tracks: Track[]): number {
  return tracks.reduce((sum, t) => sum + durationOf(t), 0);
}

/** Stable pseudo-social numbers so the catalogue feels lived-in without lying dynamically. */
export function statsFor(track: Track): { plays: number; likes: number; reposts: number; comments: number } {
  // real counters from the server win over anything generated here
  if (track.stats) {
    return { plays: track.stats.plays, likes: track.stats.likes, reposts: 0, comments: track.stats.notes };
  }
  // a nasheed published five minutes ago has no history to invent
  if (isPublished(track.id)) return { plays: 0, likes: 0, reposts: 0, comments: 0 };
  const rng = mulberry32(hashString(`stats-${track.id}`));
  const recency = 1 + (track.year - 2015) * 0.09;
  const plays = Math.round((180_000 + rng() * 2_400_000) * recency);
  return {
    plays,
    likes: Math.round(plays * (0.035 + rng() * 0.05)),
    reposts: Math.round(plays * (0.006 + rng() * 0.012)),
    comments: Math.round(plays * (0.0012 + rng() * 0.003)),
  };
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `${n}`;
}

export const ALL_TAGS = Array.from(new Set(SHIPPED_TRACKS.flatMap((t) => t.tags))).sort();

/** Every tag in the live catalogue, with how many nasheeds carry it. */
export function tagCounts(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const track of TRACKS) for (const tag of track.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function searchTracks(query: string): Track[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const scored = allTracks().map((track) => {
    const artist = artistOf(track);
    const hay = [
      track.title,
      track.titleAr ?? "",
      track.blurb,
      artist.name,
      artist.nameAr ?? "",
      artist.origin,
      track.maqam,
      track.year.toString(),
      ...track.tags,
      ...track.lines.map((l) => `${l.tr ?? ""} ${l.en ?? ""} ${l.ar ?? ""}`),
    ]
      .join(" ")
      .toLowerCase();
    let score = 0;
    terms.forEach((term) => {
      if (!hay.includes(term)) {
        score -= 10;
        return;
      }
      score += 3;
      if (track.title.toLowerCase().includes(term)) score += 6;
      if (track.title.toLowerCase().startsWith(term)) score += 4;
      if (artist.name.toLowerCase().includes(term)) score += 4;
      if (track.tags.some((t) => t.startsWith(term))) score += 3;
    });
    return { track, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.track);
}

export function searchArtists(query: string): Artist[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return allArtists().filter((a) =>
    `${a.name} ${a.nameAr ?? ""} ${a.origin} ${a.role} ${a.bio}`.toLowerCase().includes(q),
  );
}

export function searchCollections(query: string): Collection[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return COLLECTIONS.filter((c) => `${c.title} ${c.titleAr ?? ""} ${c.blurb} ${c.tags.join(" ")}`.toLowerCase().includes(q));
}

export const CATALOG = {
  tracks: TRACKS,
  artists: ARTISTS,
  collections: COLLECTIONS,
  moods: MOODS,
};

/** Everything, shipped and published — what search and the shelves browse. */
export const LIVE_CATALOG = { allTracks, allArtists, publishedTracks };
