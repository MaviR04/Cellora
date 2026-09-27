// Signup / login / logout / me. Sessions in Redis (lib/sessions.ts).
import { Router, type Request, type Response } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { User, hashPassword, verifyPassword, type UserDoc } from "@da2/shared/server";
import { HttpError, parse } from "../lib/http";
import { cookieOptions } from "../lib/cookies";
import { createSession, destroySession, SESSION_COOKIE, sessionTtl, type SessionUser } from "../lib/sessions";
import { mergeGuestCart } from "../lib/cart";
import { requireAuth } from "../middleware/session";

const credentials = z.object({ email: z.email().toLowerCase(), password: z.string().min(1).max(200) });
const signupBody = credentials.extend({ name: z.string().trim().min(1).max(100), password: z.string().min(8, "Password must be at least 8 characters").max(200) });

const publicUser = (u: SessionUser) => ({ id: u.userId, name: u.name, email: u.email, role: u.role });

export function authRouter(redis: Redis) {
  const router = Router();

  async function startSession(req: Request, res: Response, user: UserDoc) {
    const sessionUser: SessionUser = { userId: String(user._id), role: user.role as SessionUser["role"], name: user.name, email: user.email };
    const sid = await createSession(redis, sessionUser);
    res.cookie(SESSION_COOKIE, sid, cookieOptions(sessionTtl(sessionUser.role)));

    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    // Identity stitching (data-model §6): remember which anonymous browser this customer used.
    // The filter skips IDs already linked; $push with $each + $slice keeps only the 20 most
    // recent, so the embedded array stays bounded.
    const anonymousId = req.identity.anonymousId;
    if (anonymousId) {
      await User.updateOne(
        { _id: user._id, anonymousIds: { $ne: anonymousId } },
        { $push: { anonymousIds: { $each: [anonymousId], $slice: -20 } } },
      );
    }

    await mergeGuestCart(redis, req, res, sessionUser.userId);
    return publicUser(sessionUser);
  }

  router.post("/auth/signup", async (req, res) => {
    const body = parse(signupBody, req.body);
    if (await User.exists({ email: body.email })) throw new HttpError(409, "An account with this email already exists");
    const user = await User.create({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password), role: "customer" });
    res.status(201).json({ user: await startSession(req, res, user) });
  });

  router.post("/auth/login", async (req, res) => {
    const body = parse(credentials, req.body);
    const user = await User.findOne({ email: body.email });
    // Same message whether the email or the password is wrong: don't reveal which accounts exist.
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) throw new HttpError(401, "Incorrect email or password");
    if (user.status !== "active") throw new HttpError(403, "This account is disabled");
    res.json({ user: await startSession(req, res, user) });
  });

  router.post("/auth/logout", async (req, res) => {
    if (req.sessionId) await destroySession(redis, req.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/auth/me", (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null });
  });

  router.get("/auth/sessions", requireAuth, async (req, res) => {
    res.json({ activeSessions: await redis.scard(`user_sessions:${req.user!.userId}`) });
  });

  return router;
}
