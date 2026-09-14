/**
 * Procedural artwork.
 *
 * Every cover in CoolNasheed is drawn at runtime as SVG geometry derived from the
 * track's seed — star rosettes, girih tessellations, mashrabiya lattices, mihrab
 * arches and square-kufic meanders, in the emerald/gold/turquoise palette of
 * Mamlūk, Iznik and zellige tilework. No two covers are alike; each one is
 * deterministic, so a track always looks like itself.
 */

import { chance, intRange, mulberry32, hashString, pick, range, type Rng } from "../prng";
import type { Accent } from "../../data/types";

export type ArtMotif = "rosette" | "girih" | "mashrabiya" | "zellige" | "mihrab" | "kufic";

export const MOTIF_LABEL: Record<ArtMotif, string> = {
  rosette: "star rosette",
  girih: "girih tessellation",
  mashrabiya: "mashrabiya lattice",
  zellige: "zellige grid",
  mihrab: "mihrab arches",
  kufic: "square kūfic",
};

const MOTIFS: ArtMotif[] = ["rosette", "girih", "mashrabiya", "zellige", "mihrab", "kufic"];

type Palette = {
  bg0: string;
  bg1: string;
  ink: string;
  accent: string;
  glow: string;
};

const PALETTES: Record<Accent, Palette> = {
  jade: { bg0: "#05120E", bg1: "#0F3126", ink: "#3FD3A0", accent: "#E6CB8B", glow: "#2FBF8F" },
  gold: { bg0: "#130D04", bg1: "#31250D", ink: "#E6CB8B", accent: "#3FD3A0", glow: "#D9B871" },
  turq: { bg0: "#03141A", bg1: "#0C3039", ink: "#4FD6CE", accent: "#F0DCA8", glow: "#35B7B0" },
  madder: { bg0: "#170906", bg1: "#35150E", ink: "#E08363", accent: "#F0DCA8", glow: "#C4644A" },
  cobalt: { bg0: "#060B19", bg1: "#132348", ink: "#7FA3E8", accent: "#E6CB8B", glow: "#4A76C9" },
};

export type Shape = {
  d: string;
  mode: "stroke" | "fill";
  color: "ink" | "accent";
  w?: number;
  o?: number;
};

export type Dot = { cx: number; cy: number; r: number; color: "ink" | "accent"; mode: "stroke" | "fill"; w?: number; o?: number };

export type ArtPlan = {
  motif: ArtMotif;
  palette: Palette;
  shapes: Shape[];
  dots: Dot[];
  rotation: number;
  scale: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function starPath(cx: number, cy: number, R: number, r: number, points: number, rot = 0): string {
  const pts: string[] = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = rot + (i * Math.PI * 2) / n;
    pts.push(`${r2(cx + Math.cos(a) * rad)},${r2(cy + Math.sin(a) * rad)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

function polygonPath(cx: number, cy: number, R: number, sides: number, rot = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * Math.PI * 2) / sides;
    pts.push(`${r2(cx + Math.cos(a) * R)},${r2(cy + Math.sin(a) * R)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

function rosette(rng: Rng): { shapes: Shape[]; dots: Dot[] } {
  const shapes: Shape[] = [];
  const dots: Dot[] = [];
  const points = pick(rng, [8, 10, 12, 12, 16]);
  const cx = 50;
  const cy = 50;
  const R = 40;
  const rot = range(rng, 0, Math.PI);

  shapes.push({ d: starPath(cx, cy, R, R * 0.44, points, rot), mode: "stroke", color: "ink", w: 0.8 });
  shapes.push({ d: starPath(cx, cy, R * 0.78, R * 0.3, points, rot + Math.PI / points), mode: "stroke", color: "accent", w: 0.7 });
  shapes.push({ d: starPath(cx, cy, R * 0.5, R * 0.2, points, rot), mode: "fill", color: "accent", o: 0.16 });
  shapes.push({ d: polygonPath(cx, cy, R * 0.3, points / 2, rot), mode: "stroke", color: "ink", w: 0.6 });

  dots.push({ cx, cy, r: R * 1.06, color: "ink", mode: "stroke", w: 0.6, o: 0.7 });
  dots.push({ cx, cy, r: R * 1.14, color: "accent", mode: "stroke", w: 0.35, o: 0.5 });
  dots.push({ cx, cy, r: R * 0.16, color: "accent", mode: "fill", o: 0.9 });

  // rays
  const rays = points * 2;
  for (let i = 0; i < rays; i++) {
    const a = rot + (i * Math.PI * 2) / rays;
    const x1 = cx + Math.cos(a) * R * 1.06;
    const y1 = cy + Math.sin(a) * R * 1.06;
    const x2 = cx + Math.cos(a) * R * 1.28;
    const y2 = cy + Math.sin(a) * R * 1.28;
    shapes.push({ d: `M ${r2(x1)},${r2(y1)} L ${r2(x2)},${r2(y2)}`, mode: "stroke", color: "ink", w: 0.4, o: 0.55 });
  }

  // corner quarter-rosettes
  [
    [0, 0],
    [100, 0],
    [0, 100],
    [100, 100],
  ].forEach(([x, y], i) => {
    shapes.push({
      d: starPath(x, y, 24, 10, 8, rot + i * 0.2),
      mode: "stroke",
      color: i % 2 ? "accent" : "ink",
      w: 0.6,
      o: 0.75,
    });
  });

  return { shapes, dots };
}

function girih(rng: Rng): { shapes: Shape[]; dots: Dot[] } {
  const shapes: Shape[] = [];
  const dots: Dot[] = [];
  const cell = pick(rng, [25, 20, 33.33]);
  const rot = chance(rng, 0.4) ? Math.PI / 8 : 0;
  for (let gy = -1; gy <= Math.ceil(100 / cell) + 1; gy++) {
    for (let gx = -1; gx <= Math.ceil(100 / cell) + 1; gx++) {
      const offset = gy % 2 === 0 ? 0 : cell / 2;
      const cx = gx * cell + offset;
      const cy = gy * cell;
      shapes.push({
        d: starPath(cx, cy, cell * 0.52, cell * 0.24, 8, rot),
        mode: "stroke",
        color: (gx + gy) % 2 === 0 ? "ink" : "accent",
        w: 0.6,
        o: 0.85,
      });
      shapes.push({
        d: polygonPath(cx, cy, cell * 0.2, 4, rot + Math.PI / 4),
        mode: "fill",
        color: (gx + gy) % 2 === 0 ? "accent" : "ink",
        o: 0.14,
      });
      if (chance(rng, 0.22)) dots.push({ cx, cy, r: cell * 0.07, color: "accent", mode: "fill", o: 0.8 });
    }
  }
  return { shapes, dots };
}

function mashrabiya(rng: Rng): { shapes: Shape[]; dots: Dot[] } {
  const shapes: Shape[] = [];
  const dots: Dot[] = [];
  const step = pick(rng, [16, 20, 25]);
  const rad = step * range(rng, 0.62, 0.86);
  for (let gy = -1; gy <= Math.ceil(100 / step) + 1; gy++) {
    for (let gx = -1; gx <= Math.ceil(100 / step) + 1; gx++) {
      const cx = gx * step;
      const cy = gy * step;
      dots.push({ cx, cy, r: rad, color: "ink", mode: "stroke", w: 0.45, o: 0.5 });
      dots.push({ cx: cx + step / 2, cy: cy + step / 2, r: rad, color: "accent", mode: "stroke", w: 0.4, o: 0.34 });
      dots.push({ cx, cy, r: step * 0.12, color: "accent", mode: "fill", o: 0.5 });
    }
  }
  // quatrefoil accents
  for (let gy = 0; gy <= Math.ceil(100 / step); gy++) {
    for (let gx = 0; gx <= Math.ceil(100 / step); gx++) {
      if ((gx + gy) % 3 !== 0) continue;
      const cx = gx * step + step / 2;
      const cy = gy * step + step / 2;
      shapes.push({ d: starPath(cx, cy, step * 0.42, step * 0.18, 8, rng() * Math.PI), mode: "stroke", color: "accent", w: 0.55, o: 0.85 });
    }
  }
  return { shapes, dots };
}

function zellige(rng: Rng): { shapes: Shape[]; dots: Dot[] } {
  const shapes: Shape[] = [];
  const dots: Dot[] = [];
  const cell = pick(rng, [20, 25, 16.66]);
  for (let gy = -1; gy <= Math.ceil(100 / cell) + 1; gy++) {
    for (let gx = -1; gx <= Math.ceil(100 / cell) + 1; gx++) {
      const cx = gx * cell + cell / 2;
      const cy = gy * cell + cell / 2;
      const s = cell * 0.5;
      shapes.push({ d: `M ${r2(cx - s)},${r2(cy)} L ${r2(cx)},${r2(cy - s)} L ${r2(cx + s)},${r2(cy)} L ${r2(cx)},${r2(cy + s)} Z`, mode: "stroke", color: "ink", w: 0.55, o: 0.8 });
      shapes.push({ d: `M ${r2(cx - s * 0.72)},${r2(cy - s * 0.72)} L ${r2(cx + s * 0.72)},${r2(cy - s * 0.72)} L ${r2(cx + s * 0.72)},${r2(cy + s * 0.72)} L ${r2(cx - s * 0.72)},${r2(cy + s * 0.72)} Z`, mode: "stroke", color: "accent", w: 0.4, o: 0.5 });
      if ((gx + gy) % 2 === 0) {
        shapes.push({ d: starPath(cx, cy, s * 0.46, s * 0.19, 8, Math.PI / 8), mode: "fill", color: "accent", o: 0.18 });
      }
    }
  }
  return { shapes, dots };
}

function mihrab(rng: Rng): { shapes: Shape[]; dots: Dot[] } {
  const shapes: Shape[] = [];
  const dots: Dot[] = [];
  const w = pick(rng, [20, 25, 33.33]);
  const rows = Math.ceil(100 / (w * 1.5)) + 2;
  for (let row = -1; row < rows; row++) {
    const base = row * w * 1.5;
    const offset = row % 2 === 0 ? 0 : w / 2;
    const h = w * range(rng, 1.25, 1.55);
    for (let col = -1; col <= Math.ceil(100 / w) + 1; col++) {
      const x = col * w + offset;
      const arch = (scale: number) => {
        const ww = w * scale;
        const hh = h * scale;
        const xx = x + (w - ww) / 2;
        return `M ${r2(xx)},${r2(base)} L ${r2(xx)},${r2(base - hh * 0.5)} Q ${r2(xx)},${r2(base - hh * 0.94)} ${r2(xx + ww / 2)},${r2(base - hh)} Q ${r2(xx + ww)},${r2(base - hh * 0.94)} ${r2(xx + ww)},${r2(base - hh * 0.5)} L ${r2(xx + ww)},${r2(base)}`;
      };
      shapes.push({ d: arch(1), mode: "stroke", color: "ink", w: 0.7, o: 0.9 });
      shapes.push({ d: arch(0.72), mode: "stroke", color: "accent", w: 0.45, o: 0.55 });
      dots.push({ cx: x + w / 2, cy: base - h * 0.42, r: w * 0.09, color: "accent", mode: "fill", o: 0.75 });
      shapes.push({ d: `M ${r2(x)},${r2(base)} L ${r2(x + w)},${r2(base)}`, mode: "stroke", color: "ink", w: 0.4, o: 0.4 });
    }
  }
  return { shapes, dots };
}

function kufic(rng: Rng): { shapes: Shape[]; dots: Dot[] } {
  const shapes: Shape[] = [];
  const dots: Dot[] = [];
  const u = pick(rng, [8, 10, 12.5]);
  const cols = Math.ceil(100 / u) + 2;
  const rows = Math.ceil(100 / u) + 2;
  // square-kūfic meander: vertical stems of varying height joined by a baseline
  for (let row = -1; row < rows; row++) {
    const base = row * u * 2 + u;
    const lineRow = row % 2 === 0;
    let d = `M ${r2(-u)},${r2(base)}`;
    for (let col = 0; col < cols; col++) {
      const x = col * u;
      const height = intRange(rng, 1, lineRow ? 2 : 3) * u;
      d += ` L ${r2(x)},${r2(base)} L ${r2(x)},${r2(base - height)} L ${r2(x + u * 0.55)},${r2(base - height)} L ${r2(x + u * 0.55)},${r2(base)}`;
      if (chance(rng, 0.3)) {
        dots.push({ cx: x + u * 0.28, cy: base - height - u * 0.45, r: u * 0.14, color: "accent", mode: "fill", o: 0.85 });
      }
    }
    shapes.push({ d, mode: "stroke", color: lineRow ? "ink" : "accent", w: lineRow ? 1.1 : 0.8, o: lineRow ? 0.9 : 0.5 });
  }
  return { shapes, dots };
}

const BUILDERS: Record<ArtMotif, (rng: Rng) => { shapes: Shape[]; dots: Dot[] }> = {
  rosette,
  girih,
  mashrabiya,
  zellige,
  mihrab,
  kufic,
};

export function planArt(seed: string, accent: Accent, motif?: ArtMotif): ArtPlan {
  const rng = mulberry32(hashString(`art:${seed}`));
  const chosen = motif ?? pick(rng, MOTIFS);
  const built = BUILDERS[chosen](rng);
  return {
    motif: chosen,
    palette: PALETTES[accent],
    shapes: built.shapes,
    dots: built.dots,
    rotation: chance(rng, 0.5) ? range(rng, -8, 8) : 0,
    scale: range(rng, 1, 1.16),
  };
}
