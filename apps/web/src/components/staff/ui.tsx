// Small UI kit for the staff dashboards: cards, stats, tables, date ranges and hand-drawn SVG
// charts (no chart library: the charts here are simple, and it keeps the bundle small).
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

// ---- Formatting ---------------------------------------------------------------------------------

export const fmtNum = (n: number) => n.toLocaleString("en-LK");
export const fmtPct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
export const fmtBytes = (b: number) =>
  b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(0)} KB` : `${b} B`;
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-LK", { dateStyle: "medium", timeStyle: "short" });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-LK", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtDuration = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`);
export function fmtAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}
export const eventLabel = (type: string) => type.replace(/_/g, " ");

/** Sri Lanka local date, YYYY-MM-DD */
export const localDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

// ---- Layout pieces ------------------------------------------------------------------------------

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = "" }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="font-bold">{title}</h2>}
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const color = { default: "text-slate-900", good: "text-emerald-600", warn: "text-amber-600", bad: "text-rose-600" }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const BADGE = {
  slate: "bg-slate-100 text-slate-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-rose-50 text-rose-700",
  blue: "bg-sky-50 text-sky-700",
  accent: "bg-accent-50 text-accent-700",
};
export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: keyof typeof BADGE }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${BADGE[tone]}`}>{children}</span>;
}

/** Tells the viewer where the numbers came from (rollup / raw events / Redis) and whether it was a cache hit. */
export function SourceNote({ source, cached, at }: { source: string; cached?: boolean; at?: string }) {
  return (
    <span className="text-xs text-slate-400">
      Source: {source}
      {cached !== undefined && <> · {cached ? "Redis cache hit" : "computed (now cached)"}</>}
      {at && <> · {fmtTime(at)}</>}
    </span>
  );
}

export function Button({ children, tone = "default", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "primary" | "danger" }) {
  const styles = {
    default: "border border-slate-200 bg-white text-slate-700 hover:border-slate-400",
    primary: "bg-slate-900 text-white hover:bg-slate-700",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  }[tone];
  return (
    <button {...props} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export const inputClass = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-accent-500";

export function Loading({ h = "h-40" }: { h?: string }) {
  return <div className={`${h} animate-pulse rounded-2xl bg-slate-200/70`} />;
}

export function ErrorNote({ error }: { error: unknown }) {
  return <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error instanceof Error ? error.message : "Something went wrong"}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-400">{children}</p>;
}

export function Table({ head, children, dense }: { head: ReactNode[]; children: ReactNode; dense?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-left text-sm ${dense ? "[&_td]:py-1.5" : "[&_td]:py-2.5"}`}>
        <thead>
          <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
            {head.map((h, i) => (
              <th key={i} className="py-2 pr-4 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&_td]:pr-4 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-semibold text-accent-600 hover:underline">
      {children}
    </Link>
  );
}

// ---- Date range ---------------------------------------------------------------------------------

export type DateRange = { from: string; to: string };
export const lastDays = (n: number): DateRange => ({ from: localDay(new Date(Date.now() - (n - 1) * 86_400_000)), to: localDay(new Date()) });

export function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {[1, 7, 14, 30].map((n) => {
        const r = lastDays(n);
        const active = r.from === value.from && r.to === value.to;
        return (
          <button
            key={n}
            onClick={() => onChange(r)}
            className={`rounded-full px-3 py-1.5 font-semibold ${active ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}
          >
            {n === 1 ? "Today" : `${n} days`}
          </button>
        );
      })}
      <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className={inputClass} />
      <span className="text-slate-400">to</span>
      <input type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className={inputClass} />
    </div>
  );
}

/** Links that download a report from GET /api/analytics/export (UC3). */
export function ExportButtons({ report, range }: { report: "funnel" | "trends" | "top"; range: DateRange }) {
  const href = (format: string) => `/api/analytics/export?report=${report}&format=${format}&from=${range.from}&to=${range.to}`;
  return (
    <div className="flex gap-2">
      {["csv", "json"].map((f) => (
        <a key={f} href={href(f)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-400">
          Export {f.toUpperCase()}
        </a>
      ))}
    </div>
  );
}

// ---- Charts -------------------------------------------------------------------------------------

/** Vertical bar chart with hover tooltips. */
export function BarChart({
  data,
  height = 160,
  color = "var(--color-accent-500)",
  label,
  ticks = 6,
}: {
  data: { x: string; y: number }[];
  height?: number;
  color?: string;
  label?: (d: { x: string; y: number }) => string;
  ticks?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.y));
  const W = 1000;
  const bw = W / Math.max(1, data.length);
  const every = Math.max(1, Math.ceil(data.length / ticks));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height + 22}`} className="w-full" preserveAspectRatio="none" style={{ height: height + 22 }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={height - f * height} y2={height - f * height} stroke="#e2e8f0" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {data.map((d, i) => {
          const h = (d.y / max) * height;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * bw} y={0} width={bw} height={height} fill="transparent" />
              <rect x={i * bw + bw * 0.12} y={height - h} width={bw * 0.76} height={Math.max(h, d.y ? 1 : 0)} rx={Math.min(3, bw * 0.2)} fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute right-0 bottom-0 left-0 flex text-[10px] text-slate-400">
        {data.map((d, i) => (
          <div key={i} className="overflow-visible text-center whitespace-nowrap" style={{ width: `${100 / data.length}%` }}>
            {i % every === 0 ? d.x : ""}
          </div>
        ))}
      </div>
      <div className="absolute top-0 left-0 text-[10px] text-slate-400">{fmtNum(max)}</div>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-lg bg-slate-900 px-2 py-1 text-xs text-white">
          {label ? label(data[hover]) : `${data[hover].x}: ${fmtNum(data[hover].y)}`}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars, e.g. funnel steps or a top-N list. */
export function HBars({ rows, color = "bg-accent-500" }: { rows: { label: ReactNode; value: number; right?: ReactNode }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm">
          <div className="truncate text-slate-600">{r.label}</div>
          <div className="h-5 rounded bg-slate-100">
            <div className={`h-5 rounded ${color}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <div className="w-28 text-right font-semibold tabular-nums">{r.right ?? fmtNum(r.value)}</div>
        </li>
      ))}
    </ul>
  );
}
