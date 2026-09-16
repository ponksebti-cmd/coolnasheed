/**
 * The studio: publish a recording.
 *
 * There is no composition step, because there is nothing to compose in the browser.
 * What a publisher does here is:
 *
 *   1. upload the mp3 — the recording is the nasheed, and nothing publishes without one
 *   2. upload cover art, if there is any
 *   3. write the title, the tags and the lyrics
 *   4. listen to it through the same player a listener will use, and mark lines as they
 *      are sung if they want the lyric view to follow the recording
 *   5. publish
 *
 * The draft is a row in the database (`studio_drafts`), so a half-finished nasheed is
 * waiting on the next machine too.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../components/ui/Icons";
import { SetupSqlButton } from "../components/SetupSqlButton";
import {
  EmptyState,
  SectionHeader,
  useErrorToast,
  useToast,
} from "../components/ui/Primitives";
import { CoverArt } from "../components/art/CoverArt";
import { LyricPreview } from "../components/player/Lyrics";
import { useAccount } from "../lib/hooks";
import { checkSchema, schemaProblem, type SchemaState } from "../lib/schema";
import { useUi } from "../store/ui";
import { usePlayer } from "../store/player";
import {
  flushDraftSave,
  previewDraftInPlayer,
  useStudio,
} from "../store/studio";
import { api } from "../lib/api";
import { getTrack } from "../data/catalog";
import { formatTime, formatTotal, plural, relativeTime } from "../lib/format";
import type { DraftLine, LyricLine } from "../../shared/types";


const NOTE_SUGGESTIONS = [
  "traditional",
  "original",
  "refrain",
  "Qurʾān 9:128",
  "Qurʾān 24:35",
  "dhikr",
];

function humanBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StudioPage() {
  const account = useAccount();
  const toast = useToast();
  const requestAuth = useUi((s) => s.requestAuth);

  const draft = useStudio((s) => s.draft);
  const entries = useStudio((s) => s.entries);
  const loading = useStudio((s) => s.loading);
  const publishing = useStudio((s) => s.publishing);
  const savedAt = useStudio((s) => s.savedAt);
  const error = useStudio((s) => s.error);
  const preparing = useStudio((s) => s.preparing);
  const uploadProgress = useStudio((s) => s.uploadProgress);
  /* Every failure — a refused upload, a missing recording, a database rule — comes out
     at the bottom of the screen where the person is looking, not in a banner above the
     fold they have already scrolled past. */
  useErrorToast(error);
  const setDraft = useStudio((s) => s.setDraft);
  const setLine = useStudio((s) => s.setLine);
  const addLine = useStudio((s) => s.addLine);
  const removeLine = useStudio((s) => s.removeLine);
  const moveLine = useStudio((s) => s.moveLine);
  const setTags = useStudio((s) => s.setTags);
  const attachAudio = useStudio((s) => s.attachAudio);
  const attachArtwork = useStudio((s) => s.attachArtwork);
  const clearAudio = useStudio((s) => s.clearAudio);
  const publish = useStudio((s) => s.publish);
  const unpublish = useStudio((s) => s.unpublish);
  const startEdit = useStudio((s) => s.startEdit);
  const resetDraft = useStudio((s) => s.resetDraft);
  const loadMine = useStudio((s) => s.loadMine);

  const player = usePlayer();
  const audioInput = useRef<HTMLInputElement>(null);
  const artInput = useRef<HTMLInputElement>(null);
  const [tagText, setTagText] = useState(draft.tags.join(", "));
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /* Whether the database is the version this build writes against. Asked here as well as
     at boot, because the studio is where a stale schema actually bites. */
  const [schema, setSchema] = useState<SchemaState | null>(null);
  useEffect(() => {
    let live = true;
    void checkSchema().then((state) => {
      if (live) setSchema(state);
    });
    return () => {
      live = false;
    };
  }, []);
  const schemaBlocked = schemaProblem(schema);

  const saving = useStudio((s) => s.saving);
  const draftError = useStudio((s) => s.draftError);
  const saveDraftNow = useStudio((s) => s.saveDraft);

  /* Whatever is still in the debounce window is written before the tab goes away or the
     page is hidden: closing the laptop a second after typing should not lose the typing. */
  useEffect(() => {
    const flush = () => void flushDraftSave();
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);

  /* What publishing actually requires, checked in one place so the button can say why
     it is off instead of the database saying it afterwards. */
  const checklist = [
    {
      id: "audio",
      ok: Boolean(draft.audioPath),
      label: "A recording (mp3) is attached",
      todo: "Upload the mp3 in step 1. Nothing publishes without it.",
    },
    {
      id: "title",
      ok: draft.title.trim().length >= 2,
      label: "A title",
      todo: "Give it a title in step 3 — two characters or more.",
    },
    {
      id: "lines",
      ok: draft.lines.some(
        (line) => line.tr.trim() || line.ar.trim() || line.en.trim(),
      ),
      label: "At least one line of the words",
      todo: "Add a line in step 4, or paste the lyrics in.",
    },
  ];
  const missing = checklist.filter((item) => !item.ok);

  useEffect(() => {
    setTagText(draft.tags.join(", "));
  }, [draft.tags.join(",")]);

  useEffect(() => {
    if (account) void loadMine();
  }, [account?.id]);

  /* the recording measures itself: while the draft plays, the player knows how long it is */
  useEffect(() => {
    if (player.trackId !== "preview_current_draft") return;
    if (player.duration > 0)
      setDraft({ durationMs: Math.round(player.duration * 1000) });
  }, [player.trackId, player.duration]);

  if (!account) {
    return (
      <EmptyState
        icon="mic"
        title="Publishing needs an account"
        msg="Sign in to upload a recording — the studio keeps your draft, and the catalogue keeps what you publish."
        action={
          <button
            className="btn btn-primary mt-1 px-4 py-2.5"
            onClick={() =>
              requestAuth({ label: "Sign in to publish" }, "signup")
            }
          >
            <Icon name="user" size={14} /> Create an account
          </button>
        }
      />
    );
  }

  const onPickAudio = async (file: File | undefined) => {
    if (!file) return;
    setBusyUpload(true);
    const ok = await attachAudio(file);
    setBusyUpload(false);
    if (ok)
      toast.push({ title: "Recording uploaded", msg: file.name, kind: "ok" });
    else if (file.name.toLowerCase().endsWith(".mp3"))
      toast.push({ title: "That upload did not finish", kind: "warn" });
  };

  const onPickArt = async (file: File | undefined) => {
    if (!file) return;
    setBusyUpload(true);
    const ok = await attachArtwork(file);
    setBusyUpload(false);
    if (ok) toast.push({ title: "Cover art uploaded", kind: "ok" });
  };

  const previewDraft = () => {
    const song = previewDraftInPlayer();
    if (!song) {
      toast.push({ title: "Upload the mp3 first", kind: "warn" });
      return;
    }
    usePlayer
      .getState()
      .playTrack(song.id, { kind: "studio", label: "Your draft" }, [song.id]);
  };

  /** Mark the line the recording is on right now — the only honest way to time a lyric. */
  const stampLine = (index: number) => {
    if (player.trackId !== "preview_current_draft") {
      toast.push({
        title: "Preview the draft first",
        msg: "Timings are taken from the recording's own clock.",
        kind: "info",
      });
      return;
    }
    setLine(index, { t: Math.max(0, Math.round(player.time)) });
  };

  const importLyrics = () => {
    const lines: DraftLine[] = paste
      .split(/\n/)
      .map((row) => row.trim())
      .filter(Boolean)
      .slice(0, 40)
      .map((row) => {
        // "transliteration | arabic | translation" is what people paste; anything else
        // is treated as the transliteration on its own
        const [a = "", b = "", c = ""] = row
          .split("|")
          .map((part) => part.trim());
        const arabic = /[\u0600-\u06FF]/.test(a) ? a : b;
        const tr = /[\u0600-\u06FF]/.test(a) ? c || b : a;
        const en = /[\u0600-\u06FF]/.test(a) ? "" : c;
        return { tr, ar: arabic ?? "", en, note: "", t: null };
      });
    if (!lines.length) return;
    setDraft({ lines });
    setPaste("");
    setShowPaste(false);
    toast.push({
      title: `${plural(lines.length, "line")} imported`,
      kind: "ok",
    });
  };

  const onPublish = async () => {
    const song = await publish();
    if (song) {
      toast.push({
        title: "Published",
        msg: "It is in the catalogue now.",
        kind: "ok",
      });
      await loadMine(true);
    }
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    await api.removeSong(id, true);
    await loadMine(true);
    toast.push({
      title: "Taken down",
      msg: "The row and its files are gone.",
      kind: "info",
    });
  };

  const timedCount = draft.lines.filter(
    (line) => typeof line.t === "number",
  ).length;

  return (
    <div className="space-y-8 pb-4">
      <SectionHeader
        label="studio"
        title="Publish a recording"
        subtitle="An mp3 you uploaded, with the words. Nothing here is generated for you."
        action={
          <div className="flex items-center gap-2">
            {/* The header used to say "draft saved …" whenever a save had *ever* worked,
                which was a lie the moment one started failing. It now reports the state
                it is actually in. */}
            {draftError ? (
              <button
                type="button"
                onClick={() => void saveDraftNow()}
                className="hidden items-center gap-1.5 rounded-full border border-madder/40 bg-madder/10 px-2.5 py-1 text-[11px] font-semibold text-madder sm:inline-flex"
                title={draftError}
              >
                <Icon name="info" size={12} /> Not saved — retry
              </button>
            ) : saving ? (
              <span className="hidden items-center gap-1.5 text-[11px] text-muted sm:inline-flex">
                <Icon name="clock" size={12} className="animate-pulse" />{" "}
                saving…
              </span>
            ) : savedAt ? (
              <span className="hidden items-center gap-1.5 text-[11px] text-muted sm:inline-flex">
                <Icon
                  name="check"
                  size={12}
                  strokeWidth={3}
                  className="text-jade"
                />{" "}
                draft saved {relativeTime(savedAt)}
              </span>
            ) : null}
            <button
              className="btn btn-ghost px-3 py-2"
              onClick={() => {
                void resetDraft();
                toast.push({ title: "Draft cleared", kind: "info" });
              }}
            >
              <Icon name="trash" size={14} /> Discard
            </button>
          </div>
        }
      />

      {draftError ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-madder/40 bg-madder/[0.06] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-text2">
          <Icon name="info" size={14} className="mt-0.5 shrink-0 text-madder" />
          <div className="min-w-0">
            <p className="font-semibold text-text">
              Your draft is not being saved
            </p>
            <p className="mt-0.5 text-muted">{draftError}</p>
          </div>
          <button
            className="btn btn-ghost ml-auto shrink-0 !px-3 !py-1.5 !text-[11.5px]"
            onClick={() => void saveDraftNow()}
          >
            Try again
          </button>
        </div>
      ) : null}

      {schemaBlocked ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-gold/40 bg-gold/[0.07] px-3.5 py-3 text-[12.5px] leading-relaxed text-text2">
          <Icon name="server" size={15} className="mt-0.5 shrink-0 text-gold" />
          <div className="min-w-0">
            <p className="font-semibold text-text">
              The database needs updating before anything can be published
            </p>
            <p className="mt-0.5 text-muted">{schemaBlocked}</p>
            <SetupSqlButton />
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- recording */}
      <section className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="label mb-1">step 1 — the recording</div>
            <h2 className="font-display text-[1.25rem] text-text">
              An mp3 file
            </h2>
            <p className="mt-1 max-w-prose text-[12.5px] leading-relaxed text-muted">
              `.mp3` only, up to 5 MB. Anything larger is re-encoded in your
              browser — at the best bitrate that fits — before it uploads, and a
              recording that already fits is sent exactly as it is. It lives in
              the `nasheed-audio` bucket, and the player streams the file
              itself.
            </p>
          </div>
          {draft.audioPath ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-jade/40 bg-jade/[0.08] px-2.5 py-1 text-[11px] font-semibold text-jadesoft">
              <Icon name="check" size={12} />{" "}
              {draft.durationMs
                ? formatTime(draft.durationMs / 1000)
                : "uploaded"}
              {draft.audioBytes ? ` · ${humanBytes(draft.audioBytes)}` : ""}
            </span>
          ) : null}
        </div>

        <input
          ref={audioInput}
          type="file"
          accept="audio/mpeg,.mp3"
          className="hidden"
          onChange={(e) => void onPickAudio(e.target.files?.[0])}
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="btn btn-primary px-4 py-2.5"
            onClick={() => audioInput.current?.click()}
            disabled={busyUpload}
          >
            {preparing ? (
              <>
                <Icon name="waveform" size={15} className="animate-pulse" />
                {uploadProgress === null
                  ? "Reading the recording…"
                  : `Compressing — ${Math.round(uploadProgress * 100)}%`}
              </>
            ) : (
              <>
                <Icon name="upload" size={15} />{" "}
                {draft.audioPath ? "Replace the mp3" : "Choose an mp3"}
              </>
            )}
          </button>
          <button
            className="btn btn-ghost px-4 py-2.5"
            onClick={previewDraft}
            disabled={!draft.audioPath && !draft.songId}
          >
            <Icon name="play" size={15} /> Listen to the draft
          </button>
          {draft.audioPath ? (
            <button
              className="btn btn-ghost px-3 py-2.5"
              onClick={() => clearAudio()}
            >
              <Icon name="close" size={14} /> Remove
            </button>
          ) : null}
        </div>

        {player.trackId === "preview_current_draft" ? (
          <p className="mt-3 flex items-center gap-2 text-[11.5px] text-muted">
            <Icon name="info" size={13} className="text-gold" />
            Playing through the real player. Use <em>mark</em> beside a line to
            take its timing from here
            {player.time > 0 ? ` (${formatTime(player.time)})` : ""}.
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------------------- cover */}
      <section className="card p-4 sm:p-5">
        <div className="label mb-1">step 2 — cover art, if you have any</div>
        <div className="mt-3 flex items-center gap-4">
          <div className="h-[92px] w-[92px] overflow-hidden rounded-xl border border-line">
            <CoverArt
              path={draft.artworkPath}
              title={draft.title || account.name}
              className="h-full w-full"
            />
          </div>
          <div className="min-w-0">
            <input
              ref={artInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              className="hidden"
              onChange={(e) => void onPickArt(e.target.files?.[0])}
            />
            <button
              className="btn btn-ghost px-3.5 py-2"
              onClick={() => artInput.current?.click()}
              disabled={busyUpload}
            >
              <Icon name="upload" size={14} />{" "}
              {draft.artworkPath ? "Replace the image" : "Choose an image"}
            </button>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              PNG, JPEG, WebP or AVIF, up to 2 MB — anything heavier is scaled
              down here before it uploads. Without one, the tile shows the
              title&apos;s first letter.
            </p>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- details */}
      <section className="card p-4 sm:p-5">
        <div className="label mb-1">step 3 — what it is</div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-text2">
              Title
            </span>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ title: e.target.value })}
              placeholder="e.g. Ṭalʿa al-Badru ʿAlaynā"
              className="w-full rounded-xl border border-line bg-surface2/60 px-3 py-2.5 text-[13.5px] outline-none focus:border-jade/45"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-text2">
              Title in Arabic
            </span>
            <input
              value={draft.titleAr}
              onChange={(e) => setDraft({ titleAr: e.target.value })}
              dir="rtl"
              className="arabic w-full rounded-xl border border-line bg-surface2/60 px-3 py-2.5 text-[15px] outline-none focus:border-jade/45"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-text2">
              Tags
            </span>
            <input
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              onBlur={() => setTags(tagText)}
              placeholder="morning, traditional, salawat"
              className="w-full rounded-xl border border-line bg-surface2/60 px-3 py-2.5 text-[13.5px] outline-none focus:border-jade/45"
            />
            <span className="mt-1 block text-[11px] text-muted">
              Up to eight, comma separated.
            </span>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[12px] font-semibold text-text2">
              A note about the recording
            </span>
            <textarea
              value={draft.note}
              onChange={(e) => setDraft({ note: e.target.value })}
              rows={2}
              placeholder="Where it was recorded, who is singing, anything a listener should know."
              className="w-full resize-y rounded-xl border border-line bg-surface2/60 px-3 py-2.5 text-[13.5px] outline-none focus:border-jade/45"
            />
          </label>
        </div>

      </section>

      {/* ----------------------------------------------------------- lyrics */}
      <section className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="label mb-1">step 4 — the words</div>
            <h2 className="font-display text-[1.25rem] text-text">Lyrics</h2>
            <p className="mt-1 max-w-prose text-[12.5px] leading-relaxed text-muted">
              Timings are optional. Give a line a time and the lyric view
              follows the recording; leave them off and the words are simply
              shown in order.
              {timedCount ? ` ${plural(timedCount, "line")} timed.` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost px-3 py-2"
              onClick={() => setShowPaste((v) => !v)}
            >
              <Icon name="file" size={14} /> Paste lyrics
            </button>
            <button
              className="btn btn-ghost px-3 py-2"
              onClick={() => addLine()}
            >
              <Icon name="plus" size={14} /> Add a line
            </button>
          </div>
        </div>

        {showPaste ? (
          <div className="mt-4 rounded-xl border border-line bg-surface2/40 p-3">
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={6}
              placeholder={
                "one line per row\ntransliteration | العربية | translation"
              }
              className="w-full resize-y rounded-lg border border-line bg-bg/60 px-3 py-2.5 font-mono text-[12.5px] outline-none focus:border-jade/45"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                className="btn btn-primary px-3.5 py-2"
                onClick={importLyrics}
                disabled={!paste.trim()}
              >
                Import
              </button>
              <button
                className="btn btn-ghost px-3 py-2"
                onClick={() => setShowPaste(false)}
              >
                Cancel
              </button>
              <span className="text-[11px] text-muted">
                Separate columns with a pipe. Arabic is detected.
              </span>
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {draft.lines.map((line, index) => (
            <div
              key={index}
              className="rounded-xl border border-line bg-surface2/30 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
                  line {index + 1}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="btn-icon rounded-full p-1.5 text-muted hover:text-text2"
                    onClick={() => moveLine(index, index - 1)}
                    disabled={index === 0}
                    aria-label="Move up"
                  >
                    <Icon name="chevronUp" size={14} />
                  </button>
                  <button
                    className="btn-icon rounded-full p-1.5 text-muted hover:text-text2"
                    onClick={() => moveLine(index, index + 1)}
                    disabled={index === draft.lines.length - 1}
                    aria-label="Move down"
                  >
                    <Icon name="chevronDown" size={14} />
                  </button>
                  <button
                    className="btn-icon rounded-full p-1.5 text-muted hover:text-madder"
                    onClick={() => removeLine(index)}
                    aria-label="Remove line"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={line.tr}
                  onChange={(e) => setLine(index, { tr: e.target.value })}
                  placeholder="transliteration"
                  className="rounded-lg border border-line bg-bg/50 px-3 py-2 text-[13px] outline-none focus:border-jade/45"
                />
                <input
                  value={line.ar}
                  onChange={(e) => setLine(index, { ar: e.target.value })}
                  dir="rtl"
                  placeholder="العربية"
                  className="arabic rounded-lg border border-line bg-bg/50 px-3 py-2 text-[14px] outline-none focus:border-jade/45"
                />
                <input
                  value={line.en}
                  onChange={(e) => setLine(index, { en: e.target.value })}
                  placeholder="translation"
                  className="rounded-lg border border-line bg-bg/50 px-3 py-2 text-[13px] outline-none focus:border-jade/45"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={line.t ?? ""}
                    onChange={(e) =>
                      setLine(index, {
                        t:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="seconds"
                    className="w-24 rounded-lg border border-line bg-bg/50 px-3 py-2 text-[13px] tabular-nums outline-none focus:border-jade/45"
                  />
                  <button
                    className="btn btn-ghost px-2.5 py-2 !text-[11px]"
                    onClick={() => stampLine(index)}
                    title="Take the timing from the preview"
                  >
                    <Icon name="clock" size={13} /> mark
                  </button>
                  <input
                    value={line.note}
                    onChange={(e) => setLine(index, { note: e.target.value })}
                    placeholder="attribution"
                    list="studio-notes"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-bg/50 px-3 py-2 text-[12.5px] outline-none focus:border-jade/45"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <datalist id="studio-notes">
          {NOTE_SUGGESTIONS.map((note) => (
            <option key={note} value={note} />
          ))}
        </datalist>

        {draft.lines.some((line) => line.tr || line.ar || line.en) ? (
          <div className="mt-5 rounded-xl border border-line bg-surface2/20 p-4">
            <div className="label mb-2">how it reads</div>
            <LyricPreview
              song={{
                ...(getTrack(draft.songId ?? "") ?? previewDraftInPlayer()!),
                lines: draft.lines
                  .filter((line) => line.tr || line.ar || line.en)
                  .map<LyricLine>((line) => ({
                    ...(line.tr ? { tr: line.tr } : {}),
                    ...(line.ar ? { ar: line.ar } : {}),
                    ...(line.en ? { en: line.en } : {}),
                    ...(line.note ? { note: line.note } : {}),
                    ...(typeof line.t === "number" ? { t: line.t } : {}),
                  })),
              }}
              count={4}
            />
          </div>
        ) : null}
      </section>

      {/* ---------------------------------------------------------- publish */}
      <section className="card p-4 sm:p-5">
        <div className="label mb-1">step 5 — publish</div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[1.25rem] text-text">
              {missing.length
                ? "Almost there"
                : draft.songId
                  ? "Everything is in place"
                  : "Ready to publish"}
            </h2>
            <p className="mt-1 max-w-prose text-[12.5px] leading-relaxed text-muted">
              {draft.songId
                ? "You are editing a published nasheed."
                : "A new nasheed, live as soon as you publish it."}{" "}
              Timings are a nicety, not a requirement: you never have to press
              play or use “mark” to publish.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost px-3.5 py-2.5"
              onClick={() => void saveDraftNow()}
            >
              <Icon name="download" size={14} /> Save draft
            </button>
            <button
              className="btn btn-primary px-5 py-2.5"
              onClick={() => void onPublish()}
              disabled={publishing || !checklist.every((item) => item.ok)}
              title={missing.length ? missing[0]!.todo : undefined}
            >
              <Icon name={publishing ? "clock" : "upload"} size={15} />{" "}
              {draft.songId ? "Save changes" : "Publish"}
            </button>
          </div>
        </div>

        {/* The list, in the order the steps are in, so "why is this button off?" is
            answered on screen rather than by a constraint name from Postgres. */}
        <ul className="mt-4 grid gap-1.5 sm:grid-cols-3">
          {checklist.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2 rounded-xl border border-line bg-surface2/30 px-3 py-2"
            >
              <span
                className={clsx(
                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                  item.ok
                    ? "border-jade/50 bg-jade/20 text-jade"
                    : "border-line2 text-muted",
                )}
              >
                {item.ok ? (
                  <Icon name="check" size={10} strokeWidth={3} />
                ) : null}
              </span>
              <span className="min-w-0">
                <span
                  className={clsx(
                    "block text-[12px] leading-snug",
                    item.ok ? "text-text2" : "text-text",
                  )}
                >
                  {item.label}
                </span>
                {!item.ok ? (
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                    {item.todo}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------ mine */}
      <section>
        <SectionHeader
          label="what you have published"
          title="Your nasheeds"
          subtitle={loading ? "loading…" : plural(entries.length, "recording")}
        />
        {entries.length ? (
          <div className="space-y-2">
            {entries.map((song) => (
              <div key={song.id} className="card flex items-center gap-3 p-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-line">
                  <CoverArt
                    path={song.artworkPath}
                    title={song.title}
                    className="h-full w-full"
                    rounded="sm"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/t/${song.id}`}
                    className="block truncate text-[13.5px] font-semibold text-text hover:text-jadesoft"
                  >
                    {song.title}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
                    <span>{song.status === "live" ? "live" : "removed"}</span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">
                      {formatTime((song.durationMs ?? 0) / 1000)}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{song.plays} plays</span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{song.likes} loves</span>
                    <span aria-hidden>·</span>
                    <span>{song.notes} notes</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    className="btn btn-ghost px-3 py-2 !text-[11.5px]"
                    onClick={() => {
                      startEdit(song.id);
                      toast.push({
                        title: "Loaded into the editor",
                        msg: song.title,
                        kind: "info",
                      });
                    }}
                  >
                    <Icon name="pencil" size={13} /> Edit
                  </button>
                  {song.status === "live" ? (
                    <button
                      className="btn btn-ghost px-3 py-2 !text-[11.5px]"
                      onClick={() => void unpublish(song.id)}
                    >
                      <Icon name="eyeOff" size={13} /> Take down
                    </button>
                  ) : null}
                  {confirmDelete === song.id ? (
                    <span className="flex items-center gap-1">
                      <button
                        className="btn btn-ghost px-3 py-2 !text-[11.5px] text-madder"
                        onClick={() => void remove(song.id)}
                      >
                        Delete for good
                      </button>
                      <button
                        className="btn-icon rounded-full p-1.5"
                        onClick={() => setConfirmDelete(null)}
                        aria-label="Cancel"
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn-icon rounded-full p-2 text-muted hover:text-madder"
                      onClick={() => setConfirmDelete(song.id)}
                      aria-label="Delete"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <p className="pt-1 text-[11.5px] text-muted">
              Total listening time across your nasheeds:{" "}
              {formatTotal(
                entries.reduce(
                  (sum, song) =>
                    sum +
                    (song.plays
                      ? ((song.durationMs ?? 0) / 1000) * song.plays
                      : 0),
                  0,
                ),
              )}
              .
            </p>
          </div>
        ) : (
          <EmptyState
            icon="mic"
            title="Nothing published yet"
            msg="Upload an mp3 above and it will appear here — and in the catalogue — the moment you publish it."
          />
        )}
      </section>
    </div>
  );
}
