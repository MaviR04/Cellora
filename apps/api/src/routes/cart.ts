// Cart endpoints (UC10 Manage Cart). All state is in Redis; see lib/cart.ts.
import { Router } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { Product } from "@da2/shared/server";
import { HttpError, parse } from "../lib/http";
import { CART_TTL, cartKey, ensureCartKey, loadCart, MAX_QTY_PER_LINE } from "../lib/cart";

export function cartRouter(redis: Redis) {
  const router = Router();

  async function variantStock(sku: string): Promise<number> {
    const product = await Product.findOne({ "variants.sku": sku, isActive: true }, { "variants.$": 1 }).lean<any>();
    if (!product) throw new HttpError(404, `Unknown SKU ${sku}`);
    return product.variants[0].stock;
  }

  router.get("/cart", async (req, res) => {
    res.json(await loadCart(redis, cartKey(req)));
  });

  // Add (increments). Quantity is capped at the stock available and at MAX_QTY_PER_LINE.
  router.post("/cart/items", async (req, res) => {
    const { sku, qty } = parse(z.object({ sku: z.string().min(1), qty: z.number().int().min(1).max(MAX_QTY_PER_LINE).default(1) }), req.body);
    const stock = await variantStock(sku);
    if (stock === 0) throw new HttpError(409, "This option is out of stock");
    const key = ensureCartKey(req, res);
    const current = Number((await redis.hget(key, sku)) ?? 0);
    const next = Math.min(current + qty, stock, MAX_QTY_PER_LINE);
    await redis.multi().hset(key, sku, next).expire(key, CART_TTL).exec();
    res.json(await loadCart(redis, key));
  });

  // Set an exact quantity; 0 removes the line.
  router.patch("/cart/items/:sku", async (req, res) => {
    const { qty } = parse(z.object({ qty: z.number().int().min(0).max(MAX_QTY_PER_LINE) }), req.body);
    const key = cartKey(req);
    if (!key) throw new HttpError(404, "Cart is empty");
    if (qty === 0) {
      await redis.hdel(key, req.params.sku);
    } else {
      const stock = await variantStock(req.params.sku);
      await redis.multi().hset(key, req.params.sku, Math.min(qty, stock)).expire(key, CART_TTL).exec();
    }
    res.json(await loadCart(redis, key));
  });

  router.delete("/cart/items/:sku", async (req, res) => {
    const key = cartKey(req);
    if (key) await redis.hdel(key, req.params.sku);
    res.json(await loadCart(redis, key));
  });

  return router;
}
