// Customers and staff share one collection, told apart by `role`. See docs/data-model.md §4.2.
import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { ROLES } from "../../roles";

const addressSchema = new Schema(
  { label: String, line1: { type: String, required: true }, line2: String, city: { type: String, required: true }, postcode: String, country: { type: String, default: "Sri Lanka" } },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ROLES, default: "customer" },
    // Embedded: owned by the user, read with the user, and bounded (max 5).
    addresses: { type: [addressSchema], default: [], validate: [(a: unknown[]) => a.length <= 5, "At most 5 addresses"] },
    // Anonymous browser IDs linked to this account (identity stitching, data-model §6). Capped at 20.
    anonymousIds: { type: [String], default: [] },
    status: { type: String, enum: ["active", "disabled", "erased"], default: "active" },
    lastLoginAt: Date,
  },
  { collection: "users", timestamps: true, autoIndex: false },
);

export const User = model("User", userSchema);
export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
