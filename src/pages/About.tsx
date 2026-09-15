import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/ui/Icons";
import { PatternArt, StarMark } from "../components/art/PatternArt";
import { Chip, EmptyState, Reveal, SectionHeader } from "../components/ui/Primitives";
import { ARTISTS, COLLECTIONS, TRACKS, durationOf, formatCount, statsFor } from "../data/catalog";
import { MAQAMAT, MAQAM_NAMES, maqamLabel } from "../lib/theory";
import { plural } from "../lib/format";
import type { MaqamName } from "../lib/theory";

const FLOW: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "lyrics",
    title: "1 · The words",
    body: "A nasheed starts as lines: transliteration, Arabic, and a rendering of the meaning in English. A publisher may set the second each line starts.",
  },
  {
    icon: "waveform",
    title: "2 · The recording",
    body: "The audio is uploaded straight from the browser to Supabase Storage with the uploader's own token — no function, no proxy, no size limit but the bucket's.",
  },
  {
    icon: "library",
    title: "3 · The row",
    body: "Publishing writes one row in Postgres: title, maqām, tags, lyrics, the storage paths and the length. Access is decided by Row Level Security, not by app code.",
  },
  {
    icon: "play",
    title: "4 · Streaming it back",
    body: "The browser plays the file from Storage with range support, so seeking works. The maqām and the words are metadata beside it, not instructions to a synthesiser.",
  },
  {
    icon: "clock",
    title: "5 · The words follow",
    body: "Where the publisher set timings, the lyric view reads them. Where they did not, the lines are spread evenly across the recording.",
  },
  {
    icon: "trending",
    title: "6 · Counted",
    body: "A play is one row per listen, rolled up per nasheed and per day. Charts read the rollups; the raw events are pruned after ninety days.",
  },
];

export default function About() {
  const totals = useMemo(
    () => ({
      lines: TRACKS.reduce((s, t) => s + t.lines.length, 0),
      minutes: Math.round(TRACKS.reduce((s, t) => s + durationOf(t), 0) / 60),
      plays: TRACKS.reduce((s, t) => s + statsFor(t).plays, 0),
    }),
    [],
  );

  const maqamUse = useMemo(
    () =>
      MAQAM_NAMES.map((m) => ({
        m,
        count: TRACKS.filter((t) => t.maqam === m).length,
        tracks: TRACKS.filter((t) => t.maqam === m).slice(0, 2),
      })).filter((x) => x.count > 0),
    [],
  );

  const traditional = TRACKS.filter((t) => t.lines.some((l) => l.note === "traditional" || l.note === "al-Burda" || l.note === "al-Būṣīrī, d. 1294")).length;
  const quranic = TRACKS.filter((t) => t.lines.some((l) => l.note?.startsWith("Qurʾān"))).length;
  const original = TRACKS.filter((t) => t.lines.some((l) => l.note === "original")).length;

  return (
    <div className="space-y-12 pb-4">
      {/* header */}
      <section className="relative overflow-hidden rounded-3xl border border-line">
        <div className="absolute inset-0 opacity-70">
          <PatternArt seed="about-hero" motif="rosette" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(4,11,9,0.96)] via-[rgba(4,11,9,0.86)] to-[rgba(4,11,9,0.55)]" />
        <div className="grain absolute inset-0" />
        <div className="relative flex flex-col items-start gap-5 p-6 md:p-10">
          <span className="grid h-14 w-14 place-items-center rounded-xl border border-line2 bg-elev/70 backdrop-blur">
            <StarMark size={34} />
          </span>
          <div>
            <div className="label mb-2">about</div>
            <h1 className="max-w-[18ch] text-[2.1rem] leading-[0.98] text-text md:text-[3rem]">
              A streaming home for nasheeds, and the words that come with them.
            </h1>
            <p className="arabic mt-3 text-[1.2rem] text-goldsoft/85" dir="rtl">
              صوتٌ بلا آلة
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip>
              <Icon name="waveform" size={11} /> {TRACKS.length} nasheeds
            </Chip>
            <Chip>
              <Icon name="user" size={11} /> {ARTISTS.length} reciters
            </Chip>
            <Chip>
              <Icon name="library" size={11} /> {COLLECTIONS.length} sets
            </Chip>
            <Chip>
              <Icon name="compass" size={11} /> {maqamUse.length} maqāmāt
            </Chip>
            <Chip>
              <Icon name="clock" size={11} /> {totals.minutes} minutes
            </Chip>
            <Chip>
              <Icon name="waveform" size={11} /> {formatCount(totals.plays)} plays
            </Chip>
          </div>
        </div>
      </section>

      {/* what this is */}
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Reveal>
          <div>
            <SectionHeader label="what this is" title="CoolNasheed, plainly" />
            <div className="space-y-3 text-[13.5px] leading-relaxed text-text2">
              <p>
                A player for nasheeds — devotional singing, usually unaccompanied or with a frame drum. Everything you would want
                from a streaming service is here: curated sets, publisher pages, a queue, loves, playlists, search, a line-by-line
                lyric view that follows the voice, and a small opinionated recommender called Nūr.
              </p>
              <p>
                Every nasheed is a real recording. An account uploads it, the browser puts it straight into Supabase Storage, and
                everybody else streams it back from there. Nothing is synthesised and nothing is imitated: what you hear is the
                publisher's own file.
              </p>
              <p>
                The words travel with it. Where a publisher set the second each line starts, the lyric view is exact; where they
                did not, the lines are spread evenly across the recording and say so.
              </p>
            </div>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="rounded-2xl border border-line bg-surface/50 p-5">
            <div className="label mb-3">catalogue, counted</div>
            <dl className="space-y-2.5">
              <Big k="Lyric lines" v={totals.lines} />
              <Big k="Minutes of listening" v={totals.minutes} />
              <Big k="Plays counted" v={totals.plays} format />
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-relaxed text-muted">
              Everything on this page is counted from the catalogue the database is holding right now.
            </p>
          </div>
        </Reveal>
      </section>

      {/* signal flow */}
      <section>
        <SectionHeader label="how the sound is made" title="From a line of poetry to a voice in your ears" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {FLOW.map((f, i) => (
            <Reveal key={f.title} delay={i * 50}>
              <div className="card h-full p-4">
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-surface2 text-jade">
                    <Icon name={f.icon} size={15} />
                  </span>
                  <h3 className="text-[14px] font-semibold text-text">{f.title}</h3>
                </div>
                <p className="text-[12.5px] leading-relaxed text-muted">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* maqam table */}
      <section>
        <SectionHeader
          label="modes"
          title="The maqāmāt in this catalogue"
          subtitle="Gold dots are quarter tones — the intervals a keyboard cannot play and a voice can."
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {maqamUse.map(({ m, count, tracks }) => (
            <Reveal key={m}>
              <div className="card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-[19px] text-text">{MAQAMAT[m as MaqamName].name}</span>
                    <span className="arabic text-[15px] text-goldsoft/80" dir="rtl">
                      {MAQAMAT[m as MaqamName].ar}
                    </span>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted">{plural(count, "track")}</span>
                </div>
                <p className="mt-1 text-[11.5px] text-muted">{MAQAMAT[m as MaqamName].mood}</p>
                <div className="relative mt-3 h-9">
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line2" />
                  {Array.from({ length: 13 }).map((_, i) => (
                    <span key={i} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-line" style={{ left: `${(i / 12) * 100}%` }} />
                  ))}
                  {MAQAMAT[m as MaqamName].steps.map((step, i) => {
                    const quarter = Math.abs(step - Math.round(step)) > 0.01;
                    return (
                      <span
                        key={i}
                        className={quarter ? "absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold" : "absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-jade"}
                        style={{ left: `${(step / 12) * 100}%` }}
                        title={`${step} semitones`}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 space-y-1">
                  {tracks.map((t) => (
                    <Link key={t.id} to={`/t/${t.id}`} className="flex items-center gap-2 text-[11.5px] text-muted transition-colors hover:text-text2">
                      <Icon name="chevronRight" size={11} /> <span className="truncate">{t.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* sources & honesty */}
      <section className="grid gap-3 lg:grid-cols-2">
        <Reveal>
          <div className="card h-full p-5">
            <div className="label mb-2">sources</div>
            <h3 className="text-[19px] text-text">Where the words come from</h3>
            <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-text2">
              <li className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                <span>
                  <strong className="font-semibold text-text">Traditional ({traditional} tracks).</strong> Ṭalaʿa al-Badru, Yā
                  Nabiyy Salām, Mawlāya Ṣalli and similar texts are centuries old and sung across the Muslim world.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-jade" />
                <span>
                  <strong className="font-semibold text-text">Scriptural ({quranic} tracks).</strong> Qurʾānic lines are marked in
                  the lyric view and quoted in Arabic. The English under them is a rendering of meaning, never scripture, and the
                  āyah reference is shown so you can check it against a muṣḥaf.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-turq" />
                <span>
                  <strong className="font-semibold text-text">Original ({original} tracks).</strong> The rest were written for this
                  app: new devotional verses in English, with Arabic refrains where the line asked for one.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-madder" />
                <span>
                  <strong className="font-semibold text-text">Poetry.</strong> The Burda lines are al-Būṣīrī's (d. 1294).
                </span>
              </li>
            </ul>
          </div>
        </Reveal>

        <Reveal delay={70}>
          <div className="card h-full p-5">
            <div className="label mb-2">honesty</div>
            <h3 className="text-[19px] text-text">What is made up</h3>
            <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-text2">
              <li className="flex gap-2.5">
                <Icon name="user" size={14} className="mt-1 shrink-0 text-muted" />
                <span>
                  Every nasheed is credited to the account that published it. Nothing in the catalogue is invented by the app —
                  an empty database means an empty shelf.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="trending" size={14} className="mt-1 shrink-0 text-muted" />
                <span>
                  Plays, loves and notes are counted in Postgres, one row at a time. Nothing on a track page is a seeded estimate.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="sparkle" size={14} className="mt-1 shrink-0 text-muted" />
                <span>
                  Nūr is a scoring function with a template writer — no model, no network call. Its confidence is theatrical.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="mic" size={14} className="mt-1 shrink-0 text-muted" />
                <span>
                  The cover art is drawn at runtime as SVG geometry from each nasheed's seed — star rosettes, girih, zellige,
                  mihrab arches. No two are alike, and none of them is a photograph.
                </span>
              </li>
            </ul>
          </div>
        </Reveal>
      </section>

      {/* adab note */}
      <Reveal>
        <section className="relative overflow-hidden rounded-2xl border border-gold/25 bg-gold/[0.05] p-6">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 opacity-[0.14]">
            <PatternArt seed="adab" motif="mihrab" />
          </div>
          <div className="relative max-w-[70ch]">
            <div className="label mb-2 text-gold">adab</div>
            <h3 className="text-[20px] text-text">A note on respect</h3>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-text2">
              Nasheeds sit close to worship for many listeners, so the app tries to behave accordingly: no imagery of the
              Prophet ﷺ or the companions, no invented sayings attributed to anyone, Qurʾānic text marked and referenced,
              translations labelled as meanings, and nothing that interrupts a track with an advertisement or a countdown.
            </p>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-text2">
              If a maqām is used loosely, or a transliteration you know is spelled differently, that is the app's limitation and
              not a scholarly position.
            </p>
          </div>
        </section>
      </Reveal>

      {/* built with */}
      <section>
        <SectionHeader label="built with" title="A small client, a Postgres backend" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { k: "React 19 + Vite", v: "TypeScript throughout, one bundle, no SSR." },
            { k: "Supabase", v: "Postgres with Row Level Security, Auth, Storage for recordings, six Edge Functions." },
            { k: "Tailwind v4", v: "CSS-variable tokens so the night and dawn themes are the same components." },
            { k: "Zustand + localStorage", v: "Queue, settings and the tasbīḥ count persist on device." },
          ].map((x, i) => (
            <Reveal key={x.k} delay={i * 45}>
              <div className="card h-full p-4">
                <div className="text-[13.5px] font-semibold text-text">{x.k}</div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{x.v}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Link to="/" className="btn btn-primary !px-5 !py-3">
            <Icon name="home" size={15} /> Back to the music
          </Link>
          <button className="btn btn-ghost !px-5 !py-3" onClick={() => window.dispatchEvent(new CustomEvent("coolnasheed:command"))}>
            <Icon name="command" size={15} /> Command palette
          </button>
          <span className="text-[11.5px] text-muted">
            Press <kbd className="rounded border border-line2 bg-surface2 px-1.5 py-0.5 font-sans text-[10px]">?</kbd> anywhere for
            the keyboard map.
          </span>
        </div>
      </section>

      <div className="hairline" />
      <p className="text-center font-display text-[15px] text-muted">
        {maqamLabel("hijaz")} is the closest this app gets to a signature.
      </p>
    </div>
  );
}

function Big({ k, v, format }: { k: string; v: number; format?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2 last:border-0">
      <dt className="text-[12.5px] text-muted">{k}</dt>
      <dd className="font-display text-[22px] leading-none tabular-nums text-text">{format ? formatCount(v) : v.toLocaleString()}</dd>
    </div>
  );
}

export function NotFound() {
  return (
    <EmptyState
      icon="compass"
      title="This page is not in the catalogue"
      msg="Nothing here — no track, no set, no reciter. The music is all still where you left it."
      action={
        <Link to="/" className="btn btn-primary mt-2 !px-4 !py-2.5">
          <Icon name="home" size={14} /> Go home
        </Link>
      }
    />
  );
}
