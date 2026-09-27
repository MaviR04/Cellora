import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ProductCard } from "@da2/shared";
import { api } from "../lib/api";
import { GridSkeleton, ProductGrid } from "../components/ProductCard";

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const results = useQuery({
    queryKey: ["search", q],
    queryFn: () => api<{ items: ProductCard[]; total: number }>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-extrabold">
        {q ? (
          <>
            Results for <span className="text-accent-600">“{q}”</span>
          </>
        ) : (
          "Search"
        )}
      </h1>
      {!q ? (
        <p className="text-slate-500">Type something in the search box above.</p>
      ) : results.data ? (
        results.data.items.length ? (
          <>
            <span className="text-sm text-slate-500">{results.data.total} products, best match first</span>
            <ProductGrid products={results.data.items} />
          </>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500">No products found for “{q}”.</p>
        )
      ) : (
        <GridSkeleton />
      )}
    </div>
  );
}
