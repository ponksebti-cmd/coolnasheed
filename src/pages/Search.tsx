import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../components/ui/Icons";
import { Chip, EmptyState, SectionHeader } from "../components/ui/Primitives";
import { ArtistCard, CollectionCard } from "../components/collection/Cards";
import { TrackCardGrid, TrackList } from "../components/track/TrackViews";
import {
  ARTISTS,
  COLLECTIONS,
  TRACKS,
  durationOf,
  searchArtists,
  searchCollections,
  searchTracks,
  statsFor,
  tagCounts,
} from "../data/catalog";
import { useCatalogVersion } from "../lib/hooks";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { hasSupabase } from "../lib/supabase";
import { adoptSongs } from "../data/catalog";
import { plural } from "../lib/format";
import type { Track } from "../data/types";

type Sort = "relevance" | "plays" | "newest" | "longest" | "shortest" | "az";

/** How many nasheeds one page of server search holds. */
const SEARCH_PAGE = 60;

const SORTS: { id: Sort; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "plays", label: "Most played" },
  { id: "newest", label: "Newest" },
  { id: "longest", label: "Longest" },
  { id: "shortest", label: "Shortest" },
  { id: "az", label: "A–Z" },
];

export default function Search() {
  const [params, setParams] = useSearchParams();
  const version = useCatalogVersion();
  const q = params.get("q") ?? "";
  const tagParam = params.get("tag");
  const [sort, setSort] = useState<Sort>("relevance");
  const [view, setView] = useState<"rows" | "grid">("rows");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("coolnasheed:focus-search", focus);
    return () => window.removeEventListener("coolnasheed:focus-search", focus);
  }, []);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const tag = tagParam;
  const tags = useMemo(() => tagCounts(), [version]);
  const suggestions = useMemo(() => tags.slice(0, 9).map((entry) => entry.tag), [tags]);

  /* Searching asks the database, not the window.
   *
   * The catalogue the app boots with is bounded — the newest few hundred nasheeds — so a
   * search that only looked inside it would quietly miss everything older. Typing sends
   * the words to `songs?q=`, which reads the title, the transliteration, the Arabic and
   * the note, and pages through the whole catalogue. The local search stays as the
   * fallback for a project that is not configured or a server that cannot be reached;
   * without a query the page browses what it already has rather than asking for all of
   * it. */
  const [remote, setRemote] = useState<{
    query: string;
    items: Track[];
    next: number | null;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [more, setMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const needle = q.trim();
    if (!needle || !hasSupabase) {
      setRemote(null);
      setSearchError(null);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const page = await api.songs({ q: needle, limit: SEARCH_PAGE });
        if (!live) return;
        adoptSongs(page.items);
        setRemote({ query: needle, items: page.items, next: page.next });
        setSearchError(null);
      } catch (err) {
        if (!live) return;
        setRemote(null);
        setSearchError(errorMessage(err, "Search is not answering."));
      } finally {
        if (live) setSearching(false);
      }
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const loadMore = async () => {
    if (!remote?.next) return;
    setMore(true);
    try {
      const page = await api.songs({
        q: remote.query,
        limit: SEARCH_PAGE,
        offset: remote.next,
      });
      adoptSongs(page.items);
      setRemote({
        query: remote.query,
        items: [...remote.items, ...page.items],
        next: page.next,
      });
    } catch (err) {
      setSearchError(errorMessage(err, "More results would not load."));
    } finally {
      setMore(false);
    }
  };

  const results = useMemo<Track[]>(() => {
    const fromServer = remote && remote.query === q.trim() ? remote.items : null;
    let list = fromServer
      ? fromServer.slice()
      : q.trim()
        ? searchTracks(q)
        : TRACKS.slice();
    if (tag) list = list.filter((track) => track.tags.includes(tag));

    const sorted = list.slice();
    switch (sort) {
      case "plays":
        sorted.sort((a, b) => statsFor(b).plays - statsFor(a).plays);
        break;
      case "newest":
        sorted.sort((a, b) => b.publishedAt - a.publishedAt);
        break;
      case "longest":
        sorted.sort((a, b) => durationOf(b) - durationOf(a));
        break;
      case "shortest":
        sorted.sort((a, b) => durationOf(a) - durationOf(b));
        break;
      case "az":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        break;
    }
    return sorted;
  }, [q, tag, sort, version, remote]);

  const artists = useMemo(() => (q.trim() ? searchArtists(q) : []), [q, version]);
  const collections = useMemo(() => (q.trim() ? searchCollections(q) : []), [q, version]);
  const filtersOn = !!tag;

  return (
    <div className="space-y-8">
      {/* search field */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface/40 p-5 md:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 opacity-[0.14] text-gold">
          <Icon name="starFill" size={224} />
        </div>
        <div className="relative">
          <div className="label mb-2">search</div>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">
              <Icon name="search" size={18} />
            </span>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setParam("q", e.target.value || null)}
              placeholder="A title, a publisher, a tag, or a line of poetry…"
              className="w-full rounded-2xl border border-line2 bg-bg2/70 py-3.5 pl-11 pr-24 text-[15px] text-text outline-none transition-all placeholder:text-muted/80 focus:border-jade/45 focus:shadow-[0_0_0_5px_rgba(var(--c-glow),0.09)]"
              aria-label="Search nasheeds"
            />
            {q ? (
              <button className="btn-icon absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2" onClick={() => setParam("q", null)} aria-label="Clear search">
                <Icon name="close" size={16} />
              </button>
            ) : (
              <span className="absolute right-4 top-1/2 hidden -translate-y-1/2 text-[11px] text-muted sm:block">
                {plural(TRACKS.length, "nasheed")} · {ARTISTS.length} publishers
              </span>
            )}
          </div>

          {tags.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="label mr-1">tag</span>
              {tags.slice(0, 14).map((entry) => (
                <Chip key={entry.tag} active={tag === entry.tag} onClick={() => setParam("tag", tag === entry.tag ? null : entry.tag)}>
                  {entry.tag}
                  <span className="ml-1.5 tabular-nums text-muted">{entry.count}</span>
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* artists + sets when searching */}
      {artists.length ? (
        <Rail2 label="publishers" title={`Publishers matching “${q}”`}>
          {artists.map((a, i) => (
            <div key={a.id} className="w-[168px] shrink-0 sm:w-[190px]">
              <ArtistCard artist={a} index={i} />
            </div>
          ))}
        </Rail2>
      ) : null}

      {collections.length ? (
        <Rail2 label="sets" title={`Sets matching “${q}”`}>
          {collections.map((c, i) => (
            <div key={c.id} className="w-[240px] shrink-0 sm:w-[268px]">
              <CollectionCard collection={c} index={i} />
            </div>
          ))}
        </Rail2>
      ) : null}

      {/* results */}
      <section>
        <SectionHeader
          label={q ? `${results.length} results` : filtersOn ? `${results.length} tagged ${tag}` : "the catalogue"}
          title={q ? `Matching “${q}”` : filtersOn ? `Tagged ${tag}` : TRACKS.length ? "Every nasheed here" : "Nothing published yet"}
          action={
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-1 sm:flex">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSort(s.id)}
                    className={clsx(
                      "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                      sort === s.id ? "bg-jade/15 text-jadesoft" : "text-muted hover:text-text2",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-0.5 rounded-full border border-line bg-surface2/60 p-0.5">
                <button
                  className={clsx("btn-icon rounded-full p-1.5", view === "rows" ? "text-jade" : "text-muted")}
                  onClick={() => setView("rows")}
                  aria-label="List view"
                >
                  <Icon name="rows" size={15} />
                </button>
                <button
                  className={clsx("btn-icon rounded-full p-1.5", view === "grid" ? "text-jade" : "text-muted")}
                  onClick={() => setView("grid")}
                  aria-label="Grid view"
                >
                  <Icon name="grid" size={15} />
                </button>
              </div>
            </div>
          }
        />

        {searching && !results.length ? (
          <div className="panel flex items-center gap-3 rounded-2xl px-4 py-6 text-sm text-muted">
            <Icon name="search" size={16} className="text-jade" />
            Searching every nasheed…
          </div>
        ) : null}

        {searchError && !results.length ? (
          <EmptyState
            icon="cloudOff"
            title="Search is not answering"
            msg={`${searchError} The catalogue you already have is still browsable — clear the box to see it.`}
          />
        ) : null}

        {TRACKS.length === 0 ? (
          <EmptyState
            icon="cloudOff"
            title="The catalogue is empty"
            msg="Nothing has been published yet. When a reciter uploads an mp3 it appears here — there is no demo catalogue behind this."
            action={
              <Link to="/studio" className="btn btn-primary mt-2 !px-4 !py-2.5">
                <Icon name="upload" size={14} /> Publish the first one
              </Link>
            }
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon="search"
            title="Nothing matched that"
            msg={filtersOn ? "Nothing carries that tag yet." : "Try a title, a publisher's name, or one of these."}
            action={
              suggestions.length ? (
                <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                  {suggestions.map((s) => (
                    <button key={s} className="chip hover:border-line2 hover:text-text" onClick={() => setParam("q", s)}>
                      {s}
                    </button>
                  ))}
                </div>
              ) : undefined
            }
          />
        ) : view === "rows" ? (
          <div className="panel rounded-2xl p-2 sm:p-3">
            <TrackList tracks={results} showHeader context={{ kind: "search", label: q ? `Search · ${q}` : tag ? `Tag · ${tag}` : "Catalogue" }} />
          </div>
        ) : (
          <TrackCardGrid tracks={results} context={{ kind: "search", label: q ? `Search · ${q}` : "Catalogue" }} />
        )}
      </section>

      {!q && !filtersOn && COLLECTIONS.length ? (
        <section>
          <SectionHeader label="or start here" title="Sets, if you would rather not choose" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {COLLECTIONS.slice(0, 8).map((c, i) => (
              <CollectionCard key={c.id} collection={c} index={i} />
            ))}
          </div>
        </section>
      ) : null}

      {results.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
          <Icon name="waveform" size={13} />
          <span>
            {plural(results.length, "nasheed")} · {plural(results.reduce((sum, t) => sum + Math.round(durationOf(t) / 60), 0), "minute")} of
            singing
            {results.some((t) => t.lines.some((l) => typeof l.t === "number"))
              ? ` · ${results.filter((t) => t.lines.some((l) => typeof l.t === "number")).length} with timed lyrics`
              : ""}
          </span>
          {remote?.next ? (
            <button
              className="btn btn-ghost !px-3 !py-1.5"
              onClick={() => void loadMore()}
              disabled={more}
            >
              {more ? "Loading…" : "More results"}
            </button>
          ) : null}
          <Link to="/about" className="ml-auto font-semibold text-jade hover:underline underline-offset-2">
            How the catalogue works
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Rail2({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <section>
      <SectionHeader label={label} title={title} />
      <div className="no-bar -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">{children}</div>
    </section>
  );
}
