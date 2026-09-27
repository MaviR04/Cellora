// audit_log (data-model §4.10): who did what to whom, for every privileged staff action.
// A regular collection, never capped: an audit trail must not silently drop records.
import type { Request } from "express";
import { mongoose } from "@da2/shared/server";

export async function audit(req: Request, action: string, target: { type: string; id: string }, details?: Record<string, unknown>) {
  await mongoose.connection.collection("audit_log").insertOne({
    at: new Date(),
    actorId: req.user!.userId,
    actorRole: req.user!.role,
    actorName: req.user!.name,
    action,
    target,
    ...(details && { details }),
  });
}
