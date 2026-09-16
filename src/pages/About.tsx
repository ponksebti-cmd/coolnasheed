import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/ui/Icons";
import { StarMark } from "../components/art/CoverArt";
import { Chip, EmptyState, Reveal, SectionHeader } from "../components/ui/Primitives";
import { ARTISTS, COLLECTIONS, TRACKS, formatCount, statsFor } from "../data/catalog";
import { plural } from "../lib/format";

/** Where a nasheed comes from, end to end. Every step is a real thing the backend does. */
const FLOW: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "upload",
    title: "1 · A reciter uploads an mp3",
    body: "A signed-in account uploads the recording and, optionally, cover art. Nothing is recorded in the browser and nothing is generated: the file you hear is the file they sent.",
  },
  {
    icon: "shield",
    title: "2 · The bucket refuses anything else",
    body: "The audio bucket accepts audio/mpeg only, up to 5 MB, and the row in Postgres records the byte size and the mime type. Cover art is capped at 2 MB. Anything larger is compressed in your browser — resized, or re-encoded at the best bitrate that fits — before a byte leaves the device. A nasheed cannot go live without audio attached.",
  },
  {
    icon: "server",
    title: "3 · The publish function checks it",
    body: "An Edge Function verifies the account, the ownership of the uploaded object, the size and the type, and writes the row with a service-grade validation pass. The browser is never trusted with the write.",
  },
  {
    icon: "lyrics",
    title: "4 · The words travel with it",
    body: "Lyric lines are stored with the nasheed, and a line may carry a timestamp. When it does, the lyric view follows it; when it does not, the words are still there to read.",
  },
  {
    icon: "library",
    title: "5 · It joins the catalogue",
    body: "One read returns the published catalogue. Search, sets, reciter pages and the queue are all views over the same rows — there is no second, bundled copy of the catalogue anywhere.",
  },
  {
    icon: "users",
    title: "6 · Everything you do is stored under your account",
    body: "Loves, sets, follows, listening history, your preferences, your dhikr count and an unpublished draft live in Postgres behind row-level security, so they follow you to any device.",
  },
];

export default function About() {
  const totals = useMemo(() => {
    const plays = TRACKS.reduce((sum, t) => sum + statsFor(t).plays, 0);
    const lines = TRACKS.reduce((sum, t) => sum + t.lines.length, 0);
    const timed = TRACKS.reduce((sum, t) => sum + t.lines.filter((line) => typeof line.t === "number").length, 0);
    return { plays, lines, timed };
  }, []);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const track of TRACKS) for (const tag of track.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  }, []);

  return (
    <div className="space-y-12 pb-4">
      {/* header */}
      <section className="over-art relative overflow-hidden rounded-3xl border border-line">
        <div
          className="absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(110% 120% at 10% 0%, color-mix(in oklab, var(--c-gold) 30%, transparent), transparent 62%)" }}
          aria-hidden
        />
        <div className="art-scrim-side absolute inset-0" />
        <div className="grain absolute inset-0" />
        <div className="relative flex flex-col items-start gap-5 p-6 md:p-10">
          <span className="grid h-14 w-14 place-items-center rounded-xl border border-line2 bg-elev/70 backdrop-blur">
            <StarMark size={34} />
          </span>
          <div>
            <div className="label mb-2">about</div>
            <h1 className="max-w-[22ch] text-[2.1rem] leading-[0.98] text-text md:text-[3rem]">
              A streaming app for nasheeds, and nothing it made up.
            </h1>
            <p className="arabic mt-3 text-[1.2rem] text-goldsoft/85" dir="rtl">
              صوتٌ بلا آلة
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip>
              <Icon name="waveform" size={11} /> {TRACKS.length} nasheeds published
            </Chip>
            <Chip>
              <Icon name="user" size={11} /> {ARTISTS.length} publishers
            </Chip>
            <Chip>
              <Icon name="library" size={11} /> {COLLECTIONS.length} sets
            </Chip>
            <Chip>
              <Icon name="lyrics" size={11} /> {formatCount(totals.lines)} lyric lines
            </Chip>
            <Chip>
              <Icon name="clock" size={11} /> {formatCount(totals.timed)} timed lines
            </Chip>
            <Chip>
              <Icon name="trending" size={11} /> {formatCount(totals.plays)} plays counted
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
                A player for nasheeds — devotional singing, usually unaccompanied. Everything you would want from a streaming
                service is here: sets, reciter pages, a queue, loves, playlists, search, a line-by-line lyric view, and a{" "}
                <Link to="/studio" className="text-jadesoft hover:underline">
                  publisher studio
                </Link>{" "}
                where an mp3 becomes a nasheed in the catalogue.
              </p>
              <p>
                The audio is the publisher's own recording, uploaded to object storage and streamed as an mp3. The app does not
                synthesise voices, it does not generate a drum part, and there is no bundled demo catalogue to fall back on: an
                empty project shows an empty catalogue, because that is the truth about it.
              </p>
              <p>
                There is no on-device state. Loves, sets, follows, history, playback preferences and the dhikr counter are rows
                in Postgres under your account, behind row-level security, and they are the only copy.
              </p>
            </div>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="rounded-2xl border border-line bg-surface/50 p-5">
            <div className="label mb-3">catalogue, counted</div>
            <dl className="space-y-2.5">
              <Big k="Nasheeds published" v={TRACKS.length} />
              <Big k="Publishers" v={ARTISTS.length} />
              <Big k="Sets" v={COLLECTIONS.length} />
              <Big k="Lyric lines" v={totals.lines} format />
              <Big k="Plays, counted server-side" v={totals.plays} format />
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-relaxed text-muted">
              Every number on this page is a count of rows the server returned. Nothing is estimated, seeded or padded.
            </p>
          </div>
        </Reveal>
      </section>

      {/* signal flow */}
      <section>
        <SectionHeader label="how a nasheed gets here" title="From a recording to this page" />
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

      {/* tags */}
      {tags.length ? (
        <section>
          <SectionHeader label="the shelf" title="What is in the catalogue today" subtitle="Tag counts, straight from the published rows." />
          <div className="flex flex-wrap gap-2">
            {tags.map(([tag, count]) => (
              <Chip key={tag}>
                <Link to={`/search?q=${encodeURIComponent(tag)}`} className="hover:text-text">
                  {tag} <span className="ml-1.5 tabular-nums text-muted">{count}</span>
                </Link>
              </Chip>
            ))}
          </div>
        </section>
      ) : null}

      {/* honesty */}
      <section className="grid gap-3 lg:grid-cols-2">
        <Reveal>
          <div className="card h-full p-5">
            <div className="label mb-2">the rules this app holds itself to</div>
            <h3 className="text-[19px] text-text">What it will not do</h3>
            <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-text2">
              <li className="flex gap-2.5">
                <Icon name="drum" size={14} className="mt-1 shrink-0 text-muted" />
                <span>
                  <strong className="font-semibold text-text">No generated music.</strong> There is no oscillator bank, no drum
                  machine, no reverb impulse invented at runtime. Playback is one media element playing one mp3.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="trending" size={14} className="mt-1 shrink-0 text-muted" />
                <span>
                  <strong className="font-semibold text-text">No invented counters.</strong> Plays are recorded when they happen
                  and likes when they are pressed. There is no seed that produces social proof.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="sparkle" size={14} className="mt-1 shrink-0 text-muted" />
                <span>
                  <strong className="font-semibold text-text">No fake notes.</strong> Nothing is written into a comment thread by
                  the app. An empty thread is an empty thread.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="cloudOff" size={14} className="mt-1 shrink-0 text-muted" />
                <span>
                  <strong className="font-semibold text-text">No offline lies.</strong> If the backend cannot be reached, the app
                  says so rather than showing a shadow catalogue that does not exist.
                </span>
              </li>
            </ul>
          </div>
        </Reveal>

        <Reveal delay={70}>
          <div className="card h-full p-5">
            <div className="label mb-2">where the words come from</div>
            <h3 className="text-[19px] text-text">Lyrics, credits and respect</h3>
            <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-text2">
              <li className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                <span>
                  Line notes travel with each nasheed — <em>traditional</em>, a poet's name, or a Qurʾānic reference — so a
                  listener can see what they are hearing.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-jade" />
                <span>
                  Where a line is Qurʾān, it is quoted in Arabic and the English under it is labelled as a rendering of meaning,
                  with the reference shown so it can be checked against a muṣḥaf.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-turq" />
                <span>A publisher can correct or remove their own upload at any time from the studio.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-madder" />
                <span>
                  Translations are renderings, transliterations may differ from the spelling you know, and neither is a scholarly
                  position.
                </span>
              </li>
            </ul>
          </div>
        </Reveal>
      </section>

      {/* adab note */}
      <Reveal>
        <section className="relative overflow-hidden rounded-2xl border border-gold/25 bg-gold/[0.05] p-6">
          <div className="pointer-events-none absolute -right-10 -top-10 opacity-[0.12] text-gold">
            <StarMark size={190} />
          </div>
          <div className="relative max-w-[70ch]">
            <div className="label mb-2 text-gold">adab</div>
            <h3 className="text-[20px] text-text">A note on respect</h3>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-text2">
              Nasheeds sit close to worship for many listeners, so the app tries to behave accordingly: no imagery of the
              Prophet ﷺ or the companions, no invented sayings attributed to anyone, Qurʾānic text marked and referenced,
              credits kept with the nasheed, and nothing that interrupts a recording with an advertisement or a countdown.
            </p>
          </div>
        </section>
      </Reveal>

      {/* built with */}
      <section>
        <SectionHeader label="built with" title="A small stack, honestly described" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { k: "React 19 + Vite", v: "TypeScript throughout, one bundle, no SSR." },
            { k: "One <audio> element", v: "The browser's media element does the streaming, seeking and buffering. No DSP graph." },
            { k: "Supabase", v: "Postgres with row-level security, Storage for mp3 and artwork, Edge Functions for the writes." },
            { k: "Zustand, server-backed", v: "UI state in memory; loves, sets, history and settings live in the database." },
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
          <Link to="/studio" className="btn btn-ghost !px-5 !py-3">
            <Icon name="upload" size={15} /> Publish a nasheed
          </Link>
          <span className="text-[11.5px] text-muted">
            Press <kbd className="rounded border border-line2 bg-surface2 px-1.5 py-0.5 font-sans text-[10px]">?</kbd> anywhere for
            the keyboard map.
          </span>
        </div>
      </section>

      <div className="hairline" />
      <p className="text-center font-display text-[15px] text-muted">
        {TRACKS.length ? `A catalogue of ${plural(TRACKS.length, "nasheed")}, sung by people.` : "The catalogue is empty until someone uploads a nasheed."}
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
      msg="Nothing here — no nasheed, no set, no reciter. The music is all still where you left it."
      action={
        <Link to="/" className="btn btn-primary mt-2 !px-4 !py-2.5">
          <Icon name="home" size={14} /> Go home
        </Link>
      }
    />
  );
}
