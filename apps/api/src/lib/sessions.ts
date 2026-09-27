// Server-side sessions in Redis (architecture.md §8, data-model §7).
//   sess:{id}              HASH  {userId, role, name, email, createdAt}   TTL 7 d (customer) / 8 h (staff)
//   user_sessions:{userId} SET   of session ids, so an admin can revoke every session of a user
// The browser only holds the random session id in an httpOnly cookie. Deleting the Redis key
// logs the user out immediately, which a self-contained JWT cannot do before it expires.
import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import type { Role } from "@da2/shared";

export interface SessionUser {
  userId: string;
  role: Role;
  name: string;
  email: string;
}

export const SESSION_COOKIE = "sid";
const DAY = 24 * 60 * 60;
export const sessionTtl = (role: Role) => (role === "customer" ? 7 * DAY : 8 * 60 * 60);

const sessKey = (id: string) => `sess:${id}`;
const userSessionsKey = (userId: string) => `user_sessions:${userId}`;

export async function createSession(redis: Redis, user: SessionUser): Promise<string> {
  const id = randomBytes(32).toString("base64url"); // 256 bits: unguessable
  const ttl = sessionTtl(user.role);
  await redis
    .multi()
    .hset(sessKey(id), { ...user, createdAt: new Date().toISOString() })
    .expire(sessKey(id), ttl)
    .sadd(userSessionsKey(user.userId), id)
    .expire(userSessionsKey(user.userId), 7 * DAY)
    .exec();
  return id;
}

export async function getSession(redis: Redis, id: string): Promise<SessionUser | null> {
  const s = await redis.hgetall(sessKey(id));
  if (!s.userId) return null; // missing or expired
  return { userId: s.userId, role: s.role as Role, name: s.name, email: s.email };
}

export async function destroySession(redis: Redis, id: string) {
  const userId = await redis.hget(sessKey(id), "userId");
  const tx = redis.multi().del(sessKey(id));
  if (userId) tx.srem(userSessionsKey(userId), id);
  await tx.exec();
}

/** UC4: log a user out everywhere, effective on their very next request. */
export async function revokeAllSessions(redis: Redis, userId: string): Promise<number> {
  const ids = await redis.smembers(userSessionsKey(userId));
  if (ids.length) await redis.del(...ids.map(sessKey));
  await redis.del(userSessionsKey(userId));
  return ids.length;
}
