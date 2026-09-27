// Catalog endpoints (UC8 Browse, UC9 Search). Every query here is backed by an index from
// docs/data-model.md §8; the comment on each route names it.
import { Router } from "express";
import { z } from "zod";
import { PRODUCT_KINDS } from "@da2/shared";
import { Product } from "@da2/shared/server";
import { HttpError, parse } from "../lib/http";

export const catalogRouter = Router();

/** Fields needed to render a product card. Variant stock is fetched only to compute inStock. */
const CARD_FIELDS = { slug: 1, name: 1, brand: 1, kind: 1, basePrice: 1, "variants.stock": 1 } as const;

type CardSource = { _id: unknown; slug: string; name: string; brand: string; kind: string; basePrice: number; variants: { stock: number }[] };
const toCard = ({ variants, ...p }: CardSource) => ({ ...p, inStock: variants.some((v) => v.stock > 0) });

const kind = z.enum(PRODUCT_KINDS);
const csv = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .optional();

// GET /api/categories: product count and starting price per kind
catalogRouter.get("/categories", async (_req, res) => {
  const rows = await Product.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: "$kind", count: { $sum: 1 }, fromPrice: { $min: "$basePrice" } } },
    { $project: { _id: 0, kind: "$_id", count: 1, fromPrice: 1 } },
  ]);
  const order = new Map(PRODUCT_KINDS.map((k, i) => [k, i]));
  res.json(rows.sort((a, b) => order.get(a.kind)! - order.get(b.kind)!));
});

// GET /api/products: category listing with filters. Index: {kind:1, basePrice:1} (ESR: kind
// equality, then basePrice for the sort and the price range).
const listQuery = z.object({
  kind: kind.optional(),
  brand: csv,
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  sort: z.enum(["price_asc", "price_desc", "name"]).default("price_asc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

catalogRouter.get("/products", async (req, res) => {
  const q = parse(listQuery, req.query);
  const filter: Record<string, unknown> = { isActive: true };
  if (q.kind) filter.kind = q.kind;
  if (q.brand?.length) filter.brand = { $in: q.brand };
  if (q.minPrice !== undefined || q.maxPrice !== undefined) {
    filter.basePrice = { ...(q.minPrice !== undefined && { $gte: q.minPrice }), ...(q.maxPrice !== undefined && { $lte: q.maxPrice }) };
  }
  const sort = { price_asc: { basePrice: 1 }, price_desc: { basePrice: -1 }, name: { name: 1 } }[q.sort] as Record<string, 1 | -1>;

  const [items, total] = await Promise.all([
    Product.find(filter, CARD_FIELDS).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean<CardSource[]>(),
    Product.countDocuments(filter),
  ]);
  res.json({ items: items.map(toCard), total, page: q.page, pages: Math.ceil(total / q.limit) });
});

// GET /api/products/facets?kind=: brands and price range for the filter sidebar.
// $facet runs several aggregations over the same matched documents in one round trip.
catalogRouter.get("/products/facets", async (req, res) => {
  const { kind: k } = parse(z.object({ kind: kind.optional() }), req.query);
  const [facets] = await Product.aggregate([
    { $match: { isActive: true, ...(k && { kind: k }) } },
    {
      $facet: {
        brands: [{ $group: { _id: "$brand", count: { $sum: 1 } } }, { $sort: { _id: 1 } }, { $project: { _id: 0, brand: "$_id", count: 1 } }],
        price: [{ $group: { _id: null, min: { $min: "$basePrice" }, max: { $max: "$basePrice" } } }, { $project: { _id: 0 } }],
      },
    },
  ]);
  res.json({ brands: facets.brands, price: facets.price[0] ?? { min: 0, max: 0 } });
});

// GET /api/search?q=&kind=: full-text search. Index: product_text (weights name 10, brand 5,
// description 1), results ranked by textScore.
const searchQuery = z.object({ q: z.string().trim().min(1).max(100), kind: kind.optional() });

catalogRouter.get("/search", async (req, res) => {
  const q = parse(searchQuery, req.query);
  const items = await Product.find(
    { $text: { $search: q.q }, isActive: true, ...(q.kind && { kind: q.kind }) },
    { ...CARD_FIELDS, score: { $meta: "textScore" } },
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(40)
    .lean<(CardSource & { score: number })[]>();
  res.json({ query: q.q, items: items.map(toCard), total: items.length });
});

// GET /api/products/:slug: product page. Index: {slug:1} unique.
catalogRouter.get("/products/:slug", async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true }, { __v: 0 }).lean();
  if (!product) throw new HttpError(404, "Product not found");
  res.json(product);
});

// GET /api/products/:slug/related: compatibility in both directions.
//  - phone     -> accessories that fit it (by exact model, connector/port, or platform)
//  - accessory -> the phones it fits (by compatibleModels)
catalogRouter.get("/products/:slug/related", async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true }).lean<Record<string, any>>();
  if (!product) throw new HttpError(404, "Product not found");

  const cards = (filter: Record<string, unknown>, sort: Record<string, 1 | -1> = { basePrice: 1 }, limit = 12) =>
    Product.find({ isActive: true, ...filter }, CARD_FIELDS).sort(sort).limit(limit).lean<CardSource[]>().then((r) => r.map(toCard));

  if (product.kind === "phone") {
    // Index: {compatibleModels:1} (multikey), matching an array element by equality
    const [cases, screenProtectors, chargers, cables, wireless, smartwatches] = await Promise.all([
      cards({ kind: "case", compatibleModels: product.modelKey }),
      cards({ kind: "screen_protector", compatibleModels: product.modelKey }),
      cards({ kind: "charging", subType: "charger", ports: product.port }, { wattage: -1 }, 6),
      cards({ kind: "charging", subType: "cable", "connectors.to": product.port }),
      product.wirelessCharging ? cards({ kind: "charging", subType: "wireless_pad" }) : Promise.resolve([]),
      cards({ kind: "smartwatch", compatiblePlatforms: product.os }),
    ]);
    res.json({
      groups: [
        { title: "Cases", items: cases },
        { title: "Screen protectors", items: screenProtectors },
        { title: "Chargers", items: chargers },
        { title: "Cables", items: cables },
        { title: "Wireless charging", items: wireless },
        { title: "Smartwatches", items: smartwatches },
      ].filter((g) => g.items.length),
    });
    return;
  }

  if (Array.isArray(product.compatibleModels)) {
    res.json({ groups: [{ title: "Fits these phones", items: await cards({ kind: "phone", modelKey: { $in: product.compatibleModels } }) }] });
    return;
  }

  // Other kinds: more from the same category
  res.json({ groups: [{ title: "You may also like", items: await cards({ kind: product.kind, _id: { $ne: product._id } }, { basePrice: 1 }, 8) }] });
});
