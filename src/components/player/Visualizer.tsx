import { useEffect, useRef } from "react";
import { clsx } from "clsx";
import { engine } from "../../lib/audio/engine";
import { usePlayer } from "../../store/player";

/**
 * Live spectrum drawn from the engine's AnalyserNode — the bars are the actual
 * synthesized voices, not a fake animation.
 */
export function RadialSpectrum({ className, bars = 84, radius = 0.72 }: { className?: string; bars?: number; radius?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playing = usePlayer((s) => s.playing);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const smooth = new Float32Array(bars);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, Math.floor(rect.width * dpr));
      h = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = w;
      canvas.height = h;
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const draw = () => {
      const spec = engine.readSpectrum();
      const cx = w / 2;
      const cy = h / 2;
      const base = (Math.min(w, h) / 2) * radius;

      ctx.clearRect(0, 0, w, h);

      const binCount = spec.length;
      const usable = Math.floor(binCount * 0.62);

      for (let i = 0; i < bars; i++) {
        // log-ish mapping so the low voice fundamentals get room
        const f = Math.pow(i / bars, 1.5);
        const idx = Math.min(usable - 1, Math.floor(f * usable));
        const v = (spec[idx] ?? 0) / 255;
        const target = Math.pow(v, 1.25);
        smooth[i] = smooth[i]! * 0.72 + target * 0.28;
      }

      const grad = ctx.createLinearGradient(0, cy - base, 0, cy + base);
      grad.addColorStop(0, "rgba(217,184,113,0.95)");
      grad.addColorStop(0.5, "rgba(47,191,143,0.9)");
      grad.addColorStop(1, "rgba(53,183,176,0.75)");

      ctx.strokeStyle = grad;
      ctx.lineCap = "round";
      const step = (Math.PI * 2) / bars;

      for (let i = 0; i < bars; i++) {
        const a = -Math.PI / 2 + i * step;
        const amp = smooth[i]!;
        const len = Math.max(1.5, amp * base * 0.42);
        const x1 = cx + Math.cos(a) * base;
        const y1 = cy + Math.sin(a) * base;
        const x2 = cx + Math.cos(a) * (base + len);
        const y2 = cy + Math.sin(a) * (base + len);
        ctx.lineWidth = Math.max(1, base * 0.022);
        ctx.globalAlpha = 0.28 + amp * 0.72;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(1, base * 0.006);
      ctx.strokeStyle = "rgba(226,205,158,0.5)";
      ctx.beginPath();
      ctx.arc(cx, cy, base * 0.985, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [bars, radius]);

  return (
    <canvas
      ref={canvasRef}
      className={clsx("pointer-events-none absolute inset-0 h-full w-full", !playing && "opacity-35", className)}
      style={{ transition: "opacity 600ms ease" }}
      aria-hidden
    />
  );
}

/** Horizontal mirrored bars — used in the player bar when expanded. */
export function BarSpectrum({ className, bars = 48 }: { className?: string; bars?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const smooth = new Float32Array(bars);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const draw = () => {
      const spec = engine.readSpectrum();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const usable = Math.floor(spec.length * 0.5);
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        const idx = Math.min(usable - 1, Math.floor(Math.pow(i / bars, 1.4) * usable));
        const v = (spec[idx] ?? 0) / 255;
        smooth[i] = smooth[i]! * 0.7 + Math.pow(v, 1.3) * 0.3;
        const bh = Math.max(1.5, smooth[i]! * h * 0.95);
        const g = ctx.createLinearGradient(0, h - bh, 0, h);
        g.addColorStop(0, "rgba(240,220,168,0.95)");
        g.addColorStop(1, "rgba(47,191,143,0.55)");
        ctx.fillStyle = g;
        ctx.fillRect(i * bw + bw * 0.18, h - bh, bw * 0.64, bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [bars]);

  return <canvas ref={canvasRef} className={clsx("h-full w-full", className)} aria-hidden />;
}
