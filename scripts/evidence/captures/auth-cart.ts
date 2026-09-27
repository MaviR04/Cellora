import { randomUUID } from "node:crypto";
import { connectMongo, connectRedis, User } from "@da2/shared/server";
import type { Db } from "mongodb";
import { recordText } from "../lib";
import { screenshot } from "../screenshot";
import { API, Client, reachable } from "../http";
import type { EvidenceSet } from "./index";

const phase = "03-auth-cart";
const WEB = "http://localhost:5173";
const mask = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;

export const authCart: EvidenceSet = {
  description: "RBAC matrix, Redis sessions & revocation, Redis carts & guest merge, user document, screenshots",
  async run() {
    if (!(await reachable(`${API}/health`))) throw new Error(`API not running at ${API}`);
    const db = (await connectMongo()).db as unknown as Db;
    const redis = connectRedis();

    // 1. RBAC matrix: every role against endpoints of increasing privilege
    const who = [
      { label: "anonymous", email: null },
      { label: "customer", email: "customer@cellora.test" },
      { label: "analyst", email: "analyst@cellora.test" },
      { label: "support", email: "support@cellora.test" },
      { label: "admin", email: "admin@cellora.test" },
    ];
    const endpoints: [method: "GET" | "POST", path: string, label: string][] = [
      ["GET", "/products?kind=phone&limit=1", "GET  /products (public)"],
      ["GET", "/auth/sessions", "GET  /auth/sessions (logged in)"],
      ["GET", "/staff/me", "GET  /staff/me (any staff)"],
      // A valid but non-existent user id: admin passes RBAC and gets 404, nothing is revoked.
      ["POST", "/admin/users/000000000000000000000000/revoke-sessions", "POST /admin/.../revoke-sessions (admin)"],
    ];
    const rows = [`${"endpoint".padEnd(42)}${who.map((w) => w.label.padEnd(11)).join("")}`];
    const clients = await Promise.all(who.map(async (w) => { const c = new Client(); if (w.email) await c.login(w.email); return c; }));
    for (const [method, path, label] of endpoints) {
      const codes = await Promise.all(clients.map((c) => c.request(method, path).then((r) => r.status)));
      rows.push(`${label.padEnd(42)}${codes.map((c) => String(c).padEnd(11)).join("")}`);
    }
    recordText(
      { phase, name: "rbac-matrix", title: "Role-based access control matrix", shows: "HTTP status for each role on endpoints of increasing privilege: 401 = not logged in, 403 = logged in but wrong role, 200/404 = allowed through.", reportSection: "6. Implementation: access control (UC4)" },
      { body: rows.join("\n"), command: "API requests as each demo account" },
    );

    // 2. Guest cart -> login -> merged into the customer's cart
    const anonymousId = randomUUID();
    const shopper = new Client({ "X-Anonymous-Id": anonymousId });
    const customer = await User.findOne({ email: "customer@cellora.test" }).lean();
    await redis.del(`cart:u:${customer!._id}`); // start the demo from an empty customer cart
    await shopper.post("/cart/items", { sku: "GS25U-256-TS", qty: 1 });
    await shopper.post("/cart/items", { sku: "SPUH-GALAXYS25ULTRA-C", qty: 2 });
    const cid = shopper.cookie("cid")!;
    const guestKey = `cart:${cid}`;
    const before = [`${guestKey}  HASH  ${JSON.stringify(await redis.hgetall(guestKey))}  TTL ${await redis.ttl(guestKey)}s`];
    const user = await shopper.login("customer@cellora.test");
    const userKey = `cart:u:${user.id}`;
    const after = [
      `EXISTS ${guestKey} -> ${await redis.exists(guestKey)}   (guest cart deleted, cid cookie cleared)`,
      `${userKey}  HASH  ${JSON.stringify(await redis.hgetall(userKey))}  TTL ${await redis.ttl(userKey)}s`,
    ];
    const cart = (await shopper.get("/cart")).body;
    recordText(
      { phase, name: "guest-cart-merge", title: "Redis cart: guest cart merged on login", shows: "A guest cart (HASH sku -> qty, 30-day TTL) is folded into the customer's cart with HINCRBY at login. Prices are not stored in Redis; the API joins live prices from MongoDB.", reportSection: "6. Implementation: carts in Redis (UC10)" },
      {
        command: "HGETALL / TTL / EXISTS on cart keys, then GET /api/cart",
        body: [
          "# before login (guest)",
          ...before,
          "",
          "# after login",
          ...after,
          "",
          "# GET /api/cart: Redis quantities joined with MongoDB prices and stock",
          ...cart.lines.map((l: any) => `${l.sku.padEnd(24)} x${l.qty}  ${l.name} (${l.variantLabel})  unit ${l.unitPrice / 100}  stock ${l.stock}`),
          `subtotal ${cart.subtotal / 100} LKR`,
        ].join("\n"),
      },
    );

    // 3. Session in Redis, then instant revocation by an admin
    const sid = await redis.smembers(`user_sessions:${user.id}`);
    const sessLines = [];
    for (const id of sid) {
      const h = await redis.hgetall(`sess:${id}`);
      sessLines.push(`sess:${mask(id)}  HASH  {userId: ${h.userId}, role: ${h.role}, email: ${h.email}}  TTL ${await redis.ttl(`sess:${id}`)}s`);
    }
    const meBefore = (await shopper.get("/auth/me")).body.user?.email ?? null;
    const admin = new Client();
    await admin.login("admin@cellora.test");
    const revoke = await admin.post(`/admin/users/${user.id}/revoke-sessions`);
    const meAfter = (await shopper.get("/auth/me")).body.user?.email ?? null;
    const audit = await db.collection("audit_log").find({ action: "sessions_revoked", "target.id": user.id }).sort({ at: -1 }).limit(1).next();
    recordText(
      { phase, name: "session-revocation", title: "Redis sessions and instant revocation", shows: "Sessions are Redis hashes with a TTL, indexed per user in a SET. An admin revoking a user's sessions deletes the keys, so the user is logged out on their very next request (a JWT could not be revoked before expiry). The action is written to audit_log.", reportSection: "6. Implementation: sessions (UC4) / 7. Characteristics: key-value store" },
      {
        command: "SMEMBERS user_sessions:<id>; HGETALL sess:<id>; POST /api/admin/users/:id/revoke-sessions",
        body: [
          `customer sessions (${sid.length}):`,
          ...sessLines.map((l) => "  " + l),
          "",
          `GET /api/auth/me as customer  -> ${meBefore}`,
          `admin: POST revoke-sessions   -> ${revoke.status} ${JSON.stringify(revoke.body)}`,
          `GET /api/auth/me as customer  -> ${meAfter}   (same cookie, session no longer exists)`,
          `EXISTS user_sessions:${user.id} -> ${await redis.exists(`user_sessions:${user.id}`)}`,
          "",
          `audit_log: ${JSON.stringify({ action: audit?.action, actorRole: audit?.actorRole, target: audit?.target, details: audit?.details })}`,
        ].join("\n"),
      },
    );

    // 4. The user document (password hash truncated)
    const doc: any = await User.findById(user.id).lean();
    doc.passwordHash = `${doc.passwordHash.slice(0, 20)}… (scrypt, per-user salt)`;
    recordText(
      { phase, name: "user-document", title: "Customer document", shows: "A customer in `users`: scrypt password hash with a per-user salt, and the anonymous browser IDs linked at login (identity stitching, bounded to 20 with $push/$slice).", reportSection: "5. Data model: users" },
      { lang: "json", command: `db.users.findOne({ email: "customer@cellora.test" })`, body: JSON.stringify(doc, null, 2) },
    );

    // Leave the customer with a known cart for the screenshots
    await redis.del(userKey);
    const c2 = new Client();
    await c2.login("customer@cellora.test");
    await c2.post("/cart/items", { sku: "GS25U-256-TS", qty: 1 });
    await c2.post("/cart/items", { sku: "SPUH-GALAXYS25ULTRA-C", qty: 2 });
    await c2.post("/cart/items", { sku: "SMS-45W", qty: 1 });
    redis.disconnect();

    // 5. Screenshots
    if (!(await reachable(WEB))) {
      console.log(`  – skipped screenshots (web app not running at ${WEB})`);
      return;
    }
    const loginAs = (email: string) => async (context: import("playwright").BrowserContext) => {
      const r = await context.request.post(`${WEB}/api/auth/login`, { data: { email, password: process.env.SEED_USER_PASSWORD } });
      if (!r.ok()) throw new Error(`login failed for ${email}`);
    };
    await screenshot({ phase, name: "login-page", title: "Login page", shows: "Login with the demo accounts for each role.", reportSection: "6. Implementation" }, { url: `${WEB}/login`, fullPage: false });
    await screenshot(
      { phase, name: "cart-page", title: "Cart (logged-in customer)", shows: "Cart held in Redis, displayed with live prices and stock from MongoDB.", reportSection: "6. Implementation: carts (UC10)" },
      { url: `${WEB}/cart`, setup: loginAs("customer@cellora.test"), fullPage: false },
    );
    await screenshot(
      { phase, name: "add-to-cart", title: "Product page after adding to cart", shows: "Add to cart updates the Redis cart and the header count.", reportSection: "6. Implementation: carts (UC10)" },
      {
        url: `${WEB}/p/pixel-9`,
        setup: loginAs("customer@cellora.test"),
        prepare: async (page) => {
          await page.getByRole("button", { name: "Add to cart" }).click();
          await page.getByText("Added").waitFor();
        },
        fullPage: false,
      },
    );
    await screenshot(
      { phase, name: "staff-home-analyst", title: "Staff area as analyst", shows: "Staff-only area reached after logging in with a staff role.", reportSection: "6. Implementation: access control (UC4)" },
      { url: `${WEB}/staff`, setup: loginAs("analyst@cellora.test"), fullPage: false },
    );
  },
};
