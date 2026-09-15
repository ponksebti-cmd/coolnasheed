import type { CSSProperties } from "react";

export type IconName =
  | "play"
  | "pause"
  | "next"
  | "prev"
  | "shuffle"
  | "repeat"
  | "repeatOne"
  | "star"
  | "starFill"
  | "volume"
  | "volumeLow"
  | "volumeMute"
  | "lyrics"
  | "expand"
  | "collapse"
  | "close"
  | "search"
  | "home"
  | "library"
  | "queue"
  | "plus"
  | "sparkle"
  | "moon"
  | "sun"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "chevronUp"
  | "more"
  | "share"
  | "trash"
  | "clock"
  | "user"
  | "waveform"
  | "sliders"
  | "beads"
  | "check"
  | "arrowUpRight"
  | "info"
  | "mic"
  | "trending"
  | "grid"
  | "rows"
  | "drag"
  | "compass"
  | "eye"
  | "eyeOff"
  | "pencil"
  | "command"
  | "flag"
  | "upload"
  | "shield"
  | "users"
  | "server"
  | "cloudOff"
  | "file";

type IconDef = {
  d?: string[];
  c?: [number, number, number][];
  fill?: boolean;
  sw?: number;
};

const S8 = "M12 2.4L13.61 8.12L18.79 5.21L15.88 10.39L21.6 12L15.88 13.61L18.79 18.79L13.61 15.88L12 21.6L10.39 15.88L5.21 18.79L8.12 13.61L2.4 12L8.12 10.39L5.21 5.21L10.39 8.12Z";

const ICONS: Record<IconName, IconDef> = {
  play: { d: ["M8 5.2v13.6L19 12z"], fill: true },
  pause: { d: ["M9.2 5.5v13M14.8 5.5v13"], sw: 2.6 },
  next: { d: ["M6.5 5.4v13.2L16 12z", "M18.2 5.6v12.8"], fill: false, sw: 1.9 },
  prev: { d: ["M17.5 5.4v13.2L8 12z", "M5.8 5.6v12.8"], fill: false, sw: 1.9 },
  shuffle: {
    d: [
      "M3 7h3.4l3.2 6.4",
      "M14.6 17H21",
      "M18 14l3 3-3 3",
      "M3 17h3.4l8-10H21",
      "M18 4l3 3-3 3",
    ],
  },
  repeat: {
    d: [
      "M4 9.5V8.6A3.6 3.6 0 0 1 7.6 5H18",
      "M15.4 2.4 18 5l-2.6 2.6",
      "M20 14.5v.9a3.6 3.6 0 0 1-3.6 3.6H6",
      "M8.6 21.6 6 19l2.6-2.6",
    ],
  },
  repeatOne: {
    d: [
      "M4 9.5V8.6A3.6 3.6 0 0 1 7.6 5H18",
      "M15.4 2.4 18 5l-2.6 2.6",
      "M20 14.5v.9a3.6 3.6 0 0 1-3.6 3.6H6",
      "M8.6 21.6 6 19l2.6-2.6",
      "M11.6 9.6 13 9v6",
    ],
  },
  star: { d: [S8] },
  starFill: { d: [S8], fill: true },
  volume: {
    d: ["M4 9.4h3.6L12 5.6v12.8l-4.4-3.8H4z", "M15.6 9.2a4 4 0 0 1 0 5.6", "M18.2 6.6a7.6 7.6 0 0 1 0 10.8"],
  },
  volumeLow: { d: ["M4 9.4h3.6L12 5.6v12.8l-4.4-3.8H4z", "M15.6 9.2a4 4 0 0 1 0 5.6"] },
  volumeMute: { d: ["M4 9.4h3.6L12 5.6v12.8l-4.4-3.8H4z", "M16.2 9.8l4.6 4.4M20.8 9.8l-4.6 4.4"] },
  lyrics: { d: ["M4.5 6h15M4.5 10.5h15M4.5 15h10M4.5 19.5h6.5"], sw: 1.8 },
  expand: { d: ["M9.5 4H4v5.5M14.5 4H20v5.5M14.5 20H20v-5.5M9.5 20H4v-5.5"] },
  collapse: { d: ["M4 9.5h5.5V4M20 9.5h-5.5V4M20 14.5h-5.5V20M4 14.5h5.5V20"] },
  close: { d: ["M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"], sw: 1.9 },
  search: { c: [[11, 11, 6.6]], d: ["M15.9 15.9 21 21"], sw: 1.9 },
  home: { d: ["M4 11.2 12 4.6l8 6.6v7.6a1.2 1.2 0 0 1-1.2 1.2h-3.4v-6.2H8.6V20H5.2A1.2 1.2 0 0 1 4 18.8z"] },
  library: { d: ["M4.2 5.2h3.4v13.6H4.2zM10 5.2h3.4v13.6H10zM17.1 6.3l3.2.9-3.3 11.9-3.2-.9z"] },
  queue: { d: ["M3.6 6.4h11.8M3.6 11.4h11.8M3.6 16.4h7.2", "M17.4 13.6v6.2l5-3.1z"], fill: false, sw: 1.8 },
  plus: { d: ["M12 5.2v13.6M5.2 12h13.6"], sw: 1.9 },
  sparkle: { d: ["M11 3.2 12.5 8 17.4 9.5 12.5 11 11 15.8 9.5 11 4.6 9.5 9.5 8z", "M18.4 15.2l.7 2.2 2.2.7-2.2.7-.7 2.2-.7-2.2-2.2-.7 2.2-.7z"], fill: true },
  moon: { d: ["M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11z"] },
  sun: { c: [[12, 12, 4]], d: ["M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"] },
  chevronLeft: { d: ["M14.8 5.6 8.4 12l6.4 6.4"], sw: 1.9 },
  chevronRight: { d: ["M9.2 5.6 15.6 12l-6.4 6.4"], sw: 1.9 },
  chevronDown: { d: ["M5.6 9.2 12 15.6l6.4-6.4"], sw: 1.9 },
  chevronUp: { d: ["M5.6 14.8 12 8.4l6.4 6.4"], sw: 1.9 },
  more: { c: [[5.6, 12, 1.5], [12, 12, 1.5], [18.4, 12, 1.5]], fill: true },
  share: { d: ["M12 3.6v11.2", "M8.4 7.2 12 3.6l3.6 3.6", "M4.8 14v5a1.6 1.6 0 0 0 1.6 1.6h11.2a1.6 1.6 0 0 0 1.6-1.6v-5"] },
  trash: { d: ["M4.8 7.2h14.4", "M9.6 7.2V5.4a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.8", "M6.6 7.2l.9 11.4a1.6 1.6 0 0 0 1.6 1.4h5.8a1.6 1.6 0 0 0 1.6-1.4l.9-11.4"] },
  clock: { c: [[12, 12, 8.4]], d: ["M12 7.2V12l3.2 1.9"] },
  user: { c: [[12, 8.4, 3.6]], d: ["M4.8 20c.7-3.6 3.6-5.6 7.2-5.6s6.5 2 7.2 5.6"] },
  waveform: { d: ["M3.6 10.2v3.6M7.6 6.6v10.8M11.6 8.8v6.4M15.6 4.8v14.4M19.6 9.6v4.8"], sw: 1.9 },
  sliders: { d: ["M4 7.6h9.2M18 7.6H20M4 16.4h4.4M13.2 16.4H20"], c: [[15.4, 7.6, 2.2], [10.6, 16.4, 2.2]] },
  beads: { c: [[7.6, 7.6, 1.5], [12, 5.4, 1.5], [16.4, 7.6, 1.5], [18.6, 12, 1.5], [16.4, 16.4, 1.5], [12, 18.6, 1.5], [7.6, 16.4, 1.5], [5.4, 12, 1.5]], d: ["M12 18.6v2.8", "M10.8 21.4h2.4"] },
  check: { d: ["M4.8 12.6 9.6 17.4 19.2 6.6"], sw: 2 },
  arrowUpRight: { d: ["M6.6 17.4 17.4 6.6M8.4 6.6h9v9"], sw: 1.8 },
  info: { c: [[12, 12, 8.4]], d: ["M12 11v5.4M12 7.9v.2"], sw: 1.9 },
  mic: { d: ["M12 3.6a2.6 2.6 0 0 1 2.6 2.6v5a2.6 2.6 0 0 1-5.2 0v-5A2.6 2.6 0 0 1 12 3.6z", "M8 11.2a4 4 0 0 0 8 0", "M12 15.2v3.4M9 20.4h6"] },
  trending: { d: ["M12 3.2s5 4.6 5 9.2a5 5 0 0 1-10 0c0-1.6.6-3 1.5-4.1.2 1.1.9 1.9 1.8 2.1.3-2.7 1.7-5.1 1.7-7.2z"] },
  grid: { d: ["M4.4 4.4h6v6h-6zM13.6 4.4h6v6h-6zM4.4 13.6h6v6h-6zM13.6 13.6h6v6h-6z"] },
  rows: { d: ["M4.4 5.6h15.2M4.4 12h15.2M4.4 18.4h15.2"], sw: 1.9 },
  drag: { c: [[9, 6, 1.1], [9, 12, 1.1], [9, 18, 1.1], [15, 6, 1.1], [15, 12, 1.1], [15, 18, 1.1]], fill: true },
  compass: { c: [[12, 12, 8.4]], d: ["M15.2 8.8l-1.8 4.6-4.6 1.8 1.8-4.6z"] },
  eye: { d: ["M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12z"], c: [[12, 12, 2.8]] },
  eyeOff: { d: ["M4.2 4.2l15.6 15.6", "M9.6 5.2A9.6 9.6 0 0 1 12 4.9c6 0 9.4 7.1 9.4 7.1a17 17 0 0 1-2.6 3.6", "M6.4 7.6A16.6 16.6 0 0 0 2.6 12S6 19.1 12 19.1a9.4 9.4 0 0 0 3.4-.6", "M10.2 10.4a2.6 2.6 0 0 0 3.4 3.6"] },
  pencil: { d: ["M4.4 19.6h3.2L18.4 8.8a1.8 1.8 0 0 0 0-2.5l-.7-.7a1.8 1.8 0 0 0-2.5 0L4.4 16.4z", "M14.6 6.6l2.8 2.8"] },
  command: { d: ["M8.4 3.6a2.4 2.4 0 1 0 2.4 2.4v12a2.4 2.4 0 1 0 2.4-2.4h-12a2.4 2.4 0 1 0 2.4 2.4V6a2.4 2.4 0 1 0-2.4 2.4h12a2.4 2.4 0 1 0-2.4-2.4v12a2.4 2.4 0 1 0 2.4-2.4H6a2.4 2.4 0 1 0 2.4 2.4z"] },
  flag: { d: ["M5.4 21V4.2", "M5.4 5.2h9.2l-1.3 3.4 1.3 3.4H5.4"], sw: 1.8 },
  upload: { d: ["M12 19.4V8.2", "M7.8 12.2 12 8l4.2 4.2", "M4.6 19.6v.8a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-.8"], sw: 1.8 },
  shield: { d: ["M12 3.2 19.4 6v5.4c0 4.2-3 7.4-7.4 9.4-4.4-2-7.4-5.2-7.4-9.4V6z", "M9.2 12.2l2 2 3.6-3.8"], sw: 1.7 },
  users: { c: [[9.6, 8.4, 3.2]], d: ["M3.6 19.4c.6-3.2 3.1-5 6-5s5.4 1.8 6 5", "M16.2 5.6a3.2 3.2 0 0 1 0 6.2", "M17.6 14.8c2 .5 3.4 2.1 3.8 4.6"], sw: 1.7 },
  server: { d: ["M4 5.2h16v5H4zM4 13.8h16v5H4z", "M7 7.7h.01M7 16.3h.01"], sw: 1.7 },
  cloudOff: { d: ["M6.6 18.4h9.8a3.8 3.8 0 0 0 1.2-7.4 5.6 5.6 0 0 0-8.2-4.2", "M8.4 8.6a4.6 4.6 0 0 0-1.6 8.6", "M4 4l16 16"], sw: 1.7 },
  file: { d: ["M6.4 3.6h7.2l4 4v12.8H6.4z", "M13.6 3.6v4h4", "M9.2 13h5.6M9.2 16.4h4"], sw: 1.7 },
};

export type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  title?: string;
};

export function Icon({ name, size = 20, className, strokeWidth, style, title }: IconProps) {
  const def = ICONS[name];
  const sw = strokeWidth ?? def.sw ?? 1.7;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      fill={def.fill ? "currentColor" : "none"}
      stroke={def.fill ? "none" : "currentColor"}
      strokeWidth={def.fill ? 0 : sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {def.c?.map(([cx, cy, r], i) => (
        <circle key={`c${i}`} cx={cx} cy={cy} r={r} fill={def.fill ? "currentColor" : "none"} stroke={def.fill ? "none" : "currentColor"} strokeWidth={def.fill ? 0 : sw} />
      ))}
      {def.d?.map((p, i) => (
        <path key={`p${i}`} d={p} />
      ))}
    </svg>
  );
}
