import type { RequestHandler } from "express";
import type { Redis } from "ioredis";
import type { Role } from "@da2/shared";
import { getSession, SESSION_COOKIE, type SessionUser } from "../lib/sessions";
import { readCookie } from "../lib/cookies";
import { HttpError } from "../lib/http";

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
    sessionId?: string;
    /** Telemetry identity sent by the frontend on every request (X-Anonymous-Id / X-Session-Id). */
    identity: { anonymousId?: string; sessionId?: string };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidHeader = (v: string | string[] | undefined) => (typeof v === "string" && UUID.test(v) ? v : undefined);

/** Attaches req.user (from the Redis session) and req.identity to every request. */
export const attachSession =
  (redis: Redis): RequestHandler =>
  async (req, _res, next) => {
    req.identity = { anonymousId: uuidHeader(req.headers["x-anonymous-id"]), sessionId: uuidHeader(req.headers["x-session-id"]) };
    const sid = readCookie(req, SESSION_COOKIE);
    if (sid) {
      const user = await getSession(redis, sid);
      if (user) {
        req.user = user;
        req.sessionId = sid;
      }
    }
    next();
  };

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, "Please log in");
  next();
};

/** Role-based access control (UC4). 401 if not logged in, 403 if the role is not allowed. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new HttpError(401, "Please log in");
    if (!roles.includes(req.user.role)) throw new HttpError(403, `Requires role: ${roles.join(" or ")}`);
    next();
  };
