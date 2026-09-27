import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "@da2/shared";
import { post, ApiError } from "../lib/api";
import { useCart } from "../hooks/useCart";
import { useMe } from "../hooks/useAuth";
import { useTrackView } from "../hooks/useTrack";
import { track } from "../lib/tracker";

const FREE_SHIPPING_FROM = 50_000 * 100;
const SHIPPING_FEE = 500 * 100;

type Payment = "cod" | "card_approve" | "card_decline";
const PAYMENT_OPTIONS: { value: Payment; label: string; hint: string }[] = [
  { value: "cod", label: "Cash on delivery", hint: "Pay when your order arrives" },
  { value: "card_approve", label: "Card (simulated: approved)", hint: "Demo only: no card details are collected" },
  { value: "card_decline", label: "Card (simulated: declined)", hint: "Demo: shows a failed payment" },
];

export function CheckoutPage() {
  const cart = useCart();
  const { user } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", phone: "", line1: "", line2: "", city: "", postcode: "" });
  const [payment, setPayment] = useState<Payment>("cod");
  // Funnel step 3 (UC2)
  useTrackView("checkout_started", cart.data?.lines.length ? { cartValue: cart.data.subtotal, itemCount: cart.data.itemCount } : null);

  const placeOrder = useMutation({
    mutationFn: () =>
      post<{ orderNumber: string }>("/checkout", {
        contact: { name: form.name || user?.name, email: form.email || user?.email, phone: form.phone || undefined },
        address: { line1: form.line1, line2: form.line2 || undefined, city: form.city, postcode: form.postcode || undefined },
        payment,
      }),
    onSuccess: ({ orderNumber }) => {
      qc.invalidateQueries({ queryKey: ["cart"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      navigate(`/orders/${orderNumber}?placed=1`);
    },
    // A sold-out item changes the cart; refresh it so the summary shows what happened.
    onError: (e) => e instanceof ApiError && e.status === 409 && qc.invalidateQueries({ queryKey: ["cart"] }),
  });

  if (!cart.data) return <div className="h-64 animate-pulse rounded-3xl bg-slate-200/70" />;
  if (!cart.data.lines.length && !placeOrder.isPending) return <Navigate to="/cart" replace />;

  const { lines, subtotal } = cart.data;
  const shipping = subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      className="grid gap-8 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        track("payment_submitted", { method: payment });
        placeOrder.mutate();
      }}
    >
      <div className="flex flex-col gap-6 lg:col-span-2">
        <h1 className="text-2xl font-extrabold">Checkout</h1>

        <Section title="Contact">
          {user ? (
            <p className="text-sm text-slate-600">
              Ordering as <span className="font-semibold">{user.name}</span> ({user.email})
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              Checking out as a guest.{" "}
              <Link to="/login?next=/checkout" className="text-accent-600 hover:underline">
                Log in
              </Link>{" "}
              to save this order to your account.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {!user && <Input label="Full name" value={form.name} onChange={set("name")} required autoComplete="name" />}
            {!user && <Input label="Email" type="email" value={form.email} onChange={set("email")} required autoComplete="email" />}
            <Input label="Phone (optional)" value={form.phone} onChange={set("phone")} autoComplete="tel" />
          </div>
        </Section>

        <Section title="Delivery address">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Address line 1" value={form.line1} onChange={set("line1")} required autoComplete="address-line1" className="sm:col-span-2" />
            <Input label="Address line 2 (optional)" value={form.line2} onChange={set("line2")} autoComplete="address-line2" className="sm:col-span-2" />
            <Input label="City" value={form.city} onChange={set("city")} required autoComplete="address-level2" />
            <Input label="Postcode (optional)" value={form.postcode} onChange={set("postcode")} autoComplete="postal-code" />
          </div>
        </Section>

        <Section title="Payment">
          <div className="flex flex-col gap-2">
            {PAYMENT_OPTIONS.map((o) => (
              <label key={o.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${payment === o.value ? "border-accent-600 bg-accent-50" : "border-slate-200"}`}>
                <input type="radio" name="payment" className="accent-accent-600" checked={payment === o.value} onChange={() => setPayment(o.value)} />
                <span className="text-sm">
                  <span className="font-semibold">{o.label}</span>
                  <span className="block text-xs text-slate-500">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Section>
      </div>

      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-6 lg:mt-14">
        <h2 className="mb-4 text-lg font-bold">Order summary</h2>
        <ul className="mb-4 flex flex-col gap-2 text-sm">
          {lines.map((l) => (
            <li key={l.sku} className="flex justify-between gap-3">
              <span>
                {l.qty} × {l.name} <span className="text-slate-500">({l.variantLabel})</span>
                {!l.available && <span className="block text-xs font-medium text-rose-600">{l.stock === 0 ? "Sold out" : `Only ${l.stock} left`}</span>}
              </span>
              <span className="font-medium whitespace-nowrap">{formatMoney(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <Row label="Subtotal" value={formatMoney(subtotal)} />
        <Row label="Delivery" value={shipping ? formatMoney(shipping) : "Free"} />
        <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 font-bold">
          <span>Total</span>
          <span>{formatMoney(subtotal + shipping)}</span>
        </div>
        {placeOrder.error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{placeOrder.error.message}</p>}
        <button disabled={placeOrder.isPending} className="mt-6 w-full rounded-full bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
          {placeOrder.isPending ? "Placing order…" : "Place order"}
        </button>
        <p className="mt-2 text-center text-xs text-slate-400">Free delivery on orders over {formatMoney(FREE_SHIPPING_FROM)}</p>
      </aside>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Input(props: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; autoComplete?: string; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium ${props.className ?? ""}`}>
      {props.label}
      <input
        type={props.type ?? "text"}
        value={props.value}
        required={props.required}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-accent-500"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
