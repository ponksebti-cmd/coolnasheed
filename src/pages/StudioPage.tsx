import { useEffect, useMemo, useRef, useState } from "react";
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
  draftTrack,
  draftToLines,
  useStudio,
  validateDraft,
  type DraftLine,
  type PublishError,
} from "../store/studio";
import { registerPreview, isPreview } from "../data/catalog";
import { MAQAMAT, MAQAM_NAMES, type MaqamName } from "../lib/theory";
import { timedLyrics } from "../lib/lyrics";
import { formatTime, plural } from "../lib/format";

const NOTE_SUGGESTIONS = ["traditional", "original", "refrain", "Qurʾān 9:128", "Qurʾān 24:35", "dhikr"];
const TAG_SUGGESTIONS = ["original", "traditional", "dhikr", "Ramadan", "acoustic", "children", "eid", "sleep"];

const AUDIO_TYPES = "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm";
const IMAGE_TYPES = "image/*,.png,.jpg,.jpeg,.webp,.svg";

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StudioPage() {
  const account = useAccount();
  const navigate = useNavigate();
  const toast = useToast();
  const requestAuth = useUi((s) => s.requestAuth);
  const player = usePlayer();

  const draft = useStudio((s) => s.draft);
  const entries = useStudio((s) => s.entries);
  const audio = useStudio((s) => s.audio);
  const artwork = useStudio((s) => s.artwork);
  const publishing = useStudio((s) => s.publishing);
  const setAudio = useStudio((s) => s.setAudio);
  const setArtwork = useStudio((s) => s.setArtwork);
  const setDraft = useStudio((s) => s.setDraft);
  const setLine = useStudio((s) => s.setLine);
  const addLine = useStudio((s) => s.addLine);
  const removeLine = useStudio((s) => s.removeLine);
  const moveLine = useStudio((s) => s.moveLine);
  const resetDraft = useStudio((s) => s.resetDraft);
  const publish = useStudio((s) => s.publish);
  const unpublish = useStudio((s) => s.unpublish);

  const [error, setError] = useState<PublishError | null>(null);
  const [tagText, setTagText] = useState(draft.tags.join(", "));
  const audioInput = useRef<HTMLInputElement>(null);
  const artInput = useRef<HTMLInputElement>(null);

  /* The preview plays the file still sitting in the form, so what you hear is what
     will be uploaded — same recording, same words, same timings. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!audio) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(audio.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);

  const previewTrack = useMemo(
    () => (previewUrl ? draftTrack(draft, account, { url: previewUrl, durationMs: audio?.durationMs ?? null }) : null),
    [draft, account, previewUrl, audio?.durationMs],
  );
  const previewLyrics = useMemo(
    () =>
      previewTrack
        ? timedLyrics(previewTrack.id, previewTrack.lines, Math.round((previewTrack.durationMs ?? 0) / 1000))
        : null,
    [previewTrack],
  );

  const invalid = useMemo(() => validateDraft(draft, account, audio), [draft, account, audio]);
  const previewing = !!player.trackId && isPreview(player.trackId);

  useEffect(() => () => registerPreview(null), []);

  const lines = useMemo(() => draftToLines(draft.lines), [draft.lines]);

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
      msg: "The file you attached, with the words you typed. Edit and press again to reload it.",
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
    setTagText("original");
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
            { icon: "upload" as const, t: "You bring the recording", d: "An mp3, wav, m4a, ogg or flac up to 48 MB goes straight from this browser to Supabase Storage." },
            { icon: "lyrics" as const, t: "You write the words", d: "Transliteration, Arabic, and a rendering of the meaning in English, line by line." },
            { icon: "compass" as const, t: "You name the mode", d: "Maqām and tags, so people can find it by the sound of it. Set the second each line starts and the lyrics follow exactly." },
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

  const mine = entries.filter((e) => e.ownerId === account.id || e.ownerHandle === account.handle);

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
                A note about it <span className="normal-case tracking-normal text-muted/70">(optional)</span>
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

            <label className="block">
              <span className="field-label">
                Tags <span className="normal-case tracking-normal text-muted/70">(comma separated, up to eight)</span>
              </span>
              <input
                className="field"
                value={tagText}
                list="studio-tags"
                onChange={(e) => {
                  setTagText(e.target.value);
                  setDraft({
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .slice(0, 8),
                  });
                }}
                placeholder="original, Ramadan, dhikr"
                maxLength={160}
              />
              <datalist id="studio-tags">
                {TAG_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
          </section>

          {/* lines */}
          <section id="studio-lines" className="space-y-3">
            <SectionHeader
              label="the words"
              title={plural(lines.length, "line")}
              subtitle="Transliteration or Arabic is what gets shown; English sits under it as a rendering of the meaning. Set a start time if you want the lyric view to follow the recording exactly."
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

            <button className="btn btn-ghost w-full !py-3" onClick={addLine} disabled={draft.lines.length >= 40}>
              <Icon name="plus" size={14} /> Add a line
            </button>

            {previewLyrics ? (
              <div className="rounded-xl border border-line bg-surface2/30 p-4">
                <div className="label mb-2.5">how your words will read</div>
                <LyricPreview lyrics={previewLyrics} count={Math.min(3, previewLyrics.lines.length)} />
              </div>
            ) : null}
          </section>
        </div>

        {/* ------------------------------------------------------ the recording */}
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

            {/* the recording */}
            <div>
              <span className="field-label">The recording</span>
              <input
                ref={audioInput}
                type="file"
                accept={AUDIO_TYPES}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  void setAudio(file);
                  setError(null);
                }}
              />
              {audio ? (
                <div className="rounded-xl border border-line bg-surface2/40 p-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-jade">
                      <Icon name="waveform" size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-text">{audio.name}</span>
                      <span className="block text-[11px] text-muted">
                        {bytesLabel(audio.bytes)}
                        {audio.durationMs ? ` · ${formatTime(Math.round(audio.durationMs / 1000))}` : " · reading length…"}
                      </span>
                    </span>
                    <button
                      className="btn-icon rounded-full p-1.5 text-muted hover:text-madder"
                      onClick={() => void setAudio(null)}
                      aria-label="Remove the recording"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  {audio.durationMs ? (
                    <p className="mt-2 text-[11px] leading-snug text-muted">
                      {lines.filter((l) => l.t !== undefined).length
                        ? `${lines.filter((l) => l.t !== undefined).length} of ${lines.length} lines carry a start time.`
                        : "No line timings yet — the lyric view will spread your lines evenly across the recording."}
                    </p>
                  ) : null}
                </div>
              ) : (
                <button
                  className={clsx(
                    "flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed px-3 py-5 text-center transition-colors",
                    error?.field === "audio"
                      ? "border-madder/50 bg-madder/5 text-madder"
                      : "border-line2 bg-surface2/30 text-muted hover:border-jade/40 hover:text-text2",
                  )}
                  onClick={() => audioInput.current?.click()}
                >
                  <Icon name="upload" size={18} />
                  <span className="text-[12.5px] font-semibold text-text2">Attach the recording</span>
                  <span className="text-[11px]">mp3, wav, m4a, ogg or flac · up to 48 MB</span>
                </button>
              )}
              {error?.field === "audio" ? (
                <p className="field-error mt-1.5 flex items-center gap-1.5">
                  <Icon name="info" size={12} /> {error.msg}
                </p>
              ) : null}
            </div>

            {/* cover art */}
            <div>
              <span className="field-label">
                Cover <span className="normal-case tracking-normal text-muted/70">(optional)</span>
              </span>
              <input
                ref={artInput}
                type="file"
                accept={IMAGE_TYPES}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  void setArtwork(file);
                }}
              />
              {artwork ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface2/40 p-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-gold">
                    <Icon name="grid" size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-text">{artwork.name}</span>
                    <span className="block text-[11px] text-muted">{bytesLabel(artwork.bytes)}</span>
                  </span>
                  <button
                    className="btn-icon rounded-full p-1.5 text-muted hover:text-madder"
                    onClick={() => void setArtwork(null)}
                    aria-label="Remove the cover"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ) : (
                <button
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line2 bg-surface2/30 px-3 py-2.5 text-[12px] text-muted transition-colors hover:border-jade/40 hover:text-text2"
                  onClick={() => artInput.current?.click()}
                >
                  <Icon name="grid" size={14} /> Add a cover image
                </button>
              )}
              <p className="mt-1.5 text-[11px] leading-snug text-muted">
                Without one, the cover is drawn from the nasheed's seed like every other piece of art here.
              </p>
            </div>
          </section>

          {/* preview + publish */}
          <section className="space-y-3 rounded-2xl border border-line2 bg-elev/70 p-4 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-line2">
                {previewTrack ? <PatternArt seed={previewTrack.seed} /> : <Icon name="waveform" size={18} className="text-muted" />}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-text">{draft.title.trim() || "Untitled nasheed"}</div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted">
                  {MAQAMAT[draft.maqam].name} · {plural(lines.length, "line")}
                  {audio?.durationMs ? ` · ${formatTime(Math.round(audio.durationMs / 1000))}` : ""}
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                [audio?.durationMs ? formatTime(Math.round(audio.durationMs / 1000)) : "—", "length"],
                [String(lines.length), "lines"],
                [String(lines.filter((l) => l.t !== undefined).length), "timed"],
              ].map(([v, k]) => (
                <div key={k} className="rounded-lg border border-line bg-surface2/40 px-1 py-2">
                  <dt className="text-[13px] font-semibold text-text tabular-nums">{v}</dt>
                  <dd className="mt-0.5 text-[9.5px] uppercase tracking-wider text-muted">{k}</dd>
                </div>
              ))}
            </dl>

            <button className="btn btn-ghost w-full !py-3" onClick={hearIt} disabled={!previewTrack}>
              <Icon name={previewing && player.playing ? "pause" : "play"} size={15} strokeWidth={2.2} />
              {previewing && player.playing ? "Pause the preview" : "Hear it"}
            </button>

            <button className="btn btn-primary w-full !py-3.5" onClick={onPublish} disabled={!!invalid || publishing}>
              <Icon name="sparkle" size={15} /> {publishing ? "Uploading…" : "Publish"}
            </button>
            {invalid ? (
              <p className="text-[11.5px] leading-snug text-muted">{invalid.msg}</p>
            ) : (
              <p className="text-[11.5px] leading-snug text-muted">
                The recording goes to Supabase Storage and the row to Postgres, under @{account.handle}. You can take it down at
                any time.
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
                setTagText("original");
                setError(null);
              }}
              disabled={JSON.stringify(draft) === JSON.stringify(DEFAULT_DRAFT) && !audio && !artwork}
            >
              <Icon name="close" size={13} /> Clear the draft
            </button>
          </section>
        </aside>
      </div>

      {/* ------------------------------------------------------- your nasheeds */}
      {mine.length ? (
        <section>
          <SectionHeader label="your nasheeds" title={plural(mine.length, "published track")} subtitle="Stored on your account, streamed to everyone else." />
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {mine.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface/50 p-3">
                <Link to={`/t/${e.id}`} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-line2">
                  <PatternArt seed={`published-${e.id}`} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/t/${e.id}`} className="block truncate text-[13.5px] font-semibold text-text hover:text-jadesoft">
                    {e.title}
                  </Link>
                  <div className="mt-0.5 truncate text-[11.5px] text-muted">
                    {MAQAMAT[e.maqam].name} · {plural(e.lines.length, "line")}
                    {e.durationMs ? ` · ${formatTime(Math.round(e.durationMs / 1000))}` : ""}
                    {e.hasAudio ? "" : " · no recording"}
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
        Bring the recording and write down the words. The file is uploaded from this browser to Supabase Storage and everybody
        else streams it back — nothing is synthesised and nothing is imitated. If you quote the Qurʾān or a classical text, say so
        in the line's note and cite it: it shows under the line when the words are read.
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
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-muted">starts at</span>
        <input
          className="field !w-24 !py-1.5 text-[12.5px] tabular-nums"
          type="number"
          min={0}
          step={0.1}
          inputMode="decimal"
          value={line.t}
          onChange={(e) => onChange({ t: e.target.value })}
          placeholder="—"
          aria-label={`Line ${index + 1} start time in seconds`}
        />
        <span className="text-[11px] text-muted">seconds — leave it blank and we spread the lines evenly</span>
      </div>
    </li>
  );
}
