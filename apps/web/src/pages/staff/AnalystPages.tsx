// Analyst dashboards (UC1–UC3). All data comes from /api/analytics/*, which reads the rollups and
// Redis counters through the read-only analyst connection.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FUNNEL_STEPS, type FunnelResponse, type LiveActivity, type TopResponse, type TrendsResponse } from "@da2/shared";
import { api, qs } from "../../lib/api";
import {
  Badge,
  BarChart,
  Card,
  DateRangePicker,
  Empty,
  ErrorNote,
  ExportButtons,
  HBars,
  Loading,
  PageHeader,
  SourceNote,
  Stat,
  Table,
  eventLabel,
  fmtNum,
  fmtPct,
  fmtTime,
  lastDays,
  type DateRange,
} from "../../components/staff/ui";

const STEP_LABELS: Record<string, string> = {
  product_view: "Viewed a product",
  add_to_cart: "Added to cart",
  checkout_started: "Started checkout",
  order_placed: "Placed an order",
};
const DEVICES = ["mobile", "desktop", "tablet"] as const;
const TYPE_TONE: Record<string, "slate" | "green" | "amber" | "red" | "blue" | "accent"> = {
  order_placed: "green",
  checkout_failed: "red",
  add_to_cart: "accent",
  checkout_started: "amber",
  search: "blue",
};
const localTime = (iso: string) => new Date(iso).toLocaleTimeString("en-LK", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hour12: false });

// ---- UC1: live activity --------------------------------------------------------------------------

export function LivePage() {
  // Polls every 5 s; the API caches for 5 s, so any number of open dashboards cost one computation
  const live = useQuery({ queryKey: ["analytics", "live"], queryFn: () => api<LiveActivity>("/analytics/live"), refetchInterval: 5000 });
  if (live.isError) return <ErrorNote error={live.error} />;
  const d = live.data;
  const lastMinute = d?.perMinute.at(-2); // the current minute is still filling up
  const last30 = d?.perMinute.reduce((n, m) => n + m.events, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Live activity"
        subtitle="Right now on the store. Refreshes every 5 seconds from Redis counters written by the ingest worker."
        actions={d && <SourceNote source="Redis HyperLogLog + counters, latest events" cached={d.cached} at={d.generatedAt} />}
      />
      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Active sessions" value={fmtNum(d.activeSessions)} hint={`unique, last ${d.activeWindowMin} min (PFCOUNT)`} tone={d.activeSessions ? "good" : "default"} />
            <Stat label="Events last minute" value={fmtNum(lastMinute?.events ?? 0)} hint={`${fmtNum(lastMinute?.active ?? 0)} sessions`} />
            <Stat label="Events, 30 min" value={fmtNum(last30)} />
            <Stat label="Orders, 5 min" value={fmtNum(d.byType.order_placed ?? 0)} hint={`${fmtNum(d.byType.checkout_failed ?? 0)} failed checkouts`} tone={d.byType.order_placed ? "good" : "default"} />
          </div>

          <Card title="Events per minute" subtitle="Last 30 minutes (evt:all:{minute})">
            <BarChart data={d.perMinute.map((m) => ({ x: localTime(m.minute + "Z"), y: m.events }))} label={(p) => `${p.x}: ${fmtNum(p.y)} events`} height={140} />
            {last30 === 0 && <p className="mt-3 text-center text-xs text-slate-400">Quiet right now. Run <code>npm run sim:live</code> or browse the store to see traffic.</p>}
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Last 5 minutes by type">
              {Object.keys(d.byType).length ? (
                <HBars rows={Object.entries(d.byType).sort(([, a], [, b]) => b - a).map(([type, n]) => ({ label: eventLabel(type), value: n }))} />
              ) : (
                <Empty>No events</Empty>
              )}
            </Card>
            <Card title="Top pages" subtitle="Last 60 minutes">
              {d.topPages.length ? <HBars rows={d.topPages.map((p) => ({ label: p.path, value: p.views }))} color="bg-sky-500" /> : <Empty>No page views</Empty>}
            </Card>
            <Card title="Most viewed products" subtitle="Last 60 minutes">
              {d.topProducts.length ? <HBars rows={d.topProducts.map((p) => ({ label: p.name, value: p.views }))} color="bg-emerald-500" /> : <Empty>No product views</Empty>}
            </Card>
          </div>

          <Card title="Latest events" subtitle="Newest first, from the events time-series collection">
            {d.recent.length ? (
              <Table head={["Time", "Event", "Detail", "Page", "Device", "Session"]} dense>
                {d.recent.map((e, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap text-slate-500 tabular-nums">{fmtTime(e.ts)}</td>
                    <td>
                      <Badge tone={TYPE_TONE[e.type] ?? "slate"}>{eventLabel(e.type)}</Badge>
                    </td>
                    <td className="max-w-56 truncate">{e.detail ?? ""}</td>
                    <td className="max-w-48 truncate text-slate-500">{e.path}</td>
                    <td className="text-slate-500">{e.device}</td>
                    <td className="font-mono text-xs text-slate-400">
                      {e.sessionId.slice(0, 8)}
                      {e.loggedIn && <span className="ml-1 text-accent-600">●</span>}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>No events in the last hour</Empty>
            )}
          </Card>
        </>
      )}
    </>
  );
}

// ---- UC2: funnel ---------------------------------------------------------------------------------

export function FunnelPage() {
  const [range, setRange] = useState<DateRange>(lastDays(14));
  const [device, setDevice] = useState<string>("");
  const funnel = useQuery({
    queryKey: ["analytics", "funnel", range, device],
    queryFn: () => api<FunnelResponse>(`/analytics/funnel${qs({ ...range, device })}`),
    placeholderData: keepPreviousData,
  });
  const f = funnel.data;
  const overall = f?.steps.at(-1)?.fromStart ?? 0;
  // Compare devices over the same range (from the unfiltered response's byDevice)
  const all = useQuery({ queryKey: ["analytics", "funnel", range, ""], queryFn: () => api<FunnelResponse>(`/analytics/funnel${qs(range)}`), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader
        title="Purchase funnel"
        subtitle="Sessions that reached each step in order: product view → add to cart → checkout → order."
        actions={<ExportButtons report="funnel" range={range} />}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <select value={device} onChange={(e) => setDevice(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
          <option value="">All devices</option>
          {DEVICES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      {funnel.isError && <ErrorNote error={funnel.error} />}
      {!f ? (
        <Loading h="h-80" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Sessions viewing products" value={fmtNum(f.steps[0].sessions)} />
            <Stat label="Orders" value={fmtNum(f.steps[3].sessions)} tone="good" />
            <Stat label="Overall conversion" value={fmtPct(overall, 2)} hint="orders ÷ product-view sessions" />
            <Stat label="Cart → order" value={fmtPct(f.steps[1].sessions ? f.steps[3].sessions / f.steps[1].sessions : 0)} hint="checkout completion" />
          </div>

          <Card title={`Funnel${f.device ? ` · ${f.device}` : ""}`} actions={<SourceNote source="funnel_daily rollup" cached={f.cached} />}>
            <div className="flex flex-col gap-3">
              {f.steps.map((s, i) => (
                <div key={s.step} className="grid grid-cols-[10rem_1fr_9rem] items-center gap-4 text-sm">
                  <div>
                    <div className="font-semibold">{STEP_LABELS[s.step]}</div>
                    <div className="text-xs text-slate-400">{s.step}</div>
                  </div>
                  <div className="h-9 rounded-lg bg-slate-100">
                    <div className="flex h-9 items-center rounded-lg bg-accent-500 px-3 text-xs font-bold text-white" style={{ width: `${Math.max(s.fromStart * 100, 3)}%` }}>
                      {s.fromStart >= 0.08 && fmtNum(s.sessions)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold tabular-nums">{fmtNum(s.sessions)}</div>
                    <div className="text-xs text-slate-500">{i === 0 ? "start" : `${fmtPct(s.fromPrevious)} of previous · −${fmtPct(1 - s.fromPrevious, 0)}`}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Conversion by device" subtitle="Same funnel, split by device type">
              {all.data && (
                <Table head={["Device", "Viewed", "Cart", "Checkout", "Orders", "Conversion"]}>
                  {Object.entries(all.data.byDevice)
                    .sort(([, a], [, b]) => b[0] - a[0])
                    .map(([dev, s]) => (
                      <tr key={dev}>
                        <td className="font-semibold capitalize">{dev}</td>
                        {s.map((n, i) => (
                          <td key={i} className="tabular-nums">
                            {fmtNum(n)}
                          </td>
                        ))}
                        <td className="font-semibold tabular-nums">{fmtPct(s[0] ? s[3] / s[0] : 0, 2)}</td>
                      </tr>
                    ))}
                </Table>
              )}
            </Card>
            <Card title="Orders per day" subtitle="Local days (Asia/Colombo)">
              <BarChart data={f.byDay.map((d) => ({ x: d.day.slice(5), y: d.steps[3] }))} color="#10b981" label={(p) => `${p.x}: ${p.y} orders`} height={150} />
            </Card>
          </div>

          <Card title="By day">
            <Table head={["Day", ...FUNNEL_STEPS.map((s) => STEP_LABELS[s]), "Conversion"]} dense>
              {[...f.byDay].reverse().map((d) => (
                <tr key={d.day}>
                  <td className="font-semibold whitespace-nowrap">{d.day}</td>
                  {d.steps.map((n, i) => (
                    <td key={i} className="tabular-nums">
                      {fmtNum(n)}
                    </td>
                  ))}
                  <td className="tabular-nums">{fmtPct(d.steps[0] ? d.steps[3] / d.steps[0] : 0, 2)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

// ---- UC1 + UC3: trends and top lists -------------------------------------------------------------

export function TrendsPage() {
  const [range, setRange] = useState<DateRange>(lastDays(14));
  const [type, setType] = useState("page_view");
  const trends = useQuery({ queryKey: ["analytics", "trends", range], queryFn: () => api<TrendsResponse>(`/analytics/trends${qs(range)}`), placeholderData: keepPreviousData });
  const top = useQuery({ queryKey: ["analytics", "top", range], queryFn: () => api<TopResponse>(`/analytics/top${qs(range)}`), placeholderData: keepPreviousData });
  const t = trends.data;

  // Average profile by local hour of day: shows when customers shop
  const byHourOfDay = Array.from({ length: 24 }, (_, h) => ({ x: String(h).padStart(2, "0"), y: 0 }));
  const days = new Set<string>();
  for (const h of t?.hours ?? []) {
    const local = new Date(new Date(h.hour).getTime() + 5.5 * 3_600_000);
    byHourOfDay[local.getUTCHours()].y += h.counts[type] ?? 0;
    days.add(local.toISOString().slice(0, 10));
  }
  byHourOfDay.forEach((b) => (b.y = Math.round(b.y / Math.max(1, days.size))));

  return (
    <>
      <PageHeader title="Trends & top lists" subtitle="Hourly activity from the metrics_hourly rollup; top products and searches from raw events (cached)." />
      <DateRangePicker value={range} onChange={setRange} />
      {trends.isError && <ErrorNote error={trends.error} />}

      <Card
        title="Hourly activity"
        subtitle="Sri Lanka local hours"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {t && <SourceNote source="metrics_hourly rollup" cached={t.cached} />}
            <ExportButtons report="trends" range={range} />
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(t?.types ?? []).map((ty) => (
            <button
              key={ty}
              onClick={() => setType(ty)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${ty === type ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {eventLabel(ty)}
            </button>
          ))}
        </div>
        {!t ? (
          <Loading />
        ) : (
          <BarChart
            data={t.hours.map((h) => ({ x: new Date(h.hour).toLocaleDateString("en-LK", { timeZone: "Asia/Colombo", month: "short", day: "numeric" }), y: h.counts[type] ?? 0, hour: h.hour }))}
            label={(p: any) => `${new Date(p.hour).toLocaleString("en-LK", { timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "short" })}: ${fmtNum(p.y)}`}
            ticks={7}
          />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Average by hour of day" subtitle={`${eventLabel(type)} per local hour, averaged over ${days.size} days`}>
          <BarChart data={byHourOfDay} color="#0ea5e9" ticks={8} label={(p) => `${p.x}:00 — ${fmtNum(p.y)} per day`} />
        </Card>
        <Card title="Daily totals">
          {t && (
            <Table head={["Day", "Page views", "Product views", "Add to cart", "Orders"]} dense>
              {[...t.days].reverse().slice(0, 14).map((d) => (
                <tr key={d.day}>
                  <td className="font-semibold">{d.day}</td>
                  {["page_view", "product_view", "add_to_cart", "order_placed"].map((k) => (
                    <td key={k} className="tabular-nums">
                      {fmtNum(d.counts[k] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card title="Top products" subtitle="Most viewed, with how often a view led to an add-to-cart" actions={<ExportButtons report="top" range={range} />}>
        {!top.data ? (
          <Loading />
        ) : (
          <Table head={["Product", "Kind", "Views", "Added to cart", "Cart rate"]} dense>
            {top.data.products.map((p) => (
              <tr key={p.productId}>
                <td className="font-semibold">{p.name}</td>
                <td className="text-slate-500">{p.kind.replace(/_/g, " ")}</td>
                <td className="tabular-nums">{fmtNum(p.views)}</td>
                <td className="tabular-nums">{fmtNum(p.addToCart)}</td>
                <td className="tabular-nums">{fmtPct(p.cartRate)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Top searches">
          {top.data && (
            <HBars rows={top.data.searches.map((s) => ({ label: s.query, value: s.count, right: `${fmtNum(s.count)} · ~${s.avgResults} results` }))} color="bg-sky-500" />
          )}
        </Card>
        <Card title="Searches with no results" subtitle="Demand the catalogue doesn't meet">
          {top.data?.zeroResultSearches.length ? (
            <HBars rows={top.data.zeroResultSearches.map((s) => ({ label: s.query, value: s.count }))} color="bg-rose-500" />
          ) : (
            <Empty>None in this range</Empty>
          )}
        </Card>
      </div>
      {top.data && <SourceNote source="events (aggregation over {type, ts} index)" cached={top.data.cached} />}
    </>
  );
}
