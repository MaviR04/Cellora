// Browser telemetry tracker (architecture.md §5).
//
// track() puts an event in a queue; the queue is sent to POST /api/events in one batch every
// few seconds or when it reaches 20 events. When the tab is hidden or closed, the remaining
// events go out with navigator.sendBeacon, which the browser delivers even as the page unloads.
import type { ClientEvent } from "@da2/shared";
import { getAnonymousId, getSessionId } from "./identity";

export type EventType = ClientEvent["type"];
export type PropsOf<T extends EventType> = Extract<ClientEvent, { type: T }>["props"];

const FLUSH_INTERVAL_MS = 4000;
const MAX_BATCH = 20;
const ENDPOINT = "/api/events";

let queue: Record<string, unknown>[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/** Record a telemetry event. Type-checked: the props must match the event type's schema. */
export function track<T extends EventType>(type: T, props: PropsOf<T>) {
  queue.push({
    eventId: crypto.randomUUID(),
    type,
    ts: new Date().toISOString(),
    page: { path: location.pathname + location.search, referrer: document.referrer || undefined },
    props,
  });
  if (queue.length >= MAX_BATCH) void flush();
  else timer ??= setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
}

function takeBatch() {
  clearTimeout(timer);
  timer = undefined;
  const events = queue.splice(0, 50); // the API accepts at most 50 per request
  return events.length ? JSON.stringify({ anonymousId: getAnonymousId(), sessionId: getSessionId(), events }) : null;
}

export async function flush() {
  const body = takeBatch();
  if (!body) return;
  try {
    await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  } catch {
    // Telemetry is best effort: never break the shop because analytics failed.
  }
  if (queue.length) void flush();
}

// Page is being hidden or closed: hand the rest to the browser to deliver.
function flushOnHide() {
  let body: string | null;
  while ((body = takeBatch())) {
    if (!navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) {
      void fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    }
  }
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushOnHide());
  window.addEventListener("pagehide", flushOnHide);
}
