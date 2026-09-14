import { useId, useMemo } from "react";
import { planArt, type ArtMotif, MOTIF_LABEL } from "../../lib/art/pattern";
import type { Accent } from "../../data/types";
import { clsx } from "clsx";

const MAX_SHAPES = 240;
const MAX_DOTS = 240;

type Props = {
  seed: string;
  accent: Accent;
  motif?: ArtMotif;
  className?: string;
  /** 0 = flat, 1 = full glow */
  intensity?: number;
  showVignette?: boolean;
  title?: string;
};

export function PatternArt({ seed, accent, motif, className, intensity = 0.85, showVignette = true }: Props) {
  const uid = useId().replace(/[:]/g, "");
  const plan = useMemo(() => planArt(seed, accent, motif), [seed, accent, motif]);
  const p = plan.palette;
  const shapes = plan.shapes.slice(0, MAX_SHAPES);
  const dots = plan.dots.slice(0, MAX_DOTS);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className={clsx("h-full w-full", className)}
      role="img"
      aria-label={`${MOTIF_LABEL[plan.motif]} artwork`}
    >
      <defs>
        <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p.bg1} />
          <stop offset="55%" stopColor={p.bg0} />
          <stop offset="100%" stopColor={p.bg1} />
        </linearGradient>
        <radialGradient id={`glow-${uid}`} cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor={p.glow} stopOpacity={0.5 * intensity} />
          <stop offset="60%" stopColor={p.glow} stopOpacity={0.09 * intensity} />
          <stop offset="100%" stopColor={p.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`vig-${uid}`} cx="50%" cy="50%" r="72%">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
      </defs>

      <rect width="100" height="100" fill={`url(#bg-${uid})`} />

      <g transform={`rotate(${plan.rotation} 50 50) scale(${plan.scale})`} style={{ transformOrigin: "50px 50px", transformBox: "view-box" }}>
        {shapes.map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill={s.mode === "fill" ? (s.color === "ink" ? p.ink : p.accent) : "none"}
            stroke={s.mode === "stroke" ? (s.color === "ink" ? p.ink : p.accent) : "none"}
            strokeWidth={s.w ?? 0.6}
            fillOpacity={s.o ?? (s.mode === "fill" ? 0.9 : 1)}
            strokeOpacity={s.o ?? 0.85}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {dots.map((d, i) => (
          <circle
            key={i}
            cx={d.cx}
            cy={d.cy}
            r={d.r}
            fill={d.mode === "fill" ? (d.color === "ink" ? p.ink : p.accent) : "none"}
            stroke={d.mode === "stroke" ? (d.color === "ink" ? p.ink : p.accent) : "none"}
            strokeWidth={d.w ?? 0.5}
            fillOpacity={d.o ?? 0.9}
            strokeOpacity={d.o ?? 0.7}
          />
        ))}
      </g>

      <rect width="100" height="100" fill={`url(#glow-${uid})`} style={{ mixBlendMode: "screen" }} />
      {showVignette ? <rect width="100" height="100" fill={`url(#vig-${uid})`} /> : null}
    </svg>
  );
}

/** The eight-point star used for the app mark (rubʿ al-ḥizb derived). */
export function StarMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id="mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--c-jade-soft)" />
          <stop offset="55%" stopColor="var(--c-jade)" />
          <stop offset="100%" stopColor="var(--c-gold)" />
        </linearGradient>
      </defs>
      <g transform="translate(8 8) scale(1)">
        <path
          d="M12 2.4 13.61 8.12 18.79 5.21 15.88 10.39 21.6 12 15.88 13.61 18.79 18.79 13.61 15.88 12 21.6 10.39 15.88 5.21 18.79 8.12 13.61 2.4 12 8.12 10.39 5.21 5.21 10.39 8.12Z"
          fill="url(#mark-g)"
        />
      </g>
      <circle cx="20" cy="20" r="2.1" fill="var(--c-bg)" opacity="0.85" />
    </svg>
  );
}

/** Full-bleed ambient backdrop: two slow-drifting glows + a faint tile field. */
export function AmbientBackdrop({ accent = "jade", seed = "home" }: { accent?: Accent; seed?: string }) {
  const plan = useMemo(() => planArt(`backdrop-${seed}`, accent, "girih"), [accent, seed]);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute -left-[18%] -top-[26%] h-[62vh] w-[62vh] rounded-full blur-[90px] animate-drift"
        style={{ background: `radial-gradient(circle, rgba(var(--c-glow),0.22), transparent 68%)` }}
      />
      <div
        className="absolute -right-[14%] top-[24%] h-[54vh] w-[54vh] rounded-full blur-[100px] animate-drift"
        style={{
          background: `radial-gradient(circle, rgba(var(--c-glow-2),0.16), transparent 70%)`,
          animationDelay: "-8s",
        }}
      />
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full opacity-[0.055]">
        <g stroke={plan.palette.ink} fill="none" strokeWidth={0.25}>
          {plan.shapes.slice(0, 120).map((s, i) => (
            <path key={i} d={s.d} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      </svg>
      <div className="grain absolute inset-0" />
    </div>
  );
}
