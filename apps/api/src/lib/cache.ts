// Read-through cache for expensive dashboard queries (UC6: "dashboards load instantly").
//   cache:{name}:{sha1(params)} -> JSON result, short TTL
// A hit skips MongoDB entirely. The TTL bounds how stale a dashboard can be.
import { createHash } from "node:crypto";
import type { Redis } from "ioredis";

export async function cached<T>(redis: Redis, name: string, params: unknown, ttlSeconds: number, compute: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const key = `cache:${name}:${createHash("sha1").update(JSON.stringify(params)).digest("hex").slice(0, 16)}`;
  const hit = await redis.get(key);
  if (hit) return { value: JSON.parse(hit) as T, hit: true };
  const value = await compute();
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  return { value, hit: false };
}
