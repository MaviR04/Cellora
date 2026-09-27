import type { Request } from "express";

/** Minimal Cookie header parser (we only read our own two cookies). */
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of req.headers.cookie?.split(";") ?? []) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true, // not readable from JavaScript: protects the session id from XSS
  sameSite: "lax" as const,
  secure: false, // local http; would be true behind HTTPS
  path: "/",
  maxAge: maxAgeSeconds * 1000,
});
