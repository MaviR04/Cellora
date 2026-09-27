// Any staff role: who am I (the dashboards use this to build their navigation).
// Role-specific endpoints live in analytics.ts (Analyst), support.ts (Support) and admin.ts (Admin).
import { Router } from "express";
import { STAFF_ROLES } from "@da2/shared";
import { requireRole } from "../middleware/session";

export const staffRouter = Router().get("/staff/me", requireRole(...STAFF_ROLES), (req, res) => {
  res.json({ user: req.user });
});
