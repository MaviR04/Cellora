import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { KIND_LABELS, PRODUCT_KINDS } from "@da2/shared";
import { useLogout, useMe } from "../hooks/useAuth";
import { useCart } from "../hooks/useCart";
import { useTrackView } from "../hooks/useTrack";

export const STORE_NAME = "Cellora";

export function Layout() {
  const location = useLocation();
  // One page_view per navigation (UC1: navigation paths)
  useTrackView("page_view", { title: document.title }, location.pathname + location.search);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <Link to="/" className="text-xl font-extrabold tracking-tight">
            {STORE_NAME}
            <span className="text-accent-600">.</span>
          </Link>
          <SearchBox />
          <HeaderActions />
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

function HeaderActions() {
  const { user, isStaff } = useMe();
  const cart = useCart();
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <div className="ml-auto flex items-center gap-3 text-sm font-medium text-slate-600">
      {isStaff && (
        <Link to="/staff" className="rounded-full bg-accent-50 px-3 py-1.5 text-accent-700 hover:bg-accent-100">
          Staff
        </Link>
      )}
      {user ? (
        <>
          <span className="hidden sm:inline">Hi, {user.name.split(" ")[0]}</span>
          {!isStaff && (
            <Link to="/orders" className="hover:text-slate-900">
              Orders
            </Link>
          )}
          <button onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/") })} className="hover:text-slate-900">
            Log out
          </button>
        </>
      ) : (
        <Link to="/login" className="hover:text-slate-900">
          Log in
        </Link>
      )}
      <Link to="/cart" className="rounded-full border border-slate-200 px-3 py-1.5 hover:border-slate-400">
        Cart · {cart.data?.itemCount ?? 0}
      </Link>
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
