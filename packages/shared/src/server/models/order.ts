// Orders (data-model §4.3). Line items and the shipping address are embedded SNAPSHOTS: an order
// records what was bought at what price, so later product edits must never change it.
import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { PRODUCT_KINDS } from "../../products";

export const ORDER_STATUSES = ["placed", "paid", "shipped", "delivered", "cancelled"] as const;
export const PAYMENT_METHODS = ["cod", "card"] as const;

const itemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true },
    kind: { type: String, enum: PRODUCT_KINDS, required: true },
    name: { type: String, required: true },
    brand: { type: String, required: true },
    variantLabel: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 }, // LKR cents, at the time of purchase
    qty: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, default: null }, // null = guest order
    guestEmail: String,
    contact: { name: { type: String, required: true }, email: { type: String, required: true }, phone: String },
    // Links the order to its telemetry, so Support can open the session that produced it (UC12).
    sessionId: String,
    anonymousId: String,
    items: { type: [itemSchema], required: true },
    totals: { subtotal: Number, shipping: Number, total: Number },
    shippingAddress: { line1: String, line2: String, city: String, postcode: String, country: String },
    payment: { method: { type: String, enum: PAYMENT_METHODS }, status: { type: String, enum: ["pending", "paid"] } },
    status: { type: String, enum: ORDER_STATUSES, default: "placed" },
    // Bounded by the order lifecycle (at most a handful of entries), so it is safe to embed.
    statusHistory: [{ _id: false, status: String, at: Date }],
  },
  { collection: "orders", timestamps: true, autoIndex: false },
);

export const Order = model("Order", orderSchema);
export type OrderDoc = HydratedDocument<InferSchemaType<typeof orderSchema>>;
