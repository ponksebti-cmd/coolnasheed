import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { Icon, type IconName } from "./Icons";
import { formatTime } from "../../lib/format";
import { clamp } from "../../lib/prng";

/* ------------------------------------------------------------------ Reveal */

export function Reveal({
  children,
  delay = 0,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-shown={shown}
      className={clsx("reveal", className)}
      style={{ transitionDelay: `${delay}ms`, ...style }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- Chip */

export function Chip({
  active,
  children,
  onClick,
  icon,
  className,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  icon?: IconName;
  className?: string;
}) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      onClick={onClick}
      data-active={active ?? undefined}
      className={clsx("chip", onClick && "cursor-pointer hover:border-line2 hover:text-text", className)}
      type={onClick ? "button" : undefined}
    >
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </Comp>
  );
}

/* ------------------------------------------------------------ Section head */

export function SectionHeader({
  label,
  title,
  action,
  subtitle,
  className,
}: {
  label?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("mb-4 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {label ? <div className="label mb-1.5">{label}</div> : null}
        <h2 className="truncate text-[1.4rem] leading-tight text-text md:text-[1.65rem]">{title}</h2>
        {subtitle ? <p className="mt-1 truncate text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  children,
  title,
  subtitle,
  wide,
  align = "center",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  wide?: boolean;
  align?: "center" | "bottom";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      const focusable = ref.current?.querySelector<HTMLElement>(
        "input, textarea, button:not([data-noautofocus]), [tabindex]:not([tabindex='-1'])",
      );
      focusable?.focus();
    }, 40);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={clsx(
        "fixed inset-0 z-[90] flex justify-center veil-enter",
        align === "center" ? "items-center p-3 sm:p-4" : "items-end p-0 sm:items-center sm:p-4",
      )}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-[rgba(3,9,7,0.72)] backdrop-blur-md"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        className={clsx(
          "relative z-10 max-h-[90dvh] w-full overflow-hidden rounded-2xl border border-line2 bg-elev shadow-[0_40px_120px_-40px_rgba(0,0,0,0.95)]",
          "toast-enter scroll-slim overflow-y-auto overscroll-contain",
          /* on a phone a bottom sheet is full-bleed: no side gaps, no bottom corners */
          align === "bottom" && "safe-bottom rounded-b-none border-b-0 sm:rounded-b-2xl sm:border-b sm:pb-0",
          wide ? "max-w-3xl" : "max-w-md",
        )}
      >
        {align === "bottom" ? (
          <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden>
            <span className="sheet-grab" />
          </div>
        ) : null}
        {title ? (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h3 className="truncate text-lg text-text">{title}</h3>
              {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
            </div>
            <button className="btn-icon p-1.5" onClick={onClose} aria-label="Close">
              <Icon name="close" size={18} />
            </button>
          </div>
        ) : (
          <button
            className="btn-icon absolute right-3 top-3 z-20 p-1.5"
            onClick={onClose}
            aria-label="Close"
            data-noautofocus
          >
            <Icon name="close" size={18} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ Toasts */

export type Toast = { id: number; title: string; msg?: string; kind?: "ok" | "info" | "warn"; action?: { label: string; run: () => void } };

type ToastCtx = { push: (t: Omit<Toast, "id">) => void };
const ToastContext = createContext<ToastCtx>({ push: () => {} });
export const useToast = () => useContext(ToastContext);

let toastSeq = 1;

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = toastSeq++;
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      const timer = window.setTimeout(() => dismiss(id), 4200);
      timers.current.push(timer);
    },
    [dismiss],
  );

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-[178px] z-[120] flex flex-col gap-2 sm:inset-x-auto sm:bottom-[112px] sm:right-4 sm:w-[min(360px,calc(100vw-2rem))]"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-enter pointer-events-auto flex items-start gap-3 rounded-xl border border-line2 bg-elev/95 px-4 py-3 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl"
          >
            <span
              className={clsx(
                "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                t.kind === "warn" ? "bg-madder/20 text-madder" : t.kind === "info" ? "bg-turq/20 text-turq" : "bg-jade/20 text-jade",
              )}
            >
              <Icon name={t.kind === "warn" ? "info" : t.kind === "info" ? "sparkle" : "check"} size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-text">{t.title}</div>
              {t.msg ? <div className="mt-0.5 text-xs leading-relaxed text-muted">{t.msg}</div> : null}
              {t.action ? (
                <button
                  className="mt-1.5 text-xs font-semibold text-jade underline-offset-4 hover:underline"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <button className="btn-icon -mr-1 -mt-1 p-1" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ----------------------------------------------------------------- SeekBar */

export function SeekBar({
  value,
  max,
  peaks,
  onChange,
  onScrubStart,
  onScrubEnd,
  className,
  compact,
  label,
}: {
  value: number;
  max: number;
  peaks?: number[];
  onChange: (t: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  className?: string;
  compact?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "");
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const ratio = max > 0 ? clamp(value / max, 0, 1) : 0;
  const hoverRatio = hover !== null && max > 0 ? clamp(hover / max, 0, 1) : 0;

  const timeFromEvent = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * max;
  };

  return (
    <div
      ref={ref}
      className={clsx("seek group", className)}
      role="slider"
      tabIndex={0}
      aria-label={label ?? "Seek"}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={formatTime(value)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(clamp(value + 5, 0, max));
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(clamp(value - 5, 0, max));
        } else if (e.key === "Home") {
          onChange(0);
        } else if (e.key === "End") {
          onChange(max);
        }
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setDragging(true);
        onScrubStart?.();
        onChange(timeFromEvent(e.clientX));
      }}
      onPointerMove={(e) => {
        setHover(timeFromEvent(e.clientX));
        if (dragging) onChange(timeFromEvent(e.clientX));
      }}
      onPointerUp={(e) => {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        if (dragging) {
          setDragging(false);
          onScrubEnd?.();
          onChange(timeFromEvent(e.clientX));
        }
      }}
      onPointerCancel={() => {
        setDragging(false);
        onScrubEnd?.();
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className={clsx("seek-track", compact && "h-[3px]")}>
        {peaks && peaks.length ? (
          <svg viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {peaks.map((p, i) => (
              <rect
                key={i}
                x={i}
                y={(100 - p * 100) / 2}
                width={0.62}
                height={p * 100}
                rx={0.3}
                fill="currentColor"
                className="text-text/22"
              />
            ))}
            {peaks.map((p, i) => {
              const x = i / peaks.length;
              if (x > ratio) return null;
              return (
                <rect key={`f${i}`} x={i} y={(100 - p * 100) / 2} width={0.62} height={p * 100} rx={0.3} fill={`url(#seek-${uid})`} />
              );
            })}
            <defs>
              <linearGradient id={`seek-${uid}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--c-jade-deep)" />
                <stop offset="70%" stopColor="var(--c-jade)" />
                <stop offset="100%" stopColor="var(--c-gold)" />
              </linearGradient>
            </defs>
          </svg>
        ) : (
          <div className="seek-fill" style={{ width: `${ratio * 100}%` }} />
        )}
        {hover !== null ? (
          <div className="absolute inset-y-0 w-px bg-goldsoft/70" style={{ left: `${hoverRatio * 100}%` }} />
        ) : null}
      </div>
      {hover !== null && max > 0 ? (
        <div
          className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md border border-line2 bg-elev px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-text2"
          style={{ left: `${hoverRatio * 100}%` }}
        >
          {formatTime(hover)}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- Tabs */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center gap-1 rounded-full border border-line bg-surface2/60 p-1", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "btn px-3 py-1.5 text-xs",
            value === t.id ? "bg-jade/15 text-jadesoft shadow-[inset_0_0_0_1px_var(--c-line-2)]" : "text-muted hover:text-text2",
          )}
          aria-pressed={value === t.id}
        >
          {t.icon ? <Icon name={t.icon} size={13} /> : null}
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- Toggle */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-6 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
      </span>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative h-[22px] w-[40px] shrink-0 rounded-full border transition-colors duration-300",
          checked ? "border-transparent bg-jade" : "border-line2 bg-surface3",
        )}
      >
        <span
          className={clsx(
            "absolute top-[2px] h-[16px] w-[16px] rounded-full bg-bg transition-all duration-300",
            checked ? "left-[21px]" : "left-[2px]",
          )}
          style={{ background: checked ? "var(--c-jade-ink)" : "var(--c-text-2)" }}
        />
      </button>
    </label>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({
  icon = "waveform",
  title,
  msg,
  action,
}: {
  icon?: IconName;
  title: string;
  msg?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/40 px-6 py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full border border-line2 bg-surface2 text-gold">
        <Icon name={icon} size={20} />
      </span>
      <h3 className="text-lg text-text">{title}</h3>
      {msg ? <p className="max-w-sm text-sm leading-relaxed text-muted">{msg}</p> : null}
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ Kbd */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line2 bg-surface2 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted">
      {children}
    </kbd>
  );
}
