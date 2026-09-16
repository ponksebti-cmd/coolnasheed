/**
 * Cover art.
 *
 * A publisher's uploaded image when there is one, and a plain accent tile with the
 * first letter of the title when there is not. Nothing is generated from a seed and
 * nothing pretends to be artwork: a nasheed without cover art looks like a nasheed
 * without cover art, which is what it is.
 */

import { clsx } from "clsx";
import { artworkUrl } from "../../lib/supabase";
import type { Accent } from "../../data/types";

const ACCENT_VAR: Record<Accent, string> = {
  jade: "--c-jade",
  gold: "--c-gold",
  turq: "--c-turq",
  madder: "--c-madder",
  cobalt: "--c-cobalt",
};

export type CoverArtProps = {
  /** storage path, not a URL */
  path?: string | null;
  title: string;
  accent?: Accent;
  size?: number;
  className?: string;
  rounded?: "sm" | "md" | "lg" | "full";
};

export function CoverArt({
  path,
  title,
  accent = "jade",
  size,
  className,
  rounded = "md",
}: CoverArtProps) {
  const url = artworkUrl(path);
  const initial = (title.trim()[0] ?? "▪").toUpperCase();
  const style = {
    ...(size ? { width: size, height: size } : {}),
    ...(url ? {} : { background: `color-mix(in oklab, var(${ACCENT_VAR[accent]}) 26%, transparent)` }),
    ...(url ? {} : { color: `var(${ACCENT_VAR[accent]})` }),
  } as React.CSSProperties;

  return (
    <div
      className={clsx(
        "art relative shrink-0 overflow-hidden border border-line/60 bg-surface2",
        rounded === "sm" && "rounded-md",
        rounded === "md" && "rounded-xl",
        rounded === "lg" && "rounded-2xl",
        rounded === "full" && "rounded-full",
        className,
      )}
      style={style}
    >
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center font-serif leading-none"
          style={{ fontSize: size ? Math.max(14, size * 0.4) : "1.6rem" }}
        >
          {initial}
        </span>
      )}
      {!url ? <span className="sr-only">no cover art</span> : null}
    </div>
  );
}

/** The project's mark: an eight-point star, drawn rather than decorated. */
export function StarMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M16 3l3.2 6.1 6.8 1-4.9 4.8 1.2 6.8L16 18.5 9.7 21.7l1.2-6.8L6 10.1l6.8-1z" />
        <circle cx="16" cy="16" r="12.2" opacity="0.35" />
      </g>
    </svg>
  );
}

/** The circular variant used for a person. */
export function Avatar({
  name,
  accent = "jade",
  size = 40,
  className,
}: {
  name: string;
  accent?: Accent;
  size?: number;
  className?: string;
}) {
  const initial = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <span
      className={clsx(
        "inline-grid shrink-0 place-items-center rounded-full border border-line/60 bg-surface2 font-medium",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.38),
        background: `color-mix(in oklab, var(${ACCENT_VAR[accent]}) 24%, transparent)`,
        color: `var(${ACCENT_VAR[accent]})`,
      }}
      aria-hidden
    >
      {initial || "?"}
    </span>
  );
}
