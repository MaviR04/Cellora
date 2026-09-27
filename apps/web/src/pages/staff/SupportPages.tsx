// Customer Support dashboards (UC12–UC14): find a customer, see their sessions, orders and cart,
// replay a session's timeline, work the failed-checkout and escalation queues.
// Contact details arrive already masked from the API for the support role.
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, type CustomerDetail, type FailedCheckout, type Order, type SearchHit, type SessionDetail, type SessionNote, type SessionSummary } from "@da2/shared";
import { api, patch, post, qs } from "../../lib/api";
import { useMe } from "../../hooks/useAuth";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Loading,
  PageHeader,
  Stat,
  Table,
  TextLink,
  eventLabel,
  fmtAgo,
  fmtDateTime,
  fmtDuration,
  fmtNum,
  fmtTime,
  inputClass,
} from "../../components/staff/ui";

const REASON_LABEL: Record<FailedCheckout["reason"], string> = { out_of_stock: "Out of stock", payment_declined: "Payment declined", validation: "Invalid details" };
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const sessionPath = (id: string) => `/staff/support/sessions/${id}`;
const customerPath = (id: string) => `/staff/support/customers/${id}`;
const orderPath = (n: string) => `/staff/support/orders/${n}`;

function MaskNote() {
  const { user } = useMe();
  return user?.role === "support" ? <Badge tone="amber">Contact details masked for your role</Badge> : null;
}

// ---- Find a customer ----------------------------------------------------------------------------

export function SupportSearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const results = useQuery({ queryKey: ["support", "search", q], queryFn: () => api<{ hits: SearchHit[] }>(`/support/search${qs({ q })}`), enabled: q.length >= 2 });

  return (
    <>
      <PageHeader title="Find a customer" subtitle="Search by email (prefix), order number (ORD-…) or an anonymous / session id read from the customer's device." actions={<MaskNote />} />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(input.trim() ? { q: input.trim() } : {});
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. customer@  ·  ORD-20260927-0001  ·  a1f0c2…" className={`${inputClass} flex-1 py-2`} autoFocus />
        <Button tone="primary">Search</Button>
      </form>
      {results.isError && <ErrorNote error={results.error} />}
      {q && results.data && (
        <Card title={`${results.data.hits.length} result${results.data.hits.length === 1 ? "" : "s"} for “${q}”`}>
          {results.data.hits.length ? (
            <ul className="divide-y divide-slate-100">
              {results.data.hits.map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold">
                      <Badge tone={h.kind === "customer" ? "accent" : h.kind === "order" ? "green" : "slate"}>{h.kind}</Badge>
                      {h.label}
                    </div>
                    <div className="text-sm text-slate-500">{h.sublabel}</div>
                  </div>
                  <div className="flex gap-3 text-sm">
                    {h.customerId && <TextLink to={customerPath(h.customerId)}>Customer</TextLink>}
                    {h.orderNumber && <TextLink to={orderPath(h.orderNumber)}>Order</TextLink>}
                    {h.sessionId && <TextLink to={sessionPath(h.sessionId)}>Session</TextLink>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No matches</Empty>
          )}
        </Card>
      )}
    </>
  );
}

// ---- Customer 360 (UC12 + UC13) -----------------------------------------------------------------

export function CustomerPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["support", "customer", id], queryFn: () => api<CustomerDetail>(`/support/customers/${id}`) });
  if (q.isError) return <ErrorNote error={q.error} />;
  if (!q.data) return <Loading h="h-96" />;
  const { customer: c, sessions, orders, cart, notes } = q.data;
  const spent = orders.reduce((n, o) => n + (o.totals?.total ?? 0), 0);

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={
          <>
            {c.email} · {c.role} · joined {fmtDateTime(c.createdAt)}
            {c.lastLoginAt && <> · last login {fmtAgo(c.lastLoginAt)}</>}
          </>
        }
        actions={
          <>
            {c.status !== "active" && <Badge tone="red">{c.status}</Badge>}
            <MaskNote />
          </>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Sessions" value={fmtNum(sessions.length)} hint={`${c.anonymousIds.length} linked browser${c.anonymousIds.length === 1 ? "" : "s"}`} />
        <Stat label="Orders" value={fmtNum(orders.length)} hint={formatMoney(spent)} />
        <Stat label="In cart now" value={fmtNum(cart.itemCount)} hint={cart.itemCount ? formatMoney(cart.subtotal) : "empty"} />
        <Stat label="Failed checkouts" value={fmtNum(sessions.filter((s) => s.hadCheckoutFailure).length)} tone={sessions.some((s) => s.hadCheckoutFailure) ? "warn" : "default"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Orders" subtitle="UC13 · newest first">
          {orders.length ? (
            <Table head={["Order", "Placed", "Items", "Total", "Status"]} dense>
              {orders.map((o) => (
                <tr key={o.orderNumber}>
                  <td className="whitespace-nowrap">
                    <TextLink to={orderPath(o.orderNumber)}>{o.orderNumber}</TextLink>
                  </td>
                  <td className="whitespace-nowrap text-slate-500">{fmtDateTime(o.createdAt)}</td>
                  <td className="max-w-40 truncate">{o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</td>
                  <td className="tabular-nums">{formatMoney(o.totals.total)}</td>
                  <td>
                    <Badge>{o.status}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No orders</Empty>
          )}
        </Card>
        <Card title="Current cart" subtitle="Live from Redis (cart:u:{id}), priced from MongoDB">
          {cart.lines.length ? (
            <Table head={["Item", "Qty", "Price", "Stock"]} dense>
              {cart.lines.map((l) => (
                <tr key={l.sku}>
                  <td>
                    <div className="font-semibold">{l.name}</div>
                    <div className="text-xs text-slate-500">{l.variantLabel}</div>
                  </td>
                  <td>{l.qty}</td>
                  <td className="tabular-nums">{formatMoney(l.lineTotal)}</td>
                  <td>{l.stock < l.qty ? <Badge tone="red">only {l.stock}</Badge> : <Badge tone="green">{l.stock}</Badge>}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>Cart is empty</Empty>
          )}
        </Card>
      </div>

      <Card title="Sessions" subtitle="UC12 · from the session_summaries rollup (logged-in sessions and anonymous ones on linked browsers)">
        <SessionsTable sessions={sessions} />
      </Card>

      <Card title="Notes">
        <NotesList notes={notes} showSession />
      </Card>
    </>
  );
}

function StepDots({ reached }: { reached: SessionSummary["reached"] }) {
  const steps = [reached.productView, reached.addToCart, reached.checkoutStarted, reached.orderPlaced];
  return (
    <span className="flex gap-1" title="product view · cart · checkout · order">
      {steps.map((on, i) => (
        <span key={i} className={`h-2.5 w-2.5 rounded-full ${on ? (i === 3 ? "bg-emerald-500" : "bg-accent-500") : "bg-slate-200"}`} />
      ))}
    </span>
  );
}

function SessionsTable({ sessions }: { sessions: SessionSummary[] }) {
  if (!sessions.length) return <Empty>No sessions</Empty>;
  return (
    <Table head={["Started", "Device", "Landing page", "Events", "Duration", "Funnel", ""]} dense>
      {sessions.map((s) => (
        <tr key={s._id}>
          <td className="whitespace-nowrap">
            <TextLink to={sessionPath(s._id)}>{fmtDateTime(s.startedAt)}</TextLink>
          </td>
          <td className="text-slate-500">{s.device ? `${s.device.type} · ${s.device.os}` : ""}</td>
          <td className="max-w-40 truncate text-slate-500">{s.landingPath && safeDecode(s.landingPath)}</td>
          <td className="tabular-nums">{s.eventCount}</td>
          <td className="tabular-nums">{fmtDuration(s.durationSec)}</td>
          <td>
            <StepDots reached={s.reached} />
          </td>
          <td className="flex gap-1">
            {s.customerId ? <Badge tone="accent">logged in</Badge> : <Badge>anonymous</Badge>}
            {s.hadCheckoutFailure && <Badge tone="red">checkout failed</Badge>}
          </td>
        </tr>
      ))}
    </Table>
  );
}

// ---- Session timeline (UC12) + notes (UC14) -----------------------------------------------------

const TIMELINE_TONE: Record<string, string> = {
  order_placed: "bg-emerald-500",
  checkout_failed: "bg-rose-500",
  add_to_cart: "bg-accent-500",
  checkout_started: "bg-amber-500",
  payment_submitted: "bg-amber-500",
  identify: "bg-sky-500",
};

function describe(e: SessionDetail["events"][number]) {
  const p = e.props as Record<string, any>;
  switch (e.type) {
    case "search":
      return `searched “${p.query}” → ${p.resultCount} results`;
    case "add_to_cart":
      return `added ${p.qty} × ${p.sku} (${formatMoney(p.unitPrice)})`;
    case "remove_from_cart":
      return `removed ${p.sku}`;
    case "update_quantity":
      return `changed ${p.sku} quantity ${p.from} → ${p.to}`;
    case "checkout_started":
      return `started checkout: ${p.itemCount} items, ${formatMoney(p.cartValue)}`;
    case "payment_submitted":
      return `submitted payment (${p.method})`;
    case "order_placed":
      return `placed order ${p.orderNumber} (${formatMoney(p.total)})`;
    case "checkout_failed":
      return `checkout failed: ${REASON_LABEL[p.reason as FailedCheckout["reason"]] ?? p.reason}${p.sku ? ` (${p.sku})` : ""}`;
    case "identify":
      return `logged in (${p.via}): earlier anonymous events linked to the account`;
    case "category_view":
      return `browsed ${String(p.kind).replace(/_/g, " ")}`;
    case "product_view":
      return `viewed a ${String(p.kind).replace(/_/g, " ")} (${formatMoney(p.basePrice)})`;
    default:
      return "";
  }
}

export function SessionPage() {
  const { sessionId } = useParams();
  const q = useQuery({ queryKey: ["support", "session", sessionId], queryFn: () => api<SessionDetail>(`/support/sessions/${sessionId}`) });
  if (q.isError) return <ErrorNote error={q.error} />;
  if (!q.data) return <Loading h="h-96" />;
  const { summary: s, events, customer, orders, notes } = q.data;

  return (
    <>
      <PageHeader
        title="Session timeline"
        subtitle={<span className="font-mono text-xs">{q.data.sessionId}</span>}
        actions={
          customer ? (
            <Link to={customerPath(customer._id)} className="rounded-full bg-accent-50 px-3 py-1.5 text-sm font-semibold text-accent-700">
              {customer.name} · {customer.email}
            </Link>
          ) : (
            <Badge>anonymous visitor</Badge>
          )
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Started" value={<span className="text-lg">{fmtDateTime(events[0]?.ts ?? s?.startedAt ?? "")}</span>} hint={s?.device ? `${s.device.type} · ${s.device.os} · ${s.device.browser}` : undefined} />
        <Stat label="Events" value={fmtNum(events.length)} hint={s ? `lasted ${fmtDuration(s.durationSec)}` : "not rolled up yet"} />
        <Stat label="Orders" value={orders.length} tone={orders.length ? "good" : "default"} hint={orders.map((o) => o.orderNumber).join(", ")} />
        <Stat label="Checkout failures" value={events.filter((e) => e.type === "checkout_failed").length} tone={events.some((e) => e.type === "checkout_failed") ? "bad" : "default"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card title="What happened" subtitle="Raw events for this session (index {meta.sessionId, ts}), always up to the second">
          <ol className="relative flex flex-col gap-3 border-l border-slate-200 pl-5">
            {events.map((e, i) => (
              <li key={i} className="relative text-sm">
                <span className={`absolute top-1.5 -left-[1.6rem] h-2.5 w-2.5 rounded-full ring-4 ring-white ${TIMELINE_TONE[e.type] ?? "bg-slate-300"}`} />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs text-slate-400 tabular-nums">{fmtTime(e.ts)}</span>
                  <span className="font-semibold">{eventLabel(e.type)}</span>
                  {e.source === "server" && <Badge tone="blue">server</Badge>}
                  <span className="text-slate-600">{describe(e)}</span>
                </div>
                {e.path && <div className="text-xs text-slate-400">{e.path}</div>}
              </li>
            ))}
          </ol>
        </Card>
        <div className="flex flex-col gap-6">
          {orders.length > 0 && (
            <Card title="Orders from this session">
              <ul className="flex flex-col gap-2 text-sm">
                {orders.map((o) => (
                  <li key={o.orderNumber} className="flex justify-between">
                    <TextLink to={orderPath(o.orderNumber)}>{o.orderNumber}</TextLink>
                    <span>{formatMoney(o.total)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Notes" subtitle="UC14 · annotate or flag for escalation">
            <NotesList notes={notes} />
            <AddNote sessionId={q.data.sessionId} />
          </Card>
        </div>
      </div>
    </>
  );
}

function AddNote({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [flagged, setFlagged] = useState(false);
  const add = useMutation({
    mutationFn: () => post<SessionNote>(`/support/sessions/${sessionId}/notes`, { body, flagged }),
    onSuccess: () => {
      setBody("");
      setFlagged(false);
      qc.invalidateQueries({ queryKey: ["support"] });
    },
  });
  return (
    <form
      className="mt-4 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) add.mutate();
      }}
    >
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="What did the customer report? What did you do?" className={inputClass} />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
          Flag for escalation
        </label>
        <Button tone="primary" disabled={!body.trim() || add.isPending}>
          Add note
        </Button>
      </div>
      {add.isError && <ErrorNote error={add.error} />}
    </form>
  );
}

function NotesList({ notes, showSession }: { notes: (SessionNote & { customerName?: string })[]; showSession?: boolean }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SessionNote["status"] }) => patch<SessionNote>(`/support/notes/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["support"] }),
  });
  if (!notes.length) return <Empty>No notes yet</Empty>;
  return (
    <ul className="flex flex-col gap-3">
      {notes.map((n) => (
        <li key={n._id} className={`rounded-xl border p-3 text-sm ${n.flagged && n.status === "open" ? "border-rose-200 bg-rose-50/50" : "border-slate-200"}`}>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{n.authorName}</span>
            <span>{fmtAgo(n.createdAt)}</span>
            {n.flagged && <Badge tone={n.status === "open" ? "red" : "slate"}>escalated</Badge>}
            {n.status === "resolved" && <Badge tone="green">resolved{n.resolvedByName && ` by ${n.resolvedByName}`}</Badge>}
            {n.customerName && <span>· {n.customerName}</span>}
            {showSession && (
              <Link to={sessionPath(n.sessionId)} className="text-accent-600 hover:underline">
                session {n.sessionId.slice(0, 8)}
              </Link>
            )}
          </div>
          <p className="whitespace-pre-wrap">{n.body}</p>
          <div className="mt-2 text-right">
            <button
              onClick={() => update.mutate({ id: n._id, status: n.status === "open" ? "resolved" : "open" })}
              className="text-xs font-semibold text-accent-600 hover:underline"
              disabled={update.isPending}
            >
              {n.status === "open" ? "Mark resolved" : "Re-open"}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---- Queues --------------------------------------------------------------------------------------

export function FailedCheckoutsPage() {
  const [days, setDays] = useState(7);
  const q = useQuery({ queryKey: ["support", "failed", days], queryFn: () => api<{ failures: FailedCheckout[] }>(`/support/failed-checkouts${qs({ days })}`) });
  const failures = q.data?.failures ?? [];
  return (
    <>
      <PageHeader
        title="Failed checkouts"
        subtitle="Customers who tried to pay and couldn't: a proactive follow-up list. From checkout_failed server events (newest 50)."
        actions={
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputClass}>
            {[1, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                Last {d} day{d > 1 && "s"}
              </option>
            ))}
          </select>
        }
      />
      {q.isError && <ErrorNote error={q.error} />}
      {q.data && (
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Failures" value={failures.length} />
          <Stat label="Recovered in the same session" value={failures.filter((f) => f.recovered).length} tone="good" />
          <Stat label="Not recovered" value={failures.filter((f) => !f.recovered).length} tone="warn" />
        </div>
      )}
      <Card>
        {!q.data ? (
          <Loading />
        ) : failures.length ? (
          <Table head={["When", "Reason", "Customer", "Device", "Outcome", "Notes", ""]}>
            {failures.map((f, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap">{fmtDateTime(f.at)}</td>
                <td>
                  <Badge tone={f.reason === "out_of_stock" ? "amber" : "red"}>{REASON_LABEL[f.reason]}</Badge>
                  {f.sku && <div className="mt-0.5 text-xs text-slate-500">{f.sku}</div>}
                </td>
                <td>{f.customer ? <TextLink to={customerPath(f.customer._id)}>{f.customer.name}</TextLink> : <span className="text-slate-400">guest</span>}</td>
                <td className="text-slate-500">{f.device}</td>
                <td>{f.recovered ? <Badge tone="green">ordered later</Badge> : <Badge tone="amber">no order</Badge>}</td>
                <td className="tabular-nums">{f.noteCount || ""}</td>
                <td>
                  <TextLink to={sessionPath(f.sessionId)}>Open session</TextLink>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No failed checkouts in this period</Empty>
        )}
      </Card>
    </>
  );
}

export function EscalationsPage() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const q = useQuery({ queryKey: ["support", "escalations", status], queryFn: () => api<{ notes: (SessionNote & { customerName?: string })[] }>(`/support/escalations${qs({ status })}`) });
  return (
    <>
      <PageHeader
        title="Escalations"
        subtitle="Sessions flagged by an agent (session_notes, index {flagged, status, createdAt})."
        actions={
          <div className="flex gap-1">
            {(["open", "resolved"] as const).map((s) => (
              <Button key={s} tone={s === status ? "primary" : "default"} onClick={() => setStatus(s)}>
                {s === "open" ? "Open" : "Resolved"}
              </Button>
            ))}
          </div>
        }
      />
      {q.isError && <ErrorNote error={q.error} />}
      <Card>{!q.data ? <Loading /> : <NotesList notes={q.data.notes} showSession />}</Card>
    </>
  );
}

// ---- Any order (UC13) ----------------------------------------------------------------------------

export function StaffOrderPage() {
  const { orderNumber } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["support", "order", orderNumber], queryFn: () => api<Order & Record<string, any>>(`/support/orders/${orderNumber}`) });
  if (q.isError) return <ErrorNote error={q.error} />;
  if (!q.data) return <Loading h="h-96" />;
  const o = q.data;
  return (
    <>
      <PageHeader
        title={o.orderNumber}
        subtitle={`Placed ${fmtDateTime(o.createdAt)} · ${o.customerId ? "customer" : "guest"} order`}
        actions={
          <>
            <Badge tone="green">{o.status}</Badge>
            <MaskNote />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card title="Items" subtitle="Snapshot at the time of purchase">
          <Table head={["Item", "Variant", "Qty", "Unit price", "Total"]} dense>
            {o.items.map((i) => (
              <tr key={i.sku}>
                <td className="font-semibold">{i.name}</td>
                <td className="text-slate-500">{i.variantLabel}</td>
                <td>{i.qty}</td>
                <td className="tabular-nums">{formatMoney(i.unitPrice)}</td>
                <td className="tabular-nums">{formatMoney(i.lineTotal)}</td>
              </tr>
            ))}
          </Table>
          <div className="mt-4 flex flex-col items-end gap-1 text-sm">
            <div>Subtotal {formatMoney(o.totals.subtotal)}</div>
            <div>Delivery {o.totals.shipping ? formatMoney(o.totals.shipping) : "free"}</div>
            <div className="text-base font-bold">Total {formatMoney(o.totals.total)}</div>
          </div>
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="Customer">
            <div className="text-sm">
              <div className="font-semibold">{o.contact.name}</div>
              <div className="text-slate-500">{o.contact.email}</div>
              {o.contact.phone && <div className="text-slate-500">{o.contact.phone}</div>}
              <div className="mt-2 text-slate-500">
                {[o.shippingAddress?.line1, o.shippingAddress?.line2, o.shippingAddress?.city, o.shippingAddress?.postcode].filter(Boolean).join(", ")}
              </div>
            </div>
            <div className="mt-3 flex gap-3 text-sm">
              {o.customerId && <TextLink to={customerPath(o.customerId)}>Customer profile</TextLink>}
              {o.sessionId && <TextLink to={sessionPath(o.sessionId)}>Session</TextLink>}
            </div>
          </Card>
          <Card title="Payment & status">
            <div className="text-sm">
              {o.payment.method.toUpperCase()} · {o.payment.status}
            </div>
            <ul className="mt-2 text-xs text-slate-500">
              {o.statusHistory.map((h, i) => (
                <li key={i}>
                  {h.status} · {fmtDateTime(h.at)}
                </li>
              ))}
            </ul>
          </Card>
          <Button onClick={() => navigate(-1)}>← Back</Button>
        </div>
      </div>
    </>
  );
}
