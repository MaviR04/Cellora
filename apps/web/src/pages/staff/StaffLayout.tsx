import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import type { Role } from "@da2/shared";
import { useMe } from "../../hooks/useAuth";

// Staff area shell: a sidebar showing only the dashboards the signed-in role may use.
// The API enforces the same rules (requireRole); hiding links is only a convenience.
export const STAFF_NAV: { section: string; roles: Role[]; links: { to: string; label: string; uc: string }[] }[] = [
  {
    section: "Analytics",
    roles: ["analyst", "admin"],
    links: [
      { to: "/staff/live", label: "Live activity", uc: "UC1" },
      { to: "/staff/funnel", label: "Purchase funnel", uc: "UC2" },
      { to: "/staff/trends", label: "Trends & top lists", uc: "UC1 · UC3" },
    ],
  },
  {
    section: "Support",
    roles: ["support", "admin"],
    links: [
      { to: "/staff/support", label: "Find a customer", uc: "UC12" },
      { to: "/staff/support/failed-checkouts", label: "Failed checkouts", uc: "UC12" },
      { to: "/staff/support/escalations", label: "Escalations", uc: "UC14" },
    ],
  },
  {
    section: "Administration",
    roles: ["admin"],
    links: [
      { to: "/staff/admin/users", label: "Users & access", uc: "UC4 · UC15" },
      { to: "/staff/admin/data", label: "Data & indexes", uc: "UC5 · UC6" },
      { to: "/staff/admin/health", label: "System health", uc: "UC7" },
      { to: "/staff/admin/audit", label: "Audit log", uc: "" },
    ],
  },
];

export function StaffLayout() {
  const { user, isStaff, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return null;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!isStaff) return <p className="py-24 text-center text-slate-500">This area is for staff only.</p>;

  const sections = STAFF_NAV.filter((s) => s.roles.includes(user.role));
  return (
    <div className="grid gap-8 lg:grid-cols-[13rem_1fr]">
      <aside className="flex flex-col gap-6 lg:sticky lg:top-28 lg:self-start">
        <div>
          <div className="text-xs font-semibold tracking-widest text-accent-600 uppercase">{user.role}</div>
          <div className="font-bold">{user.name}</div>
        </div>
        {sections.map((s) => (
          <nav key={s.section} className="flex flex-col gap-0.5">
            <div className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">{s.section}</div>
            {s.links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === "/staff/support"}
                className={({ isActive }) =>
                  `flex items-baseline justify-between gap-2 rounded-lg px-3 py-1.5 text-sm ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`
                }
              >
                <span>{l.label}</span>
                <span className="text-[10px] opacity-60">{l.uc}</span>
              </NavLink>
            ))}
          </nav>
        ))}
      </aside>
      <div className="flex min-w-0 flex-col gap-6">
        <Outlet />
      </div>
    </div>
  );
}

/** /staff: go to the first dashboard this role can use. */
export function StaffIndex() {
  const { user } = useMe();
  const first = STAFF_NAV.find((s) => user && s.roles.includes(user.role))?.links[0].to;
  return first ? <Navigate to={first} replace /> : null;
}
