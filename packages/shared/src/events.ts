import { z } from "zod";
import { PRODUCT_KINDS } from "./products";

// Telemetry event catalogue. See docs/data-model.md §5.
// The API validates every incoming event against these schemas before it reaches the stream.

const objectId = z.string().regex(/^[a-f0-9]{24}$/, "must be a 24-char hex ObjectId");
const money = z.number().int().nonnegative();
const kind = z.enum(PRODUCT_KINDS);

/** Fields every event carries, whether it comes from the browser or the server. */
const envelope = {
  eventId: z.string().uuid(),
  ts: z.coerce.date(),
  page: z.object({ path: z.string().max(500), referrer: z.string().max(500).optional() }).optional(),
};

const event = <T extends string, P extends z.ZodRawShape>(type: T, props: P) =>
  z.object({ ...envelope, type: z.literal(type), props: z.object(props) });

// Client events: sent by the browser tracker.
export const clientEventSchema = z.discriminatedUnion("type", [
  event("page_view", { title: z.string().max(200).optional() }),
  event("category_view", { kind, filters: z.record(z.string(), z.unknown()).optional() }),
  event("product_view", { productId: objectId, kind, basePrice: money }),
  event("search", {
    query: z.string().max(200),
    filters: z.record(z.string(), z.unknown()).optional(),
    resultCount: z.number().int().nonnegative(),
  }),
  event("add_to_cart", { productId: objectId, sku: z.string(), kind, qty: z.number().int().positive(), unitPrice: money }),
  event("remove_from_cart", { sku: z.string(), qty: z.number().int().positive() }),
  event("update_quantity", { sku: z.string(), from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }),
  event("checkout_started", { cartValue: money, itemCount: z.number().int().positive() }),
  event("payment_submitted", { method: z.string().max(50) }),
  event("identify", { customerId: objectId, via: z.enum(["login", "signup"]) }),
]);

// Server events: emitted by the API for trusted actions, never accepted from the browser.
export const serverEventSchema = z.discriminatedUnion("type", [
  event("order_placed", { orderId: objectId, orderNumber: z.string(), total: money, itemCount: z.number().int().positive() }),
  event("checkout_failed", {
    reason: z.enum(["out_of_stock", "payment_declined", "validation"]),
    sku: z.string().optional(),
  }),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;
export type EventType = ClientEvent["type"] | ServerEvent["type"];

/** Body of POST /api/events. */
export const eventBatchSchema = z.object({
  events: z.array(clientEventSchema).min(1).max(50),
});
export type EventBatch = z.infer<typeof eventBatchSchema>;

/** Identity attached to every event; stored in the time-series `metaField`. */
export interface EventMeta {
  anonymousId: string;
  sessionId: string;
  customerId: string | null;
}

export type DeviceType = "desktop" | "mobile" | "tablet";

/** Shape of a document in the `events` time-series collection (ObjectIds shown as strings). */
export type StoredEvent = (ClientEvent | ServerEvent) & {
  meta: EventMeta;
  source: "client" | "server";
  device?: { type: DeviceType; os: string; browser: string };
  receivedAt: Date;
};

/** Every event type, in catalogue order (dashboards and live counters iterate over this). */
export const EVENT_TYPES = [
  ...clientEventSchema.options.map((o) => o.shape.type.value),
  ...serverEventSchema.options.map((o) => o.shape.type.value),
] as EventType[];

/** Live-counter key suffix: the UTC minute as yyyyMMddHHmm (active:{m}, evt:{type}:{m}). */
export const minuteKey = (d: Date) => d.toISOString().slice(0, 16).replace(/[-T:]/g, "");
