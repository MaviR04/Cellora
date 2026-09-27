import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { formatMoney, KIND_LABELS, type CategorySummary, type ProductList } from "@da2/shared";
import { api } from "../lib/api";
import { KindIcon } from "../components/KindIcon";
import { GridSkeleton, ProductGrid } from "../components/ProductCard";

export function HomePage() {
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<CategorySummary[]>("/categories") });
  const flagships = useQuery({
    queryKey: ["products", "home-phones"],
    queryFn: () => api<ProductList>("/products?kind=phone&sort=price_desc&limit=8"),
  });

  return (
    <div className="flex flex-col gap-12">
      <section className="rounded-3xl bg-slate-900 px-8 py-14 text-white">
        <p className="text-sm font-semibold tracking-widest text-accent-100 uppercase">New season flagships</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl">
          The latest phones, and every accessory that fits them.
        </h1>
        <p className="mt-4 max-w-xl text-slate-300">
          iPhone 16, Galaxy S25, Pixel 9 and more, with cases, chargers and protectors matched to your exact model.
        </p>
        <Link to="/c/phone" className="mt-8 inline-block rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-accent-100">
          Shop phones
        </Link>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold">Shop by category</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {categories.data?.map((c) => (
            <Link
              key={c.kind}
              to={`/c/${c.kind}`}
              className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-center transition hover:border-accent-500 hover:shadow-sm"
            >
              <KindIcon kind={c.kind} className="size-9 text-accent-600" />
              <span className="text-sm font-semibold">{KIND_LABELS[c.kind]}</span>
              <span className="text-xs text-slate-500">from {formatMoney(c.fromPrice)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-bold">Flagship phones</h2>
          <Link to="/c/phone" className="text-sm font-medium text-accent-600 hover:underline">
            View all
          </Link>
        </div>
        {flagships.data ? <ProductGrid products={flagships.data.items} /> : <GridSkeleton />}
      </section>
    </div>
  );
}
