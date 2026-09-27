import { Link } from "react-router";
import { formatMoney } from "@da2/shared";
import { useCart, useRemoveLine, useSetQty } from "../hooks/useCart";
import { useMe } from "../hooks/useAuth";
import { ProductVisual } from "../components/ProductVisual";
import { track } from "../lib/tracker";

export function CartPage() {
  const cart = useCart();
  const setQtyMutation = useSetQty();
  const removeMutation = useRemoveLine();

  // Cart changes are tracked after the server confirms them.
  const changeQty = (sku: string, from: number, to: number) =>
    setQtyMutation.mutate(
      { sku, qty: to },
      { onSuccess: () => (to === 0 ? track("remove_from_cart", { sku, qty: from }) : track("update_quantity", { sku, from, to })) },
    );
  const removeLine = (sku: string, qty: number) => removeMutation.mutate(sku, { onSuccess: () => track("remove_from_cart", { sku, qty }) });
  const { user } = useMe();

  if (!cart.data) return <div className="h-64 animate-pulse rounded-3xl bg-slate-200/70" />;
  const { lines, subtotal, itemCount } = cart.data;

  if (!lines.length) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-3xl font-extrabold">Your cart is empty</h1>
        <Link to="/c/phone" className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white">
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <section className="lg:col-span-2">
        <h1 className="mb-6 text-2xl font-extrabold">Cart ({itemCount})</h1>
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {lines.map((l) => (
            <li key={l.sku} className="flex gap-4 p-4">
              <div className="w-20 shrink-0">
                <ProductVisual kind={l.kind} brand={l.brand} size="sm" />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Link to={`/p/${l.slug}`} className="font-semibold hover:text-accent-700">
                  {l.name}
                </Link>
                <span className="text-sm text-slate-500">{l.variantLabel}</span>
                {!l.available && (
                  <span className="text-sm font-medium text-rose-600">{l.stock === 0 ? "Out of stock" : `Only ${l.stock} available`}</span>
                )}
                <div className="mt-auto flex items-center gap-3 pt-2">
                  <div className="flex items-center rounded-full border border-slate-200">
                    <QtyButton label="Decrease quantity" onClick={() => changeQty(l.sku, l.qty, l.qty - 1)}>
                      −
                    </QtyButton>
                    <span className="w-8 text-center text-sm font-medium">{l.qty}</span>
                    <QtyButton label="Increase quantity" disabled={l.qty >= Math.min(l.stock, 10)} onClick={() => changeQty(l.sku, l.qty, l.qty + 1)}>
                      +
                    </QtyButton>
                  </div>
                  <button onClick={() => removeLine(l.sku, l.qty)} className="text-sm text-slate-500 hover:text-rose-600">
                    Remove
                  </button>
                </div>
              </div>
              <div className="text-right font-bold">{formatMoney(l.lineTotal)}</div>
            </li>
          ))}
        </ul>
      </section>

      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-bold">Summary</h2>
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Subtotal</span>
          <span className="font-semibold">{formatMoney(subtotal)}</span>
        </div>
        <div className="mt-2 flex justify-between text-sm">
          <span className="text-slate-500">Delivery</span>
          <span className="text-slate-500">Calculated at checkout</span>
        </div>
        <Link to="/checkout" className="mt-6 block w-full rounded-full bg-slate-900 py-3 text-center text-sm font-semibold text-white hover:bg-slate-700">
          Checkout
        </Link>
        {!user && (
          <p className="mt-3 text-center text-xs text-slate-500">
            <Link to="/login?next=/cart" className="text-accent-600 hover:underline">
              Log in
            </Link>{" "}
            to save your cart. Guest checkout is also available.
          </p>
        )}
      </aside>
    </div>
  );
}

function QtyButton(props: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button aria-label={props.label} onClick={props.onClick} disabled={props.disabled} className="size-8 rounded-full text-lg leading-none hover:bg-slate-100 disabled:opacity-30">
      {props.children}
    </button>
  );
}
