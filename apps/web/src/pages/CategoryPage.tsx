import { useParams, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { KIND_LABELS, PRODUCT_KINDS, type Facets, type ProductKind, type ProductList } from "@da2/shared";
import { api, qs } from "../lib/api";
import { GridSkeleton, ProductGrid } from "../components/ProductCard";
import { NotFoundPage } from "./NotFoundPage";

export function CategoryPage() {
  const { kind } = useParams();
  if (!PRODUCT_KINDS.includes(kind as ProductKind)) return <NotFoundPage />;
  // key: reset local form state when switching category
  return <CategoryListing key={kind} kind={kind as ProductKind} />;
}

// Filters live in the URL (?brand=Apple,Samsung&min=...&sort=...), so a filtered listing can be
// bookmarked or shared, and the back button works.
function CategoryListing({ kind }: { kind: ProductKind }) {
  const [params, setParams] = useSearchParams();

  const brands = params.get("brand")?.split(",").filter(Boolean) ?? [];
  const sort = params.get("sort") ?? "price_asc";
  const page = Number(params.get("page") ?? 1);
  // Price inputs are in whole rupees; the API works in cents.
  const minRs = params.get("min") ?? "";
  const maxRs = params.get("max") ?? "";

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, v] of Object.entries(changes)) {
      if (v) next.set(key, v);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next);
  };

  const facets = useQuery({ queryKey: ["facets", kind], queryFn: () => api<Facets>(`/products/facets?kind=${kind}`) });
  const list = useQuery({
    queryKey: ["products", kind, brands, sort, page, minRs, maxRs],
    queryFn: () =>
      api<ProductList>(
        `/products${qs({
          kind,
          brand: brands.join(","),
          sort,
          page,
          minPrice: minRs ? Number(minRs) * 100 : undefined,
          maxPrice: maxRs ? Number(maxRs) * 100 : undefined,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-60">
        <h1 className="text-2xl font-extrabold">{KIND_LABELS[kind]}</h1>

        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Brand</h3>
          <div className="flex flex-col gap-1.5">
            {facets.data?.brands.map((b) => (
              <label key={b.brand} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-accent-600"
                  checked={brands.includes(b.brand)}
                  onChange={(e) =>
                    update({ brand: (e.target.checked ? [...brands, b.brand] : brands.filter((x) => x !== b.brand)).join(",") || null })
                  }
                />
                {b.brand}
                <span className="ml-auto text-xs text-slate-400">{b.count}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Price (LKR)</h3>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              update({ min: (f.get("min") as string) || null, max: (f.get("max") as string) || null });
            }}
          >
            <input
              name="min"
              defaultValue={minRs}
              placeholder={facets.data ? String(facets.data.price.min / 100) : "min"}
              className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
              inputMode="numeric"
            />
            <span className="text-slate-400">–</span>
            <input
              name="max"
              defaultValue={maxRs}
              placeholder={facets.data ? String(facets.data.price.max / 100) : "max"}
              className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
              inputMode="numeric"
            />
            <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white">Go</button>
          </form>
        </div>

        {(brands.length > 0 || minRs || maxRs) && (
          <button onClick={() => setParams({})} className="self-start text-sm font-medium text-accent-600 hover:underline">
            Clear filters
          </button>
        )}
      </aside>

      <section className="flex-1">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-slate-500">{list.data ? `${list.data.total} products` : "Loading…"}</span>
          <select value={sort} onChange={(e) => update({ sort: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="name">Name</option>
          </select>
        </div>

        {list.data ? (
          list.data.items.length ? (
            <ProductGrid products={list.data.items} />
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500">No products match these filters.</p>
          )
        ) : (
          <GridSkeleton />
        )}

        {list.data && list.data.pages > 1 && (
          <div className="mt-6 flex justify-center gap-2">
            {Array.from({ length: list.data.pages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => update({ page: String(p) })}
                className={`size-9 rounded-lg text-sm ${p === page ? "bg-slate-900 text-white" : "border border-slate-200 bg-white"}`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
