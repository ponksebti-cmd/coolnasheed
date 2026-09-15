import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../components/ui/Icons";
import { Chip, EmptyState, SectionHeader } from "../components/ui/Primitives";
import { ArtistCard, CollectionCard } from "../components/collection/Cards";
import { TrackCardGrid, TrackList } from "../components/track/TrackViews";
import { ARTISTS, COLLECTIONS, TRACKS, durationOf, searchArtists, searchCollections, searchTracks, statsFor, tagCounts } from "../data/catalog";
import { MAQAM_NAMES, maqamLabel } from "../lib/theory";
import { plural } from "../lib/format";
import type { Track } from "../data/types";

type Sort = "relevance" | "plays" | "longest" | "shortest" | "az";

const SORTS: { id: Sort; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "plays", label: "Most played" },
  { id: "longest", label: "Longest" },
  { id: "shortest", label: "Shortest" },
  { id: "az", label: "A–Z" },
];

const SUGGESTIONS = ["Ḥijāz", "Ramadan", "dhikr", "Madinah", "Qurʾān", "Cairo", "sleep"];

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [maqam, setMaqam] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("relevance");
  const [view, setView] = useState<"rows" | "grid">("rows");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("coolnasheed:focus-search", focus);
    return () => window.removeEventListener("coolnasheed:focus-search", focus);
  }, []);

  const setQ = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    setParams(next, { replace: true });
  };

  const results = useMemo<Track[]>(() => {
    let list = q.trim() ? searchTracks(q) : TRACKS.slice();

    if (maqam) list = list.filter((t) => t.maqam === maqam);
    if (tag) list = list.filter((t) => t.tags.includes(tag));

    const sorted = list.slice();
    switch (sort) {
      case "plays":
        sorted.sort((a, b) => statsFor(b).plays - statsFor(a).plays);
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
  }, [q, maqam, tag, sort]);

  const artists = useMemo(() => (q.trim() ? searchArtists(q) : []), [q]);
  const collections = useMemo(() => (q.trim() ? searchCollections(q) : []), [q]);
  const filtersOn = !!maqam || !!tag;

  return (
    <div className="space-y-8">
      {/* search field */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface/40 p-5 md:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 opacity-[0.14]">
          <svg viewBox="0 0 100 100" className="h-full w-full animate-spinslow" aria-hidden>
            <path
              d="M50 6 60 30 86 24 74 48 96 62 70 68 74 94 50 78 26 94 30 68 4 62 26 48 14 24 40 30Z"
              fill="none"
              stroke="var(--c-gold)"
              strokeWidth="0.8"
            />
          </svg>
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
              onChange={(e) => setQ(e.target.value)}
              placeholder="A title, a reciter, a maqām, a city, or a line of poetry…"
              className="w-full rounded-2xl border border-line2 bg-bg2/70 py-3.5 pl-11 pr-24 text-[15px] text-text outline-none transition-all placeholder:text-muted/80 focus:border-jade/45 focus:shadow-[0_0_0_5px_rgba(var(--c-glow),0.09)]"
              aria-label="Search nasheeds"
            />
            {q ? (
              <button className="btn-icon absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2" onClick={() => setQ("")} aria-label="Clear search">
                <Icon name="close" size={16} />
              </button>
            ) : (
              <span className="absolute right-4 top-1/2 hidden -translate-y-1/2 text-[11px] text-muted sm:block">
                {plural(TRACKS.length, "nasheed")} · {ARTISTS.length} reciters
              </span>
            )}
          </div>

          {/* filters */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">maqām</span>
            {MAQAM_NAMES.map((m) => (
              <Chip key={m} active={maqam === m} onClick={() => setMaqam(maqam === m ? null : m)}>
                {maqamLabel(m)}
              </Chip>
            ))}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">tag</span>
            {tagCounts()
              .slice(0, 14)
              .map(({ tag: t }) => (
              <Chip key={t} active={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                {t}
              </Chip>
            ))}
          </div>
        </div>
      </section>

      {/* artists + collections when searching */}
      {artists.length ? (
        <Rail2 label="reciters" title={`Voices matching “${q}”`}>
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
          label={q ? `${results.length} results` : filtersOn ? `${results.length} filtered` : "the catalogue"}
          title={q ? `Matching “${q}”` : "Every nasheed we have"}
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

        {results.length === 0 ? (
          <EmptyState
            icon="search"
            title="Nothing matched that"
            msg="The catalogue is small and honest. Try a maqām, a mood, or one of these."
            action={
              <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip hover:border-line2 hover:text-text" onClick={() => setQ(s)}>
                    {s}
                  </button>
                ))}
              </div>
            }
          />
        ) : view === "rows" ? (
          <div className="panel rounded-2xl p-2 sm:p-3">
            <TrackList
              tracks={results}
              showHeader
              context={{ kind: "search", label: q ? `Search · ${q}` : "Catalogue" }}
            />
          </div>
        ) : (
          <TrackCardGrid tracks={results} context={{ kind: "search", label: q ? `Search · ${q}` : "Catalogue" }} />
        )}
      </section>

      {!q && !filtersOn ? (
        <section>
          <SectionHeader label="or start here" title="Sets, if you would rather not choose" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {COLLECTIONS.slice(0, 8).map((c, i) => (
              <CollectionCard key={c.id} collection={c} index={i} />
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <Icon name="info" size={13} />
            <span>Every nasheed here was published by an account and is credited to it.</span>
            <Link to="/about" className="font-semibold text-jade hover:underline underline-offset-2">
              Read the whole note
            </Link>
          </div>
        </section>
      ) : null}

      {results.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
          <Icon name="waveform" size={13} />
          <span>
            {results.length} tracks · {plural(results.reduce((s, t) => s + Math.round(durationOf(t) / 60), 0), "minute")} of listening
            {results.some((t) => t.lines.some((l) => l.note?.startsWith("Qurʾān"))) ? " · includes Qurʾānic lines" : ""}
          </span>
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
