import { Modal } from "./ui/Primitives";
import { useUi } from "../store/ui";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Playback",
    rows: [
      ["Space", "Play / pause"],
      ["N", "Next nasheed"],
      ["B", "Previous nasheed"],
      ["← / →", "Seek 5 seconds"],
      ["Shift + ← / →", "Previous / next track"],
      ["I", "Open the immersive player"],
      ["L", "Love the current nasheed"],
      ["M", "Mute / unmute"],
    ],
  },
  {
    title: "Navigation",
    rows: [
      ["⌘ / Ctrl + K", "Command palette"],
      ["/", "Focus search"],
      ["G", "Ask Nūr for a mix"],
      ["Esc", "Close any overlay"],
      ["?", "This sheet"],
    ],
  },
  {
    title: "In the lyrics view",
    rows: [
      ["Click a line", "Jump the voice to that line"],
      ["L / Q", "Lyrics / Queue tab"],
      ["Rail dots", "Jump between phrases"],
    ],
  },
];

export function ShortcutsSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcuts);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard" subtitle="Everything the app can do without a mouse.">
      <div className="space-y-5 p-5">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <div className="label mb-2">{g.title}</div>
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {g.rows.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4 bg-surface2/30 px-3.5 py-2">
                  <span className="text-[13px] text-text2">{label}</span>
                  <kbd className="shrink-0 rounded-md border border-line2 bg-elev px-2 py-0.5 font-sans text-[11px] font-semibold text-text">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </section>
        ))}
        <p className="text-[11.5px] leading-relaxed text-muted">
          Shortcuts are ignored while you are typing in a field. Everything here also works from the command palette.
        </p>
      </div>
    </Modal>
  );
}
