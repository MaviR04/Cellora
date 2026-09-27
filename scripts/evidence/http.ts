// Tiny HTTP client with a cookie jar, so evidence scripts can act as a logged-in user.
export const API = "http://localhost:4000/api";

export class Client {
  private cookies = new Map<string, string>();
  constructor(private headers: Record<string, string> = {}) {}

  async request<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(API + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
        ...(this.cookies.size && { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [k, v] = pair.split("=");
      // An expired cookie (clearCookie) removes it from the jar
      if (attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a)) || v === "") this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), v);
    }
    return { status: res.status, body: (await res.json().catch(() => null)) as T };
  }

  get = <T = any>(path: string) => this.request<T>("GET", path);
  post = <T = any>(path: string, body?: unknown) => this.request<T>("POST", path, body ?? {});
  cookie = (name: string) => this.cookies.get(name);

  async login(email: string) {
    const password = process.env.SEED_USER_PASSWORD;
    if (!password) throw new Error("SEED_USER_PASSWORD missing from .env");
    const r = await this.post<{ user: { id: string } }>("/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status}`);
    return r.body.user;
  }
}

export async function reachable(url: string) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}
