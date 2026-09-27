// Telemetry identity (data-model §6), sent as headers on every API call:
//   anonymousId: one per browser, long-lived (localStorage)
//   sessionId:   one per visit; a new one starts after 30 minutes of inactivity (sessionStorage)
const ANON_KEY = "cellora.anonymousId";
const SESSION_KEY = "cellora.session";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // storage blocked (private mode etc.)
  }
}

let memoryAnon: string | undefined;
let memorySession: { id: string; lastActive: number } | undefined;

export function getAnonymousId(): string {
  const s = storage("local");
  let id = s?.getItem(ANON_KEY) ?? memoryAnon;
  if (!id) {
    id = crypto.randomUUID();
    s?.setItem(ANON_KEY, id);
    memoryAnon = id;
  }
  return id;
}

/** Returns the current session id, starting a new session after 30 minutes of inactivity. */
export function getSessionId(): string {
  const s = storage("session");
  const now = Date.now();
  let session = memorySession;
  try {
    session = JSON.parse(s?.getItem(SESSION_KEY) ?? "null") ?? memorySession;
  } catch {
    /* ignore corrupt value */
  }
  if (!session || now - session.lastActive > SESSION_TIMEOUT_MS) session = { id: crypto.randomUUID(), lastActive: now };
  session.lastActive = now;
  s?.setItem(SESSION_KEY, JSON.stringify(session));
  memorySession = session;
  return session.id;
}
