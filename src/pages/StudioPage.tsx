import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../components/ui/Icons";
import { EmptyState, SectionHeader, useToast } from "../components/ui/Primitives";
import { PatternArt } from "../components/art/PatternArt";
import { LyricPreview } from "../components/player/Lyrics";
import { useAccount } from "../lib/hooks";
import { useUi } from "../store/ui";
import { usePlayer } from "../store/player";
import {
  DEFAULT_DRAFT,
  DUFF_PATTERNS,
  draftTrack,
  useStudio,
  validateDraft,
  type DraftLine,
  type PublishError,
} from "../store/studio";
import { registerPreview, isPreview } from "../data/catalog";
import { MAQAMAT, MAQAM_NAMES, noteName, type MaqamName } from "../lib/theory";
import { songFor } from "../lib/song";
import { formatTotal, plural } from "../lib/format";
import type { Accent, Track } from "../data/types";

const ACCENTS: { id: Accent; label: string; varName: string }[] = [
  { id: "jade", label: "Jade", varName: "--c-jade" },
  { id: "gold", label: "Gold", varName: "--c-gold" },
  { id: "turq", label: "Turquoise", varName: "--c-turq" },
  { id: "madder", label: "Madder", varName: "--c-madder" },
  { id: "cobalt", label: "Cobalt", varName: "--c-cobalt" },
];

const NOTE_SUGGESTIONS = ["traditional", "original", "refrain", "Qurʾān 9:128", "Qurʾān 24:35", "dhikr"];

const VOICES: { id: Track["voices"]; label: string; hint: string }[] = [
  { id: "solo", label: "Solo", hint: "one voice" },
  { id: "duet", label: "Duet", hint: "a second underneath" },
  { id: "choir", label: "Choir", hint: "full ensemble" },
];

export default function StudioPage() {
  const account = useAccount();
  const navigate = useNavigate();
  const toast = useToast();
  const requestAuth = useUi((s) => s.requestAuth);
  const player = usePlayer();

  const draft = useStudio((s) => s.draft);
  const entries = useStudio((s) => s.entries);
  const setDraft = useStudio((s) => s.setDraft);
  const setLine = useStudio((s) => s.setLine);
  const addLine = useStudio((s) => s.addLine);
  const removeLine = useStudio((s) => s.removeLine);
  const moveLine = useStudio((s) => s.moveLine);
  const resetDraft = useStudio((s) => s.resetDraft);
  const publish = useStudio((s) => s.publish);
  const unpublish = useStudio((s) => s.unpublish);

  const [error, setError] = useState<PublishError | null>(null);

  /* The draft becomes a real, performable track — which is why the preview can use
     the actual player, with the actual synced lyrics, instead of a fake waveform. */
  const previewTrack = useMemo(() => draftTrack(draft, account), [draft, account]);
  const previewSong = useMemo(() => (previewTrack ? songFor(previewTrack) : null), [previewTrack]);
  const invalid = useMemo(() => validateDraft(draft, account), [draft, account]);
  const previewing = !!player.trackId && isPreview(player.trackId);

  useEffect(() => () => registerPreview(null), []);

  /* one lead note per sung syllable — so this is exactly what the voice will articulate */
  const syllables = previewSong ? previewSong.notes.filter((n) => n.role === "lead").length : 0;
  const words = previewSong ? previewSong.lines.reduce((n, l) => n + l.words.length, 0) : 0;

  const hearIt = () => {
    if (!previewTrack) return;
    registerPreview(previewTrack);
    if (previewing) {
      player.toggle();
      return;
    }
    player.playTrack(previewTrack.id, { kind: "studio", label: "Your draft" }, [previewTrack.id]);
    toast.push({
      title: "Previewing your draft",
      msg: "Same engine, same synced lyrics — edit and press again to rebuild it.",
      kind: "info",
    });
  };

  const onPublish = async () => {
    const res = await publish();
    if (!res.ok) {
      setError(res);
      if (res.field === "lines") document.getElementById("studio-lines")?.scrollIntoView({ behavior: "smooth", block: "center" });
      else window.scrollTo?.({ top: 0, behavior: "smooth" });
      return;
    }
    setError(null);
    registerPreview(null);
    resetDraft();
    toast.push({ title: "Published", msg: `${res.track.title} is on your profile and in search.`, kind: "ok" });
    navigate(`/t/${res.track.id}`);
  };

  if (!account) {
    return (
      <div className="space-y-6">
        <StudioHeader />
        <EmptyState
          icon="mic"
          title="Publishing needs an account"
          msg="Listening, searching and reading never do. But a nasheed with your name on it has to belong to someone — even if that someone only exists in this browser."
          action={
            <button
              className="btn btn-primary mt-1 !px-5 !py-3"
              onClick={() => requestAuth({ label: "Sign in to publish a nasheed" }, "signup")}
            >
              <Icon name="sparkle" size={15} /> Create an account
            </button>
          }
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: "lyrics" as const, t: "You write words", d: "Transliteration, Arabic, or both. The syllabifier splits them into singable syllables and picks a vowel for each." },
            { icon: "sliders" as const, t: "You choose a mode", d: "Maqām, tonic, tempo, one voice or a choir, duff or none. Quarter tones included — Rāst really is 3.5 steps up." },
            { icon: "waveform" as const, t: "The engine sings it", d: "Nothing is uploaded, because nothing needs to be: your nasheed is data, and the same synthesizer that performs the catalogue performs it." },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border border-line bg-surface/50 p-4">
              <Icon name={c.icon} size={17} className="text-jade" />
              <div className="mt-2 text-[13.5px] font-semibold text-text">{c.t}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{c.d}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const mine = entries.filter((e) => e.ownerId === account.id);

  return (
    <div className="space-y-6 pb-24 lg:pb-6">
      <StudioHeader />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_336px]">
        {/* ---------------------------------------------------------- the words */}
        <div className="space-y-5">
          <section className="space-y-4 rounded-2xl border border-line bg-surface/40 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Title</span>
                <input
                  className="field"
                  value={draft.title}
                  onChange={(e) => {
                    setDraft({ title: e.target.value });
                    setError(null);
                  }}
                  placeholder="Nasheed for the last ten nights"
                  maxLength={80}
                  data-invalid={error?.field === "title"}
                  aria-invalid={error?.field === "title"}
                />
              </label>
              <label className="block">
                <span className="field-label">
                  Title in Arabic <span className="normal-case tracking-normal text-muted/70">(optional)</span>
                </span>
                <input
                  className="field arabic text-right"
                  dir="rtl"
                  value={draft.titleAr}
                  onChange={(e) => setDraft({ titleAr: e.target.value })}
                  placeholder="نشيد للعشر الأواخر"
                  maxLength={80}
                />
              </label>
            </div>

            <label className="block">
              <span className="field-label">
                A note about it <span className="normal-case tracking-normal text-muted/70">(optional — becomes the blurb)</span>
              </span>
              <textarea
                className="field scroll-slim resize-y"
                rows={2}
                value={draft.note}
                onChange={(e) => setDraft({ note: e.target.value })}
                placeholder="My grandmother's refrain, the way she sang it — slower than anyone records it."
                maxLength={280}
              />
            </label>
          </section>

          {/* lines */}
          <section id="studio-lines" className="space-y-3">
            <SectionHeader
              label="the words"
              title={plural(draft.lines.length, "line")}
              subtitle="Transliteration or Arabic is what actually gets sung; English shows as the translation."
            />
            {error?.field === "lines" ? (
              <p className="field-error rounded-lg border border-madder/35 bg-madder/10 px-3 py-2">
                <Icon name="info" size={12} /> {error.msg}
              </p>
            ) : null}

            <datalist id="studio-line-notes">
              {NOTE_SUGGESTIONS.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>

            <ol className="space-y-2.5">
              {draft.lines.map((line, i) => (
                <LineRow
                  key={i}
                  index={i}
                  line={line}
                  total={draft.lines.length}
                  onChange={(patch) => {
                    setLine(i, patch);
                    setError(null);
                  }}
                  onRemove={() => removeLine(i)}
                  onMove={(dir) => moveLine(i, i + dir)}
                />
              ))}
            </ol>

            <button className="btn btn-ghost w-full !py-3" onClick={addLine} disabled={draft.lines.length >= 24}>
              <Icon name="plus" size={14} /> Add a line
            </button>

            {previewSong ? (
              <div className="rounded-xl border border-line bg-surface2/30 p-4">
                <div className="label mb-2.5">how the engine reads your words</div>
                <LyricPreview song={previewSong} count={Math.min(3, previewSong.lines.length)} />
              </div>
            ) : null}
          </section>
        </div>

        {/* ---------------------------------------------------------- the sound */}
        <aside className="space-y-4 lg:sticky lg:top-[84px]">
          <section className="space-y-4 rounded-2xl border border-line bg-surface/40 p-4">
            <div>
              <span className="field-label">Maqām</span>
              <div className="grid grid-cols-2 gap-1.5">
                {MAQAM_NAMES.map((m) => (
                  <button
                    key={m}
                    className={clsx(
                      "rounded-lg border px-2.5 py-2 text-left transition-colors",
                      draft.maqam === m ? "border-jade/50 bg-jade/12" : "border-line bg-surface2/40 hover:border-line2",
                    )}
                    onClick={() => setDraft({ maqam: m as MaqamName })}
                    aria-pressed={draft.maqam === m}
                  >
                    <span className={clsx("block text-[13px]", draft.maqam === m ? "text-jadesoft" : "text-text2")}>
                      {MAQAMAT[m].name}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-tight text-muted">{MAQAMAT[m].mood}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Tonic</span>
                <select
                  className="field !py-2.5"
                  value={draft.root}
                  onChange={(e) => setDraft({ root: Number(e.target.value) })}
                >
                  {Array.from({ length: 18 }, (_, i) => 50 + i).map((midi) => (
                    <option key={midi} value={midi}>
                      {noteName(midi)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Tempo · {draft.bpm} bpm</span>
                <input
                  className="field !py-3"
                  type="range"
                  min={44}
                  max={160}
                  step={2}
                  value={draft.bpm}
                  onChange={(e) => setDraft({ bpm: Number(e.target.value) })}
                  aria-label="Tempo in beats per minute"
                />
              </label>
            </div>

            <div>
              <span className="field-label">Voices</span>
              <div className="flex gap-1.5">
                {VOICES.map((v) => (
                  <button
                    key={v.id}
                    className={clsx(
                      "flex-1 rounded-lg border px-2 py-2 transition-colors",
                      draft.voices === v.id ? "border-jade/50 bg-jade/12 text-jadesoft" : "border-line bg-surface2/40 text-muted hover:border-line2",
                    )}
                    onClick={() => setDraft({ voices: v.id })}
                    aria-pressed={draft.voices === v.id}
                  >
                    <span className="block text-[12.5px] font-semibold">{v.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-tight opacity-75">{v.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="field-label">Duff</span>
              <div className="space-y-1.5">
                <button
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                    draft.duff === null ? "border-gold/45 bg-gold/10 text-goldsoft" : "border-line bg-surface2/40 text-muted hover:border-line2",
                  )}
                  onClick={() => setDraft({ duff: null })}
                  aria-pressed={draft.duff === null}
                >
                  <Icon name="mic" size={14} /> Vocals only — no drum at all
                </button>
                {DUFF_PATTERNS.map((p) => (
                  <button
                    key={p.id}
                    className={clsx(
                      "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                      draft.duff === p.pattern ? "border-jade/50 bg-jade/12 text-jadesoft" : "border-line bg-surface2/40 text-muted hover:border-line2",
                    )}
                    onClick={() => setDraft({ duff: p.pattern })}
                    aria-pressed={draft.duff === p.pattern}
                  >
                    <Icon name="drum" size={14} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{p.label}</span>
                    <span className="font-mono text-[9.5px] tracking-tight opacity-60">{p.pattern}</span>
                  </button>
                ))}
              </div>
              {draft.duff ? (
                <div className="mt-2 flex gap-1.5">
                  {(["verse", "intro"] as const).map((when) => (
                    <button
                      key={when}
                      className={clsx("chip flex-1 justify-center", draft.duffEnter === when && "text-text")}
                      data-active={draft.duffEnter === when}
                      onClick={() => setDraft({ duffEnter: when })}
                      aria-pressed={draft.duffEnter === when}
                    >
                      enters at the {when}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Repetitions</span>
                <select
                  className="field !py-2.5"
                  value={draft.passes}
                  onChange={(e) => setDraft({ passes: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}× {n === 1 ? "(once through)" : "— lifts, then settles"}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className="field-label">Cover</span>
                <div className="flex items-center gap-1.5">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      className={clsx(
                        "h-8 w-8 rounded-full ring-offset-2 ring-offset-bg transition-transform",
                        draft.accent === a.id ? "ring-2 ring-text scale-105" : "ring-1 ring-line hover:scale-105",
                      )}
                      style={{ background: `var(${a.varName})` }}
                      onClick={() => setDraft({ accent: a.id })}
                      aria-label={`${a.label} cover`}
                      aria-pressed={draft.accent === a.id}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* preview + publish */}
          <section className="space-y-3 rounded-2xl border border-line2 bg-elev/70 p-4 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-line2">
                {previewTrack ? <PatternArt seed={previewTrack.seed} accent={draft.accent} /> : <Icon name="waveform" size={18} className="text-muted" />}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-text">
                  {draft.title.trim() || "Untitled nasheed"}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted">
                  {MAQAMAT[draft.maqam].name} · {noteName(draft.root)} · {draft.bpm} bpm · {draft.voices}
                </div>
              </div>
            </div>

            {previewSong ? (
              <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                  [formatTotal(previewSong.duration), "length"],
                  [String(previewSong.lines.length), "timed lines"],
                  [String(syllables), "syllables"],
                ].map(([v, k]) => (
                  <div key={k} className="rounded-lg border border-line bg-surface2/40 px-1 py-2">
                    <dt className="text-[13px] font-semibold text-text tabular-nums">{v}</dt>
                    <dd className="mt-0.5 text-[9.5px] uppercase tracking-wider text-muted">{k}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="rounded-lg border border-dashed border-line2 px-3 py-2.5 text-[12px] leading-snug text-muted">
                Add a title and at least one line of words — {words ? `${words} words ready` : "then the engine can sing it"}.
              </p>
            )}

            <button className="btn btn-ghost w-full !py-3" onClick={hearIt} disabled={!previewTrack}>
              <Icon name={previewing && player.playing ? "pause" : "play"} size={15} strokeWidth={2.2} />
              {previewing && player.playing ? "Pause the preview" : "Hear it"}
            </button>

            <button className="btn btn-primary w-full !py-3.5" onClick={onPublish} disabled={!!invalid}>
              <Icon name="sparkle" size={15} /> Publish
            </button>
            {invalid ? (
              <p className="text-[11.5px] leading-snug text-muted">{invalid.msg}</p>
            ) : (
              <p className="text-[11.5px] leading-snug text-muted">
                Published to this device under @{account.handle}. You can take it down at any time.
              </p>
            )}
            {error?.field === "form" ? (
              <p className="field-error rounded-lg border border-madder/35 bg-madder/10 px-3 py-2">
                <Icon name="info" size={12} /> {error.msg}
              </p>
            ) : null}

            <button
              className="btn w-full px-2 py-2 !text-[12px] text-muted hover:text-text2"
              onClick={() => {
                resetDraft();
                setError(null);
              }}
              disabled={JSON.stringify(draft) === JSON.stringify(DEFAULT_DRAFT)}
            >
              <Icon name="close" size={13} /> Clear the draft
            </button>
          </section>
        </aside>
      </div>

      {/* ------------------------------------------------------- your nasheeds */}
      {mine.length ? (
        <section>
          <SectionHeader label="your nasheeds" title={plural(mine.length, "published track")} subtitle="On this device, under your account." />
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {mine.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface/50 p-3">
                <Link to={`/t/${e.id}`} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-line2">
                  <PatternArt seed={`published-${e.id}`} accent={e.accent} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/t/${e.id}`} className="block truncate text-[13.5px] font-semibold text-text hover:text-jadesoft">
                    {e.title}
                  </Link>
                  <div className="mt-0.5 truncate text-[11.5px] text-muted">
                    {MAQAMAT[e.maqam].name} · {e.bpm} bpm · {plural(e.lines.length, "line")}
                  </div>
                </div>
                <button
                  className="btn-icon rounded-full p-2 text-muted hover:text-madder"
                  onClick={() => {
                    void unpublish(e.id).then((done) => {
                      if (done) toast.push({ title: "Taken down", msg: e.title, kind: "info" });
                    });
                  }}
                  aria-label={`Unpublish ${e.title}`}
                  title="Unpublish"
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function StudioHeader() {
  return (
    <header className="space-y-2">
      <div className="label">the studio</div>
      <h1 className="text-2xl text-text sm:text-3xl">Publish a nasheed</h1>
      <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted">
        There is nothing to upload. You write the words and choose the mode; the synthesis engine performs it — voice
        by voice, syllable by syllable, with the lyric timings built at the same moment. If you quote the Qurʾān or a
        classical text, say so in the line's note and cite it: it shows under the line when it is sung.
      </p>
    </header>
  );
}

function LineRow({
  index,
  line,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  line: DraftLine;
  total: number;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <li className="rounded-xl border border-line bg-surface/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-surface2 text-[11px] font-bold text-text2 tabular-nums">
          {index + 1}
        </span>
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">line {index + 1}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <button className="btn-icon rounded-full p-1.5 text-muted hover:text-text2" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move line up">
            <Icon name="chevronUp" size={14} />
          </button>
          <button
            className="btn-icon rounded-full p-1.5 text-muted hover:text-text2"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Move line down"
          >
            <Icon name="chevronDown" size={14} />
          </button>
          <button
            className="btn-icon rounded-full p-1.5 text-muted hover:text-madder"
            onClick={onRemove}
            disabled={total <= 1}
            aria-label={`Remove line ${index + 1}`}
          >
            <Icon name="trash" size={14} />
          </button>
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className="field !py-2.5"
          value={line.tr}
          onChange={(e) => onChange({ tr: e.target.value })}
          placeholder="Yā man yaʿfu wa man yaṣfaḥ"
          aria-label={`Line ${index + 1} transliteration`}
          maxLength={160}
        />
        <input
          className="field arabic !py-2.5 text-right"
          dir="rtl"
          value={line.ar}
          onChange={(e) => onChange({ ar: e.target.value })}
          placeholder="يا من يعفو ويصفح"
          aria-label={`Line ${index + 1} in Arabic`}
          maxLength={160}
        />
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
        <input
          className="field !py-2.5 text-[13.5px] italic"
          value={line.en}
          onChange={(e) => onChange({ en: e.target.value })}
          placeholder="O You who pardons and overlooks"
          aria-label={`Line ${index + 1} translation`}
          maxLength={200}
        />
        <input
          className="field !py-2.5 text-[12.5px]"
          value={line.note}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="traditional"
          list="studio-line-notes"
          aria-label={`Line ${index + 1} attribution`}
          maxLength={60}
        />
      </div>
    </li>
  );
}
