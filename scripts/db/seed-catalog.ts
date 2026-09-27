// Replaces the product catalog with the curated seed data. Usage: npm run db:seed
import { connectMongo, mongoose, Product, Phone, Case, ScreenProtector, Charging, Audio, PowerBank, Smartwatch } from "@da2/shared/server";
import type { ProductKind } from "@da2/shared";
import { seedProducts, LOW_STOCK_SKUS } from "./seed-data";

const models: Record<ProductKind, mongoose.Model<any>> = {
  phone: Phone,
  case: Case,
  screen_protector: ScreenProtector,
  charging: Charging,
  audio: Audio,
  power_bank: PowerBank,
  smartwatch: Smartwatch,
};

// Deterministic pseudo-random stock levels, so every seed run produces the same catalog.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const between = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));

// Sanity check: every accessory must point at a phone that exists.
const modelKeys = new Set(seedProducts.filter((p) => p.kind === "phone").map((p) => p.modelKey));
for (const p of seedProducts) {
  for (const m of (p.compatibleModels as string[] | undefined) ?? []) {
    if (!modelKeys.has(m)) throw new Error(`${p.slug} references unknown phone model ${m}`);
  }
}

await connectMongo();
const { deletedCount } = await Product.deleteMany({});
console.log(`removed ${deletedCount} existing products`);

const counts: Record<string, number> = {};
for (const [kind, Model] of Object.entries(models)) {
  const docs = seedProducts
    .filter((p) => p.kind === kind)
    .map(({ kind: _kind, ...p }) => ({
      ...p,
      variants: p.variants.map((v) => ({
        ...v,
        price: v.price * 100, // whole LKR -> cents
        stock: LOW_STOCK_SKUS.includes(v.sku) ? 1 : kind === "phone" ? between(3, 40) : between(10, 150),
      })),
    }));
  // insertMany through the discriminator model: Mongoose validates kind-specific fields and
  // runs the pre-validate hook that computes basePrice; MongoDB then applies $jsonSchema.
  await Model.insertMany(docs);
  counts[kind] = docs.length;
}

const variants = seedProducts.reduce((n, p) => n + p.variants.length, 0);
console.log("inserted products by kind:", counts);
console.log(`total: ${seedProducts.length} products, ${variants} variants (SKUs)`);
await mongoose.disconnect();
