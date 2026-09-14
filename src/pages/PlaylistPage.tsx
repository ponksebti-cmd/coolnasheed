import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Icon } from "../components/ui/Icons";
import { EmptyState, Modal, SectionHeader, useToast } from "../components/ui/Primitives";
import { HeroPanel } from "../components/collection/HeroPanel";
import { TrackList } from "../components/track/TrackViews";
import { getTrack } from "../data/catalog";
import { plural } from "../lib/format";
import { shuffle as shuffled, rngFrom } from "../lib/prng";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import type { Track } from "../data/types";

export default function PlaylistPage() {
  const { id } = useParams();
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id));
  const remove = useLibrary((s) => s.removeFromPlaylist);
  const rename = useLibrary((s) => s.renamePlaylist);
  const del = useLibrary((s) => s.deletePlaylist);
  const player = usePlayer();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(playlist?.name ?? "");
  const [confirming, setConfirming] = useState(false);

  const tracks = useMemo(
    () => (playlist ? playlist.trackIds.map((t) => getTrack(t)).filter((x): x is Track => !!x) : []),
    [playlist],
  );
  const ids = tracks.map((t) => t.id);

  if (!playlist) {
    return (
      <EmptyState
        icon="library"
        title="That set is gone"
        msg="Playlists live in this browser's storage. If you cleared it, they went with it."
        action={
          <Link to="/library" className="btn btn-primary mt-2 !px-4 !py-2.5">
            <Icon name="library" size={14} /> Library
          </Link>
        }
      />
    );
  }

  const inSet = player.trackId ? ids.includes(player.trackId) : false;

  return (
    <div className="space-y-9">
      <HeroPanel
        eyebrow="your set"
        title={playlist.name}
        blurb={playlist.blurb}
        seed={playlist.seed}
        accent={playlist.accent}
        tracks={tracks}
        playing={inSet && player.playing}
        onPlay={() => {
          if (!ids.length) return;
          if (inSet) player.toggle();
          else player.playIds(ids, 0, { kind: "queue", id: playlist.id, label: playlist.name });
        }}
        actions={[
          {
            label: "Shuffle",
            icon: "shuffle",
            onClick: () => {
              if (!ids.length) return;
              player.playIds(shuffled(rngFrom(playlist.seed), ids), 0, { kind: "queue", id: playlist.id, label: playlist.name });
            },
          },
          { label: "Rename", icon: "pencil", onClick: () => { setName(playlist.name); setRenaming(true); } },
          { label: "Delete", icon: "trash", onClick: () => setConfirming(true), tone: "ghost" },
        ]}
      />

      <section>
        <SectionHeader
          label="tracks"
          title={tracks.length ? playlist.name : "Nothing in here yet"}
          subtitle={tracks.length ? `${plural(tracks.length, "track")} · saved ${new Date(playlist.createdAt).toLocaleDateString()}` : undefined}
        />
        {tracks.length ? (
          <div className="panel rounded-2xl p-2 sm:p-3">
            <TrackList
              tracks={tracks}
              context={{ kind: "queue", id: playlist.id, label: playlist.name }}
              onRemoveAt={(i) => {
                const t = tracks[i]!;
                remove(playlist.id, t.id);
                toast.push({ title: "Removed from set", msg: t.title, kind: "info" });
              }}
            />
          </div>
        ) : (
          <EmptyState
            icon="plus"
            title="This set is empty"
            msg="Use the ⋯ menu on any nasheed to add it here, or let Nūr fill it for you."
            action={
              <Link to="/search" className="btn btn-primary mt-2 !px-4 !py-2.5">
                <Icon name="search" size={14} /> Find something
              </Link>
            }
          />
        )}
      </section>

      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename this set" subtitle="Only you will ever see it.">
        <div className="space-y-3 p-5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                rename(playlist.id, name.trim());
                setRenaming(false);
              }
            }}
            className="w-full rounded-xl border border-line2 bg-bg2 px-3.5 py-2.5 text-[14px] text-text outline-none focus:border-jade/50"
            placeholder="Set name"
          />
          <div className="flex gap-2">
            <button
              className="btn btn-primary flex-1 !py-2.5"
              disabled={!name.trim()}
              onClick={() => {
                rename(playlist.id, name.trim());
                setRenaming(false);
                toast.push({ title: "Renamed", msg: name.trim(), kind: "ok" });
              }}
            >
              Save
            </button>
            <button className="btn btn-ghost !py-2.5" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Delete this set?" subtitle={playlist.name}>
        <div className="space-y-4 p-5">
          <p className="text-[13px] leading-relaxed text-text2">
            The tracks stay in the catalogue; only your grouping disappears. This cannot be undone, because there is no server
            to undo it from.
          </p>
          <div className="flex gap-2">
            <button
              className="btn flex-1 !py-2.5 bg-madder text-white"
              onClick={() => {
                del(playlist.id);
                setConfirming(false);
                toast.push({ title: "Set deleted", msg: playlist.name, kind: "warn" });
              }}
            >
              <Icon name="trash" size={14} /> Delete
            </button>
            <button className="btn btn-ghost !py-2.5" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
