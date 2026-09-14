export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatClock(seconds: number): string {
  return formatTime(seconds);
}

export function formatTotal(seconds: number): string {
  if (seconds < 3600) return formatTime(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} hr ${m} min`;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} wk${weeks > 1 ? "s" : ""} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 4) return "Late-night dhikr";
  if (h < 6) return "Fajr hours";
  if (h < 12) return "Good morning";
  if (h < 15) return "Good afternoon";
  if (h < 18) return "Asr light";
  if (h < 21) return "Good evening";
  return "Peaceful night";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t[0]!.toUpperCase() + t.slice(1));
}
