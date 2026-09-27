// Polymorphic product catalog: one `products` collection, one Mongoose discriminator per kind.
// See docs/data-model.md §4.1.
import { Schema, model, type InferSchemaType, type HydratedDocument, type SchemaDefinition } from "mongoose";
import type { ProductKind } from "../../products";

const variantSchema = new Schema(
  {
    sku: { type: String, required: true },
    label: { type: String, required: true },
    attributes: { type: Schema.Types.Mixed, default: {} }, // e.g. { color, storageGb }
    price: { type: Number, required: true, min: 0 }, // LKR minor units (cents)
    stock: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    slug: { type: String, required: true },
    name: { type: String, required: true },
    brand: { type: String, required: true },
    description: { type: String, default: "" },
    images: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    basePrice: { type: Number, required: true, min: 0 },
    variants: { type: [variantSchema], required: true },
    isActive: { type: Boolean, default: true },
  },
  {
    discriminatorKey: "kind",
    collection: "products",
    timestamps: true,
    autoIndex: false, // indexes are owned by scripts/db/bootstrap.ts
  },
);

// basePrice is denormalised (lowest variant price) so listings can sort/filter on a plain
// indexed field. Recomputed whenever a document is saved through Mongoose.
productSchema.pre("validate", function () {
  if (this.variants?.length) this.basePrice = Math.min(...this.variants.map((v) => v.price));
});

export const Product = model("Product", productSchema);
export type ProductDoc = HydratedDocument<InferSchemaType<typeof productSchema>> & { kind: ProductKind };

const d = (kind: ProductKind, fields: SchemaDefinition) =>
  Product.discriminator(kind, new Schema(fields), kind);

export const Phone = d("phone", {
  modelKey: { type: String, required: true },
  releaseYear: Number,
  os: { type: String, enum: ["ios", "android"], required: true },
  chipset: String,
  ramGb: Number,
  display: { sizeIn: Number, panel: String, refreshHz: Number },
  cameras: { mainMp: Number, ultraWideMp: Number, telephotoMp: Number },
  batteryMah: Number,
  maxChargingW: Number,
  port: { type: String, enum: ["usb-c", "lightning"] },
  wirelessCharging: Boolean,
});

export const Case = d("case", {
  compatibleModels: { type: [String], required: true },
  material: String,
  style: { type: String, enum: ["slim", "rugged", "wallet"] },
  magsafe: Boolean,
});

export const ScreenProtector = d("screen_protector", {
  compatibleModels: { type: [String], required: true },
  material: { type: String, enum: ["tempered_glass", "privacy", "film"] },
  packCount: Number,
});

export const Charging = d("charging", {
  subType: { type: String, enum: ["charger", "cable", "wireless_pad"], required: true },
  wattage: Number,
  ports: [String],
  protocols: [String],
  connectors: { from: String, to: String },
  lengthM: Number,
});

export const Audio = d("audio", {
  formFactor: { type: String, enum: ["in_ear", "over_ear"] },
  wireless: Boolean,
  anc: Boolean,
  batteryHours: Number,
  codecs: [String],
});

export const PowerBank = d("power_bank", {
  capacityMah: Number,
  maxOutputW: Number,
  ports: [String],
  wireless: Boolean,
});

export const Smartwatch = d("smartwatch", {
  compatiblePlatforms: { type: [String], enum: ["ios", "android"] },
  caseSizesMm: [Number],
  gps: Boolean,
  lte: Boolean,
  batteryDays: Number,
  sensors: [String],
});
