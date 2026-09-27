// Checkout (UC11) and order history (UC13).
//
// The critical section is a MongoDB multi-document ACID transaction:
//   for each cart line:  decrement stock ONLY IF enough stock remains   (conditional update)
//   then:                insert the order with a snapshot of the items
// If any line is out of stock, the whole transaction aborts and every stock change made so far
// is rolled back. The conditional update is what prevents overselling when two customers race
// for the last unit: only one of them can match `stock >= qty`.
import { Router } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { Order, Product, mongoose } from "@da2/shared/server";
import { HttpError, parse } from "../lib/http";
import { cartKey, loadCart } from "../lib/cart";
import { emitServerEvent } from "../lib/telemetry";
import { requireAuth } from "../middleware/session";

const FREE_SHIPPING_FROM = 50_000 * 100; // LKR 50,000
const SHIPPING_FEE = 500 * 100; // LKR 500

const checkoutBody = z.object({
  contact: z.object({ name: z.string().trim().min(1).max(100), email: z.email().toLowerCase(), phone: z.string().trim().max(20).optional() }),
  address: z.object({
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    postcode: z.string().trim().max(10).optional(),
  }),
  // Simulated payment: no card details are ever collected.
  payment: z.enum(["cod", "card_approve", "card_decline"]),
});

class OutOfStock extends Error {
  constructor(public sku: string) {
    super(`Out of stock: ${sku}`);
  }
}

/** Order numbers come from an atomic counter document: ORD-20260927-0042. */
async function nextOrderNumber() {
  // Local store date (Sri Lanka), e.g. "2026-09-27" -> "20260927"
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" }).replace(/-/g, "");
  // $inc with upsert is atomic, so concurrent checkouts never get the same number.
  // Deliberately OUTSIDE the transaction: every checkout touches this one document, and inside a
  // transaction that would turn it into a write-conflict hotspot. A skipped number is harmless.
  const counter = await mongoose.connection
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate({ _id: `order-${day}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `ORD-${day}-${String(counter!.seq).padStart(4, "0")}`;
}

export function checkoutRouter(redis: Redis) {
  const router = Router();

  router.post("/checkout", async (req, res) => {
    const body = parse(checkoutBody, req.body);
    const key = cartKey(req);
    const cart = await loadCart(redis, key);
    if (!cart.lines.length) throw new HttpError(400, "Your cart is empty");

    const unavailable = cart.lines.filter((l) => !l.available);
    if (unavailable.length) {
      await emitServerEvent(redis, req, { type: "checkout_failed", props: { reason: "out_of_stock", sku: unavailable[0].sku } });
      throw new HttpError(409, `Not enough stock for: ${unavailable.map((l) => l.name).join(", ")}`);
    }

    if (body.payment === "card_decline") {
      await emitServerEvent(redis, req, { type: "checkout_failed", props: { reason: "payment_declined" } });
      throw new HttpError(402, "Payment declined (simulated). Try another payment method.");
    }

    const subtotal = cart.subtotal;
    const shipping = subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;
    const orderNumber = await nextOrderNumber();
    const now = new Date();

    const session = await mongoose.startSession();
    let orderId: string;
    try {
      // withTransaction commits at the end, aborts if the callback throws, and automatically
      // retries the whole callback on transient errors (e.g. a write conflict with a
      // concurrent checkout on the same product document).
      await session.withTransaction(
        async () => {
          for (const line of cart.lines) {
            const r = await Product.updateOne(
              { _id: line.productId, variants: { $elemMatch: { sku: line.sku, stock: { $gte: line.qty } } } },
              { $inc: { "variants.$.stock": -line.qty } }, // "$" = the variant matched by $elemMatch
              { session },
            );
            if (r.matchedCount === 0) throw new OutOfStock(line.sku); // -> abort + roll back
          }
          const [order] = await Order.create(
            [
              {
                orderNumber,
                customerId: req.user?.userId ?? null,
                guestEmail: req.user ? undefined : body.contact.email,
                contact: body.contact,
                sessionId: req.identity.sessionId,
                anonymousId: req.identity.anonymousId,
                items: cart.lines.map((l) => ({
                  productId: l.productId,
                  sku: l.sku,
                  kind: l.kind,
                  name: l.name,
                  brand: l.brand,
                  variantLabel: l.variantLabel,
                  unitPrice: l.unitPrice,
                  qty: l.qty,
                  lineTotal: l.lineTotal,
                })),
                totals: { subtotal, shipping, total: subtotal + shipping },
                shippingAddress: { ...body.address, country: "Sri Lanka" },
                payment: { method: body.payment === "cod" ? "cod" : "card", status: body.payment === "cod" ? "pending" : "paid" },
                status: body.payment === "cod" ? "placed" : "paid",
                statusHistory: [{ status: body.payment === "cod" ? "placed" : "paid", at: now }],
              },
            ],
            { session },
          );
          orderId = String(order._id);
        },
        // Money and stock: wait until a majority of replica set members have the writes.
        { writeConcern: { w: "majority" }, readConcern: { level: "snapshot" } },
      );
    } catch (err) {
      if (err instanceof OutOfStock) {
        await emitServerEvent(redis, req, { type: "checkout_failed", props: { reason: "out_of_stock", sku: err.sku } });
        throw new HttpError(409, "Sorry, an item in your cart just sold out. Your cart has been updated.");
      }
      throw err;
    } finally {
      await session.endSession();
    }

    // Only after a successful commit: clear the cart and record the trusted server event.
    if (key) await redis.del(key);
    await emitServerEvent(redis, req, {
      type: "order_placed",
      props: { orderId: orderId!, orderNumber, total: subtotal + shipping, itemCount: cart.itemCount },
    });
    res.status(201).json({ orderNumber });
  });

  // UC13: the logged-in customer's orders. Index: {customerId: 1, createdAt: -1}
  router.get("/orders", requireAuth, async (req, res) => {
    const orders = await Order.find({ customerId: req.user!.userId }, { orderNumber: 1, createdAt: 1, status: 1, totals: 1, "items.name": 1, "items.qty": 1 })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ orders });
  });

  // One order. Visible to its customer, or to the same browser session for a guest order
  // (the confirmation page). Staff access comes with the Support dashboard (Phase 8).
  router.get("/orders/:orderNumber", async (req, res) => {
    const order = await Order.findOne({ orderNumber: String(req.params.orderNumber) }, { __v: 0 }).lean();
    const isOwner = order && (req.user ? String(order.customerId) === req.user.userId : !order.customerId && !!req.identity.sessionId && order.sessionId === req.identity.sessionId);
    if (!order || !isOwner) throw new HttpError(404, "Order not found");
    res.json(order);
  });

  return router;
}
