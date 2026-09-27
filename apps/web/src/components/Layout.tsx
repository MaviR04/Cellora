import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from "react-router";
import { KIND_LABELS, PRODUCT_KINDS } from "@da2/shared";

export const STORE_NAME = "Cellora";

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <Link to="/" className="text-xl font-extrabold tracking-tight">
            {STORE_NAME}
            <span className="text-accent-600">.</span>
          </Link>
          <SearchBox />
          <div className="ml-auto flex items-center gap-4 text-sm font-medium text-slate-600">
            <span title="Cart arrives in Phase 3" className="rounded-full border border-slate-200 px-3 py-1.5">
              Cart · 0
            </span>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 text-sm [scrollbar-width:none]">
          {PRODUCT_KINDS.map((k) => (
            <NavLink
              key={k}
              to={`/c/${k}`}
              className={({ isActive }) =>
                `rounded-full px-3 py-1.5 whitespace-nowrap transition ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`
              }
            >
              {KIND_LABELS[k]}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        {STORE_NAME} · Phones & accessories in Sri Lanka · Coursework demo: prices and specs are approximate
      </footer>
    </div>
  );
}

function SearchBox() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  return (
    <form
      className="flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search phones, cases, chargers…"
        className="w-full max-w-md rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-accent-500 focus:bg-white"
      />
    </form>
  );
}
