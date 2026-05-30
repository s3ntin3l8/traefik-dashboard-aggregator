// Shared primitives, icons, helpers — ported from the design prototype's
// tv-ui.jsx (window globals -> ES exports).
import type { ReactNode } from "react";
import type { Snapshot } from "../lib/types";
import { statusKind, STATUS_LABEL } from "../lib/types";

export { statusKind, STATUS_LABEL };

type IconProps = { size?: number; fill?: string; stroke?: number; children?: ReactNode; vb?: number; d?: string };

const Icon = ({ d, size = 17, fill, stroke = 2, children, vb = 24 }: IconProps) => (
  <svg
    className="ico"
    width={size}
    height={size}
    viewBox={`0 0 ${vb} ${vb}`}
    fill={fill || "none"}
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children || <path d={d} />}
  </svg>
);

type IP = { size?: number };
export const Icons: Record<string, (p: IP) => JSX.Element> = {
  grid: (p) => (<Icon {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Icon>),
  route: (p) => (<Icon {...p}><circle cx="6" cy="19" r="2.4" /><circle cx="18" cy="5" r="2.4" /><path d="M8.5 18.5h6a3 3 0 0 0 3-3V8M15.5 5.5h-6a3 3 0 0 0-3 3v8" /></Icon>),
  server: (p) => (<Icon {...p}><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></Icon>),
  layers: (p) => (<Icon {...p}><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5M3 8v0" /></Icon>),
  pulse: (p) => (<Icon {...p}><path d="M3 12h4l2-7 4 14 2-7h6" /></Icon>),
  logs: (p) => (<Icon {...p}><path d="M4 6h10M4 12h16M4 18h12" /></Icon>),
  tcp: (p) => (<Icon {...p}><path d="M4 9h13l-3-3M20 15H7l3 3" /></Icon>),
  udp: (p) => (<Icon {...p}><path d="M4 12h10M14 12l-3-3M14 12l-3 3" /><path d="M17 8.5v7" opacity=".5" /><path d="M20 6.5v11" opacity=".25" /></Icon>),
  cert: (p) => (<Icon {...p}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" /><path d="m9 11.5 2 2 4-4" /></Icon>),
  search: (p) => (<Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></Icon>),
  sun: (p) => (<Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>),
  moon: (p) => (<Icon {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></Icon>),
  ext: (p) => (<Icon {...p} size={p.size || 13}><path d="M14 5h5v5M19 5l-8 8M11 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" /></Icon>),
  x: (p) => (<Icon {...p}><path d="M18 6 6 18M6 6l12 12" /></Icon>),
  chevright: (p) => (<Icon {...p} size={p.size || 16}><path d="m9 6 6 6-6 6" /></Icon>),
  lock: (p) => (<Icon {...p} size={p.size || 13}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon>),
  alert: (p) => (<Icon {...p}><path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></Icon>),
  refresh: (p) => (<Icon {...p} size={p.size || 15}><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v5h-5" /></Icon>),
  globe: (p) => (<Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18A14 14 0 0 1 12 3Z" /></Icon>),
  cog: (p) => (<Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></Icon>),
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const k = statusKind(status);
  return (
    <span className={`badge ${k}`}>
      <span className={`sdot s-${k}`}></span>
      {label || STATUS_LABEL[status] || status}
    </span>
  );
}

export function InstanceTag({ name, snapshot }: { name: string; snapshot: Snapshot }) {
  const inst = snapshot.instances.find((i) => i.name === name);
  const k = inst ? statusKind(inst.status) : "ok";
  return (
    <span className="itag">
      <span className="dot" style={{ background: `var(--${k})` }}></span>
      {name}
    </span>
  );
}

export function MwList({ items, max = 3 }: { items?: string[]; max?: number }) {
  if (!items || !items.length) return <span className="faint">—</span>;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <span className="mw-list">
      {shown.map((m) => (
        <span className="mw" key={m}>{m.replace(/@.*/, "")}</span>
      ))}
      {rest > 0 && <span className="mw-more">+{rest}</span>}
    </span>
  );
}

export type Sort = { key: string; dir: "asc" | "desc" };
export function SortHead({ col, label, sort, setSort, align }: { col: string; label: string; sort: Sort; setSort: (s: Sort) => void; align?: "left" | "right" | "center" }) {
  const active = sort.key === col;
  return (
    <th className="sortable" style={{ textAlign: align }} onClick={() => setSort({ key: col, dir: active && sort.dir === "asc" ? "desc" : "asc" })}>
      {label}
      <span className="th-sort">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
    </th>
  );
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
export function clockHMS(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
}
