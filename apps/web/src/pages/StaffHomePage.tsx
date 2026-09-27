import { Navigate } from "react-router";
import { useMe } from "../hooks/useAuth";

// Placeholder staff landing page. The Analyst / Support / Admin dashboards arrive in Phase 8.
export function StaffHomePage() {
  const { user, isStaff, isLoading } = useMe();
  if (isLoading) return null;
  if (!user) return <Navigate to="/login?next=/staff" replace />;
  if (!isStaff) return <p className="py-24 text-center text-slate-500">This area is for staff only.</p>;

  return (
    <div className="flex flex-col gap-2 py-16 text-center">
      <p className="text-sm font-semibold tracking-widest text-accent-600 uppercase">{user.role}</p>
      <h1 className="text-3xl font-extrabold">Welcome, {user.name}</h1>
      <p className="text-slate-500">Staff dashboards are coming in Phase 8.</p>
    </div>
  );
}
