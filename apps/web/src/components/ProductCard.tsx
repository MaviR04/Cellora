import { Link } from "react-router";
import { formatMoney, type ProductCard as Card } from "@da2/shared";
import { ProductVisual } from "./ProductVisual";

export function ProductCard({ product }: { product: Card }) {
  return (
    <Link
      to={`/p/${product.slug}`}
      className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition hover:-translate-y-0.5 hover:border-accent-500 hover:shadow-md"
    >
      <ProductVisual kind={product.kind} brand={product.brand} />
      <div className="flex flex-1 flex-col gap-1 px-1">
        <span className="text-xs font-medium text-slate-500">{product.brand}</span>
        <span className="line-clamp-2 text-sm font-semibold group-hover:text-accent-700">{product.name}</span>
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-sm font-bold">
            <span className="mr-1 text-xs font-normal text-slate-500">from</span>
            {formatMoney(product.basePrice)}
          </span>
          {!product.inStock && <span className="text-xs font-medium text-rose-600">Out of stock</span>}
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({ products }: { products: Card[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p._id} product={p} />
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-72 animate-pulse rounded-2xl bg-slate-200/70" />
      ))}
    </div>
  );
}
