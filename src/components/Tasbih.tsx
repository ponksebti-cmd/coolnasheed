import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Icon } from "./ui/Icons";
import { DropdownMenu } from "./ui/Menu";
import { DHIKR, useLibrary } from "../store/library";

/**
 * A pocket tasbīḥ counter.
 *
 * The count belongs to the account, not to this browser: it is a row in
 * `dhikr_counts`, so it survives a cleared cache and follows you to the next device.
 * Signed out it still counts, in memory, and is written the moment there is an
 * account to write it to.
 */
export function Tasbih({ className }: { className?: string }) {
  const active = useLibrary((s) => s.dhikrActive);
  const counts = useLibrary((s) => s.dhikr);
  const tasbihTick = useLibrary((s) => s.dhikrTick);
  const tasbihReset = useLibrary((s) => s.dhikrReset);
  const tasbihSet = useLibrary((s) => s.dhikrSelect);
  const phrase = DHIKR.find((d) => d.id === active) ?? DHIKR[0]!;
  const tasbih = counts[phrase.id] ?? { count: 0, target: phrase.target };
  const [pulse, setPulse] = useState(0);
  const holdTimer = useRef<number | null>(null);

  const progress = Math.min(1, tasbih.count / phrase.target);
  const circumference = 2 * Math.PI * 26;

  useEffect(() => () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); }, []);

  const tick = () => {
    const n = tasbihTick();
    setPulse((p) => p + 1);
    if (window.navigator.vibrate) window.navigator.vibrate(n % phrase.target === 0 ? [12, 40, 12] : 6);
  };

  return (
    <div className={clsx("relative rounded-xl border border-line bg-surface2/50 p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label flex items-center gap-1.5">
          <Icon name="beads" size={12} className="text-gold" /> tasbīḥ
        </span>
        <DropdownMenu
          label="Choose dhikr"
          size={14}
          buttonClass="!p-1"
          items={[
            ...DHIKR.map((d) => ({
              label: d.tr,
              hint: String(d.target),
              checked: d.id === phrase.id,
              onClick: () => tasbihSet(d.id),
            })),
            { label: "Reset count", icon: "trash" as const, danger: true, onClick: () => tasbihReset() },
          ]}
        />
      </div>

      <button
        className="flex w-full items-center gap-3 text-left"
        onClick={tick}
        onContextMenu={(e) => {
          e.preventDefault();
          tasbihReset();
        }}
        onPointerDown={() => {
          holdTimer.current = window.setTimeout(() => {
            tasbihReset();
            holdTimer.current = null;
          }, 900);
        }}
        onPointerUp={() => {
          if (holdTimer.current) window.clearTimeout(holdTimer.current);
        }}
        onPointerLeave={() => {
          if (holdTimer.current) window.clearTimeout(holdTimer.current);
        }}
        aria-label={`Tasbīḥ counter, currently ${tasbih.count}. Tap to count ${phrase.tr}.`}
      >
        <span className="relative grid h-[62px] w-[62px] shrink-0 place-items-center">
          <svg viewBox="0 0 60 60" className="absolute inset-0 -rotate-90">
            <circle cx="30" cy="30" r="26" fill="none" stroke="var(--c-line-2)" strokeWidth="3" />
            <circle
              cx="30"
              cy="30"
              r="26"
              fill="none"
              stroke="url(#tasbih-grad)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              style={{ transition: "stroke-dashoffset 320ms cubic-bezier(.2,.8,.2,1)" }}
            />
            <defs>
              <linearGradient id="tasbih-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--c-jade-soft)" />
                <stop offset="100%" stopColor="var(--c-gold)" />
              </linearGradient>
            </defs>
          </svg>
          <span
            key={pulse}
            className="relative text-[17px] font-extrabold tabular-nums text-text"
            style={{ animation: "riseIn 260ms cubic-bezier(.2,.9,.2,1)" }}
          >
            {tasbih.count}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="arabic block truncate text-[15px] leading-tight text-goldsoft/90" dir="rtl">
            {phrase.ar}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] font-medium text-text2">{phrase.tr}</span>
          <span className="mt-0.5 block truncate text-[10.5px] text-muted">{phrase.en}</span>
        </span>
      </button>

      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted">
        <span className="tabular-nums">
          {tasbih.count} / {phrase.target}
        </span>
        <span className="flex items-center gap-2">
          {progress >= 1 ? <span className="font-semibold text-jade">complete</span> : <span>hold to reset</span>}
          <button
            onClick={() => tasbihReset()}
            className="btn-icon rounded-full p-0.5"
            aria-label="Reset tasbīḥ"
            title="Reset to zero"
          >
            <Icon name="repeat" size={12} />
          </button>
        </span>
      </div>
    </div>
  );
}
