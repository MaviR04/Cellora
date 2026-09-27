// Staff-only endpoints. The dashboards themselves arrive in Phase 8; for now this proves RBAC
// and implements session revocation for UC4 (Manage Users & Access).
import { Router } from "express";
import type { Redis } from "ioredis";
import { isValidObjectId } from "mongoose";
import { STAFF_ROLES } from "@da2/shared";
import { User, mongoose } from "@da2/shared/server";
import { HttpError } from "../lib/http";
import { revokeAllSessions } from "../lib/sessions";
import { requireRole } from "../middleware/session";

export function staffRouter(redis: Redis) {
  const router = Router();

  // Any staff role
  router.get("/staff/me", requireRole(...STAFF_ROLES), (req, res) => {
    res.json({ user: req.user });
  });

  // Admin only: log a user out of every device, effective immediately.
  router.post("/admin/users/:id/revoke-sessions", requireRole("admin"), async (req, res) => {
    const id = String(req.params.id);
    if (!isValidObjectId(id)) throw new HttpError(400, "Invalid user id");
    const user = await User.findById(id, { email: 1 }).lean();
    if (!user) throw new HttpError(404, "User not found");
    const revoked = await revokeAllSessions(redis, id);
    await mongoose.connection.collection("audit_log").insertOne({
      at: new Date(),
      actorId: req.user!.userId,
      actorRole: req.user!.role,
      action: "sessions_revoked",
      target: { type: "user", id },
      details: { email: user.email, revoked },
    });
    res.json({ revoked });
  });

  return router;
}
