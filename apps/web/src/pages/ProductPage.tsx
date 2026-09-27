import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { formatMoney, KIND_LABELS, type ProductDetail, type RelatedGroups } from "@da2/shared";
import { api, ApiError } from "../lib/api";
import { specRows } from "../lib/specs";
import { ProductVisual } from "../components/ProductVisual";
import { ProductCard } from "../components/ProductCard";
import { NotFoundPage } from "./NotFoundPage";
import { useAddToCart } from "../hooks/useCart";
import { useTrackView } from "../hooks/useTrack";
import { track } from "../lib/tracker";

export function ProductPage() {
  const { slug } = useParams();
  const product = useQuery({ queryKey: ["product", slug], queryFn: () => api<ProductDetail>(`/products/${slug}`) });
  const related = useQuery({ queryKey: ["related", slug], queryFn: () => api<RelatedGroups>(`/products/${slug}/related`) });
  const p = product.data;
  useTrackView("product_view", p ? { productId: p._id, kind: p.kind, basePrice: p.basePrice } : null, slug);

  if (product.error instanceof ApiError && product.error.status === 404) return <NotFoundPage message="That product doesn't exist." />;
  if (!product.data) return <div className="h-96 animate-pulse rounded-3xl bg-slate-200/70" />;

  return (
    <div className="flex flex-col gap-12">
      {/* key: reset the selected variant when navigating to another product */}
      <ProductDetails key={product.data._id} product={product.data} />
      {related.data?.groups.map((g) => (
        <section key={g.title}>
          <h2 className="mb-4 text-xl font-bold">{g.title}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {g.items.map((p) => (
              <ProductCard key={p._id} product={p} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProductDetails({ product: p }: { product: ProductDetail }) {
  const [sku, setSku] = useState(() => (p.variants.find((v) => v.stock > 0) ?? p.variants[0]).sku);
  const variant = p.variants.find((v) => v.sku === sku)!;
  const specs = specRows(p);
  const addToCart = useAddToCart();

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div className="mx-auto w-full max-w-md lg:max-w-none">
        <ProductVisual kind={p.kind} brand={p.brand} size="lg" />
      </div>

      <div className="flex flex-col gap-6">
        <div>
          <Link to={`/c/${p.kind}`} className="text-sm font-medium text-accent-600 hover:underline">
            {KIND_LABELS[p.kind]}
          </Link>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{p.name}</h1>
          <p className="mt-1 text-slate-500">{p.brand}</p>
        </div>

        <p className="text-slate-700">{p.description}</p>

        <div>
          <div className="text-3xl font-extrabold">{formatMoney(variant.price)}</div>
          <StockBadge stock={variant.stock} />
        </div>

        {p.variants.length > 1 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Options</h3>
            <div className="flex flex-wrap gap-2">
              {p.variants.map((v) => (
                <button
                  key={v.sku}
                  onClick={() => setSku(v.sku)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                    v.sku === sku ? "border-accent-600 bg-accent-50 ring-1 ring-accent-600" : "border-slate-200 bg-white hover:border-slate-400"
                  } ${v.stock === 0 ? "opacity-50" : ""}`}
                >
                  <div className="font-medium">{v.label}</div>
                  <div className="text-xs text-slate-500">{formatMoney(v.price)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            disabled={variant.stock === 0 || addToCart.isPending}
            onClick={() =>
              addToCart.mutate(
                { sku: variant.sku },
                { onSuccess: () => track("add_to_cart", { productId: p._id, sku: variant.sku, kind: p.kind, qty: 1, unitPrice: variant.price }) },
              )
            }
            className="flex-1 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {variant.stock === 0 ? "Out of stock" : addToCart.isPending ? "Adding…" : "Add to cart"}
          </button>
          {addToCart.isSuccess && addToCart.variables?.sku === variant.sku && (
            <Link to="/cart" className="text-sm font-medium text-emerald-600 hover:underline">
              Added ✓ View cart
            </Link>
          )}
        </div>
        {addToCart.error && <p className="text-sm text-rose-600">{addToCart.error.message}</p>}

        {specs.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Specifications</h3>
            <dl className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm">
              {specs.map(([label, value]) => (
                <div key={label} className="grid grid-cols-3 gap-4 px-4 py-2.5">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="col-span-2 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <p className="text-xs text-slate-400">SKU {variant.sku}</p>
      </div>
    </div>
  );
}

function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) return <span className="mt-1 inline-block text-sm font-medium text-rose-600">Out of stock</span>;
  if (stock <= 3) return <span className="mt-1 inline-block text-sm font-medium text-amber-600">Only {stock} left</span>;
  return <span className="mt-1 inline-block text-sm font-medium text-emerald-600">In stock</span>;
}
