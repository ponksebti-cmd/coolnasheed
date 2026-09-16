import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../components/ui/Icons";
import { EmptyState, SectionHeader, Tabs, useToast } from "../components/ui/Primitives";
import { Avatar } from "../components/art/CoverArt";
import { TrackList } from "../components/track/TrackViews";
import { useAccount } from "../lib/hooks";
import { useUi } from "../store/ui";
import { useSession } from "../store/session";
import { useStudio } from "../store/studio";
import { useCommunity, timeAgoLabel } from "../store/community";
import { useLibrary } from "../store/library";
import { getTrack } from "../data/catalog";
import { plural } from "../lib/format";
import type { Track } from "../data/types";

type TabId = "nasheeds" | "notes" | "playlists" | "loved" | "settings";

const TABS: { id: TabId; label: string }[] = [
  { id: "nasheeds", label: "Nasheeds" },
  { id: "notes", label: "Notes" },
  { id: "playlists", label: "Playlists" },
  { id: "loved", label: "Loved" },
  { id: "settings", label: "Settings" },
];

export default function ProfilePage() {
  const account = useAccount();
  const navigate = useNavigate();
  const toast = useToast();
  const requestAuth = useUi((s) => s.requestAuth);
  const [params, setParams] = useSearchParams();

  const tab = (params.get("tab") as TabId | null) ?? "nasheeds";
  const setTab = (id: TabId) => setParams(id === "nasheeds" ? {} : { tab: id }, { replace: true });

  const entries = useStudio((s) => s.entries);
  const loadEntries = useStudio((s) => s.loadMine);
  const unpublish = useStudio((s) => s.unpublish);
  const myNotes = useCommunity((s) => s.mine);
  const loadNotes = useCommunity((s) => s.loadMine);
  const deleteComment = useCommunity((s) => s.deleteComment);
  const stats = useSession((s) => s.stats);
  const library = useLibrary();

  useEffect(() => {
    void loadEntries();
    void loadNotes();
  }, [loadEntries, loadNotes]);


  const published = useMemo(
    () => (account ? entries.filter((entry) => entry.ownerId === account.id) : []),
    [entries, account],
  );
  const mine = useMemo(() => (account ? myNotes.filter((c) => c.authorId === account.id) : []), [myNotes, account]);
  const loved = useMemo(() => library.liked.map((id) => getTrack(id)).filter((t): t is Track => !!t), [library.liked]);
  const amensGiven = stats?.amens ?? 0;
  const plays = library.history.reduce((n, h) => n + h.count, 0);

  if (!account) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="label">you</div>
          <h1 className="text-2xl text-text sm:text-3xl">Nobody signed in</h1>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted">
            You can listen to everything and search the whole catalogue without an account — that part never asks. A
            profile is only for the things that belong to someone: nasheeds you publish, notes you leave, sets you
            build.
          </p>
        </div>
        <EmptyState
          icon="user"
          title="Sign in to see a profile"
          msg="An account is an email, a password and a handle. Everything you keep is stored under it, and nothing is kept on this device."
          action={
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <button className="btn btn-primary !px-5 !py-3" onClick={() => requestAuth({ label: "Create an account" }, "signup")}>
                <Icon name="sparkle" size={15} /> Create an account
              </button>
              <button className="btn btn-ghost !px-5 !py-3" onClick={() => requestAuth({ label: "Sign in" }, "signin")}>
                <Icon name="user" size={15} /> Sign in
              </button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* identity */}
      <header className="relative overflow-hidden rounded-2xl border border-line bg-surface/40">
        <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-6">
          <Avatar name={account.name} size={96} className="!text-[2rem] ring-1 ring-line2" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl text-text sm:text-3xl">{account.name}</h1>
              <span className="chip">
                <Icon name="check" size={10} strokeWidth={3} /> signed in
              </span>
            </div>
            <div className="mt-1 text-[13px] text-muted">
              @{account.handle}
              {account.city ? <span> · {account.city}</span> : null}
              <span> · joined {new Date(account.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
            </div>
            {account.bio ? <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-text2">{account.bio}</p> : null}
          </div>
          <div className="flex gap-2">
            <Link to="/studio" className="btn btn-primary !px-4 !py-2.5">
              <Icon name="mic" size={14} /> Publish
            </Link>
            <button className="btn btn-ghost !px-3.5 !py-2.5" onClick={() => setTab("settings")} aria-label="Profile settings">
              <Icon name="sliders" size={15} />
            </button>
          </div>
        </div>
        <dl className="relative grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          {[
            [String(published.length), "published"],
            [String(mine.length), "notes"],
            [String(loved.length), "loved"],
            [String(plays), "plays"],
          ].map(([v, k]) => (
            <div key={k} className="bg-bg2/70 px-4 py-3 text-center">
              <dt className="text-lg text-text tabular-nums">{v}</dt>
              <dd className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{k}</dd>
            </div>
          ))}
        </dl>
      </header>

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="w-full overflow-x-auto" />

      {tab === "nasheeds" ? (
        published.length ? (
          <section className="space-y-3">
            <SectionHeader
              label="published"
              title={plural(published.length, "nasheed")}
              subtitle="Your uploads. They sit in the catalogue like anything else, and you can take any of them down."
            />
            <TrackList tracks={published} context={{ kind: "studio", label: "Your nasheeds" }} showHeader={false} />
            <ul className="space-y-1.5">
              {published.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                  <Link to={`/t/${t.id}`} className="truncate text-text2 hover:text-jadesoft">
                    {t.title}
                  </Link>
                  <span>·</span>
                  <span>
                    {t.status === "live" ? "live" : "draft"}
                    {t.durationMs ? ` · ${Math.round(t.durationMs / 1000)}s` : ""}
                  </span>
                  <button
                    className="ml-auto flex items-center gap-1 rounded-full border border-line px-2.5 py-1 transition-colors hover:border-madder/50 hover:text-madder"
                    onClick={() => {
                      void unpublish(t.id).then(() => toast.push({ title: "Taken down", msg: t.title, kind: "info" }));
                    }}
                  >
                    <Icon name="trash" size={11} /> take down
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <EmptyState
            icon="mic"
            title="Nothing published yet"
            msg="Upload an mp3, give it a title and the words, and it is in the catalogue."
            action={
              <Link to="/studio" className="btn btn-primary mt-1 !px-5 !py-3">
                <Icon name="upload" size={15} /> Open the studio
              </Link>
            }
          />
        )
      ) : null}

      {tab === "notes" ? (
        mine.length ? (
          <section className="space-y-3">
            <SectionHeader label="your notes" title={plural(mine.length, "note")} subtitle={`${amensGiven} amens given to other people's.`} />
            <ul className="space-y-2.5">
              {mine.map((c) => {
                const track = getTrack(c.trackId);
                return (
                  <li key={c.id} className="rounded-xl border border-line bg-surface/50 p-3.5">
                    <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                      {track ? (
                        <Link to={`/t/${track.id}`} className="font-semibold text-text2 hover:text-jadesoft">
                          {track.title}
                        </Link>
                      ) : (
                        <span className="text-muted">a nasheed that is gone</span>
                      )}
                      <span className="text-muted">{timeAgoLabel(c.at)}</span>
                      {c.atLine ? <span className="text-muted">· line {c.atLine}</span> : null}
                      <span className="ml-auto flex items-center gap-1 text-muted">
                        <Icon name="star" size={11} /> {c.amens}
                      </span>
                      <button
                        className="flex items-center gap-1 text-muted transition-colors hover:text-madder"
                        onClick={() => {
                          void deleteComment(c.id).then((done) => {
                            if (done) toast.push({ title: "Note deleted", kind: "info" });
                          });
                        }}
                        aria-label="Delete this note"
                      >
                        <Icon name="trash" size={12} /> delete
                      </button>
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-text2">{c.text}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <EmptyState icon="lyrics" title="No notes yet" msg="Open a nasheed and say what it did to you. Your notes are stored under your account." />
        )
      ) : null}

      {tab === "playlists" ? (
        library.playlists.length ? (
          <section className="space-y-3">
            <SectionHeader label="your sets" title={plural(library.playlists.length, "playlist")} />
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {library.playlists.map((pl) => (
                <li key={pl.id}>
                  <Link
                    to={`/p/${pl.id}`}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface/50 p-3 transition-colors hover:border-line2"
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface2 ring-1 ring-line2">
                      <Icon name="library" size={17} className="text-muted" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-text">{pl.name}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted">{plural(pl.trackIds.length, "nasheed")}</span>
                    </span>
                    <Icon name="chevronRight" size={15} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <EmptyState icon="library" title="No playlists" msg="Copy your loved list into a set of your own, or build one as you listen." />
        )
      ) : null}

      {tab === "loved" ? (
        loved.length ? (
          <TrackList tracks={loved} context={{ kind: "liked", label: "Your loved nasheeds" }} showHeader={false} />
        ) : (
          <EmptyState icon="star" title="Nothing loved yet" msg="Tap the star on any nasheed and it collects here." />
        )
      ) : null}

      {tab === "settings" ? <Settings account={account.id} onSignedOut={() => navigate("/")} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ settings */

function Settings({ account: accountId, onSignedOut }: { account: string; onSignedOut: () => void }) {
  const account = useAccount();
  const update = useSession((s) => s.update);
  const changePassword = useSession((s) => s.changePassword);
  const deleteAccount = useSession((s) => s.deleteAccount);
  const signOut = useSession((s) => s.signOut);
  const busy = useSession((s) => s.busy);
  const toast = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(account?.name ?? "");
  const [bio, setBio] = useState(account?.bio ?? "");
  const [city, setCity] = useState(account?.city ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePw, setDeletePw] = useState("");

  if (!account) return null;
  void accountId;

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-line bg-surface/40 p-4 sm:p-5">
        <div className="label">profile</div>
        <label className="block">
          <span className="field-label">Name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
        </label>
        <label className="block">
          <span className="field-label">Bio</span>
          <textarea className="field scroll-slim resize-y" rows={2} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={220} placeholder="What you listen for." />
        </label>
        <label className="block">
          <span className="field-label">City</span>
          <input className="field" value={city} onChange={(e) => setCity(e.target.value)} maxLength={40} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-primary !px-4 !py-2.5"
            onClick={() => {
              update({ name: name.trim() || account.name, bio: bio.trim(), city: city.trim() });
              toast.push({ title: "Profile updated", kind: "ok" });
            }}
          >
            <Icon name="check" size={14} /> Save profile
          </button>
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <Icon name="info" size={12} /> Your handle cannot change — published nasheeds are filed under it.
          </span>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-line bg-surface/40 p-4 sm:p-5">
        <div className="label">password</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Current</span>
            <input className="field" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="block">
            <span className="field-label">New</span>
            <input className="field" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </label>
        </div>
        {pwMsg ? <p className="field-error">{pwMsg}</p> : null}
        <button
          className="btn btn-ghost !px-4 !py-2.5"
          disabled={busy}
          onClick={async () => {
            const res = await changePassword(current, next);
            if (!res.ok) {
              setPwMsg(res.msg);
              return;
            }
            setPwMsg(null);
            setCurrent("");
            setNext("");
            toast.push({ title: "Password changed", kind: "ok" });
          }}
        >
          <Icon name="sliders" size={14} /> Change password
        </button>
      </section>

      <section className="space-y-3 rounded-2xl border border-madder/30 bg-madder/[0.06] p-4 sm:p-5">
        <div className="label !text-madder">danger</div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-ghost !px-4 !py-2.5"
            onClick={() => {
              signOut();
              toast.push({ title: "Signed out", msg: "Your library stays on your account.", kind: "info" });
              onSignedOut();
            }}
          >
            <Icon name="close" size={14} /> Sign out
          </button>
          <button className="btn !px-4 !py-2.5 text-madder hover:bg-madder/12" onClick={() => setConfirmDelete((v) => !v)} aria-expanded={confirmDelete}>
            <Icon name="trash" size={14} /> Delete the account
          </button>
        </div>
        {confirmDelete ? (
          <div className="space-y-2 rounded-xl border border-madder/30 bg-bg2/60 p-3">
            <p className="text-[12.5px] leading-relaxed text-text2">
              This removes the account, and with it every nasheed you published, every note you left and everything you kept.
              It cannot be undone.
            </p>
            <input
              className="field"
              type="password"
              value={deletePw}
              onChange={(e) => setDeletePw(e.target.value)}
              placeholder="Your password, to confirm"
              autoComplete="current-password"
            />
            <button
              className="btn w-full !py-2.5 text-madder hover:bg-madder/12"
              disabled={busy || !deletePw}
              onClick={async () => {
                const gone = await deleteAccount();
                if (!gone) {
                  toast.push({ title: "Password did not match", msg: "The account is untouched.", kind: "warn" });
                  return;
                }
                toast.push({ title: "Account deleted", kind: "info" });
                navigate("/");
              }}
            >
              <Icon name="trash" size={14} /> Delete it for good
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
