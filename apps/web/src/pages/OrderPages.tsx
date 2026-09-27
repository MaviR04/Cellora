import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { formatMoney, type Order, type OrderSummary } from "@da2/shared";
import { api } from "../lib/api";
import { useMe } from "../hooks/useAuth";
import { NotFoundPage } from "./NotFoundPage";

const STATUS_STYLE: Record<Order["status"], string> = {
  placed: "bg-amber-50 text-amber-700",
  paid: "bg-emerald-50 text-emerald-700",
  shipped: "bg-sky-50 text-sky-700",
  delivered: "bg-slate-100 text-slate-700",
  cancelled: "bg-rose-50 text-rose-700",
};

const formatDate = (iso: string) => new Date(iso).toLocaleString("en-LK", { dateStyle: "medium", timeStyle: "short" });

function StatusBadge({ status }: { status: Order["status"] }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLE[status]}`}>{status}</span>;
}

export function OrderPage() {
  const { orderNumber } = useParams();
  const [params] = useSearchParams();
  const order = useQuery({ queryKey: ["order", orderNumber], queryFn: () => api<Order>(`/orders/${orderNumber}`), retry: false });

  if (order.isError) return <NotFoundPage message="We couldn't find that order." />;
  if (!order.data) return <div className="h-64 animate-pulse rounded-3xl bg-slate-200/70" />;
  const o = order.data;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {params.get("placed") && (
        <div className="rounded-3xl bg-emerald-600 px-8 py-8 text-white">
          <p className="text-sm font-semibold tracking-widest uppercase opacity-80">Thank you</p>
          <h1 className="mt-1 text-3xl font-extrabold">Your order is confirmed</h1>
          <p className="mt-2 opacity-90">
            Order number <span className="font-bold">{o.orderNumber}</span> for {o.contact.email}. Keep it handy if you contact support.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold">{o.orderNumber}</h2>
          <p className="text-sm text-slate-500">Placed {formatDate(o.createdAt)}</p>
        </div>
        <StatusBadge status={o.status} />
      </div>

      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {o.items.map((i) => (
          <li key={i.sku} className="flex justify-between gap-4 p-4 text-sm">
            <div>
              <div className="font-semibold">{i.name}</div>
              <div className="text-slate-500">
                {i.variantLabel} · {i.qty} × {formatMoney(i.unitPrice)}
              </div>
            </div>
            <div className="font-semibold">{formatMoney(i.lineTotal)}</div>
          </li>
        ))}
        <li className="flex flex-col gap-1 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Subtotal</span>
            <span>{formatMoney(o.totals.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Delivery</span>
            <span>{o.totals.shipping ? formatMoney(o.totals.shipping) : "Free"}</span>
          </div>
          <div className="mt-1 flex justify-between text-base font-bold">
            <span>Total</span>
            <span>{formatMoney(o.totals.total)}</span>
          </div>
        </li>
      </ul>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <h3 className="mb-2 font-bold">Delivery to</h3>
          <p>{o.contact.name}</p>
          <p className="text-slate-600">
            {o.shippingAddress.line1}
            {o.shippingAddress.line2 && <>, {o.shippingAddress.line2}</>}
            <br />
            {o.shippingAddress.city} {o.shippingAddress.postcode}, {o.shippingAddress.country}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <h3 className="mb-2 font-bold">Payment</h3>
          <p>{o.payment.method === "cod" ? "Cash on delivery" : "Card (simulated)"}</p>
          <p className="text-slate-600 capitalize">{o.payment.status}</p>
        </div>
      </div>

      <Link to="/" className="self-start text-sm font-medium text-accent-600 hover:underline">
        Continue shopping
      </Link>
    </div>
  );
}

export function OrdersPage() {
  const { user, isLoading } = useMe();
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<{ orders: OrderSummary[] }>("/orders"), enabled: !!user });

  if (isLoading) return null;
  if (!user) return <Navigate to="/login?next=/orders" replace />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-extrabold">My orders</h1>
      {orders.data?.orders.length === 0 && <p className="text-slate-500">You haven't placed any orders yet.</p>}
      <ul className="flex flex-col gap-3">
        {orders.data?.orders.map((o) => (
          <li key={o._id}>
            <Link to={`/orders/${o.orderNumber}`} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 hover:border-accent-500">
              <div>
                <div className="font-semibold">{o.orderNumber}</div>
                <div className="text-sm text-slate-500">
                  {formatDate(o.createdAt)} · {o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold">{formatMoney(o.totals.total)}</span>
                <StatusBadge status={o.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
