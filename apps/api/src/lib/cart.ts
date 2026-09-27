// Carts live in Redis (data-model §7): a HASH of sku -> qty, 30-day TTL refreshed on every write.
//   cart:u:{userId}   logged-in customer
//   cart:{cartId}     guest (cartId in an httpOnly cookie, created on first add)
// Prices are NOT stored in the cart. They are read from MongoDB every time the cart is shown
// (and again at checkout), so a cart can never lock in a stale price.
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { Redis } from "ioredis";
import { Product } from "@da2/shared/server";
import type { Cart, CartLine } from "@da2/shared";
import { cookieOptions, readCookie } from "./cookies";

export const CART_COOKIE = "cid";
export const CART_TTL = 30 * 24 * 60 * 60;
export const MAX_QTY_PER_LINE = 10;

export const userCartKey = (userId: string) => `cart:u:${userId}`;
const guestCartKey = (cartId: string) => `cart:${cartId}`;

/** The cart key for this request, or null if a guest has no cart yet. */
export function cartKey(req: Request): string | null {
  if (req.user) return userCartKey(req.user.userId);
  const cid = readCookie(req, CART_COOKIE);
  return cid ? guestCartKey(cid) : null;
}

/** Like cartKey, but creates a guest cart id (and cookie) when needed. */
export function ensureCartKey(req: Request, res: Response): string {
  const existing = cartKey(req);
  if (existing) return existing;
  const cid = randomUUID();
  res.cookie(CART_COOKIE, cid, cookieOptions(CART_TTL));
  return guestCartKey(cid);
}

/** Joins the Redis cart (sku -> qty) with live product data from MongoDB. */
export async function loadCart(redis: Redis, key: string | null): Promise<Cart> {
  const raw = key ? await redis.hgetall(key) : {};
  const skus = Object.keys(raw);
  if (!skus.length) return { lines: [], itemCount: 0, subtotal: 0 };

  // One query for all SKUs. Index: {"variants.sku": 1} (multikey, unique)
  const products = await Product.find({ "variants.sku": { $in: skus } }, { slug: 1, name: 1, brand: 1, kind: 1, variants: 1, isActive: 1 }).lean<any[]>();
  const bySku = new Map<string, { product: any; variant: any }>();
  for (const product of products) for (const variant of product.variants) bySku.set(variant.sku, { product, variant });

  const lines: CartLine[] = skus.map((sku) => {
    const qty = Number(raw[sku]);
    const hit = bySku.get(sku);
    if (!hit) {
      return { sku, qty, productId: "", slug: "", name: "Unavailable item", brand: "", kind: "phone", variantLabel: sku, unitPrice: 0, stock: 0, lineTotal: 0, available: false };
    }
    const { product: p, variant: v } = hit;
    return {
      sku,
      qty,
      productId: String(p._id),
      slug: p.slug,
      name: p.name,
      brand: p.brand,
      kind: p.kind,
      variantLabel: v.label,
      unitPrice: v.price,
      stock: v.stock,
      lineTotal: v.price * qty,
      available: p.isActive && v.stock >= qty,
    };
  });
  lines.sort((a, b) => a.name.localeCompare(b.name));
  return {
    lines,
    itemCount: lines.reduce((n, l) => n + l.qty, 0),
    subtotal: lines.filter((l) => l.available).reduce((n, l) => n + l.lineTotal, 0),
  };
}

/** On login: fold the guest cart into the customer's cart, then delete the guest cart. */
export async function mergeGuestCart(redis: Redis, req: Request, res: Response, userId: string) {
  const cid = readCookie(req, CART_COOKIE);
  if (!cid) return;
  const guest = await redis.hgetall(guestCartKey(cid));
  const target = userCartKey(userId);
  const tx = redis.multi();
  for (const [sku, qty] of Object.entries(guest)) tx.hincrby(target, sku, Number(qty));
  if (Object.keys(guest).length) tx.expire(target, CART_TTL);
  tx.del(guestCartKey(cid));
  await tx.exec();
  res.clearCookie(CART_COOKIE, { path: "/" });
}
