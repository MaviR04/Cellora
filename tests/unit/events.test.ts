// Telemetry event validation: the API's first line of defence (docs/data-model.md §5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { clientEventSchema, eventBatchSchema, minuteKey } from "@da2/shared";

const base = () => ({ eventId: randomUUID(), ts: new Date().toISOString(), page: { path: "/p/pixel-9" } });
const productId = "6ab907966a3a769b4bcccd23";

test("a valid add_to_cart event is accepted", () => {
  const r = clientEventSchema.safeParse({ ...base(), type: "add_to_cart", props: { productId, sku: "PX9-128-O", kind: "phone", qty: 1, unitPrice: 24990000 } });
  assert.equal(r.success, true);
});

test("the browser can't send server-only events (order_placed)", () => {
  const r = clientEventSchema.safeParse({ ...base(), type: "order_placed", props: { orderId: productId, orderNumber: "ORD-1", total: 1, itemCount: 1 } });
  assert.equal(r.success, false);
});

test("an unknown event type is rejected", () => {
  assert.equal(clientEventSchema.safeParse({ ...base(), type: "bitcoin_mined", props: {} }).success, false);
});

test("bad payloads are rejected: negative quantity, malformed product id, unknown kind", () => {
  const cart = (props: object) => clientEventSchema.safeParse({ ...base(), type: "add_to_cart", props: { productId, sku: "X", kind: "phone", qty: 1, unitPrice: 1, ...props } }).success;
  assert.equal(cart({ qty: -1 }), false);
  assert.equal(cart({ productId: "not-an-id" }), false);
  assert.equal(cart({ kind: "toaster" }), false);
});

test("a batch holds 1–50 events", () => {
  const ev = { ...base(), type: "page_view", props: {} };
  assert.equal(eventBatchSchema.safeParse({ events: [] }).success, false);
  assert.equal(eventBatchSchema.safeParse({ events: [ev] }).success, true);
  assert.equal(eventBatchSchema.safeParse({ events: Array.from({ length: 51 }, () => ev) }).success, false);
});

test("minuteKey is the UTC minute as yyyyMMddHHmm", () => {
  assert.equal(minuteKey(new Date("2026-09-28T01:05:59.999+05:30")), "202609271935");
});
