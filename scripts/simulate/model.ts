// Shopper behaviour model shared by the backfill and live simulators.
//
// A session is planned as a list of steps (views, add to cart, login, checkout…) with realistic
// gaps between them. The probabilities below shape the purchase funnel the Analyst will see:
//   product_view -> add_to_cart -> checkout_started -> order_placed
// Mobile converts worse than desktop, returning customers convert better than guests, and some
// searches return nothing (a signal of catalog gaps).
import type { DeviceType, ProductKind } from "@da2/shared";

// ---------------------------------------------------------------------------------------------
// Deterministic randomness (same seed = same data)
// ---------------------------------------------------------------------------------------------
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    pick: <T>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    weighted: <T>(items: readonly (readonly [T, number])[]) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [item, w] of items) if ((r -= w) <= 0) return item;
      return items[items.length - 1][0];
    },
    uuid: () =>
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.floor(next() * 16);
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      }),
  };
}
export type Rng = ReturnType<typeof rng>;

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------
export interface SimProduct {
  _id: string;
  slug: string;
  name: string;
  kind: ProductKind;
  brand: string;
  basePrice: number;
  modelKey?: string;
  os?: string;
  compatibleModels?: string[];
  variants: { sku: string; price: number; stock: number; label: string }[];
}
export interface SimUser {
  _id: string;
  email: string;
  name: string;
  anonymousIds: string[];
}
export interface Device {
  type: DeviceType;
  os: string;
  browser: string;
  userAgent: string;
}

// ---------------------------------------------------------------------------------------------
// Tunable behaviour
// ---------------------------------------------------------------------------------------------
export const DEVICES: (readonly [Device, number])[] = [
  [{ type: "mobile", os: "Android", browser: "Chrome", userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A556E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36" }, 44],
  [{ type: "mobile", os: "iOS", browser: "Safari", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }, 18],
  [{ type: "desktop", os: "Windows", browser: "Chrome", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36" }, 18],
  [{ type: "desktop", os: "Windows", browser: "Edge", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0" }, 7],
  [{ type: "desktop", os: "macOS", browser: "Safari", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" }, 7],
  [{ type: "tablet", os: "iOS", browser: "Safari", userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }, 6],
];

/** Probability of each funnel step, given the previous one. */
const FUNNEL = {
  /** Chance to add each viewed product to the cart */
  addToCart: { mobile: 0.05, tablet: 0.065, desktop: 0.085 } as Record<DeviceType, number>,
  /** Leave straight after the landing page */
  bounce: 0.25,
  returningCustomerBoost: 1.35,
  checkoutGivenCart: 0.5,
  paymentGivenCheckout: 0.8,
  // Outcome of a submitted payment
  outcome: [["success", 0.9], ["payment_declined", 0.06], ["out_of_stock", 0.04]] as const,
};

/** Sessions per hour of the day in Sri Lanka (evening peak). */
export const HOURLY_WEIGHTS = [2, 1, 1, 1, 1, 2, 3, 5, 7, 8, 8, 9, 10, 9, 8, 8, 9, 11, 13, 15, 16, 14, 9, 4];

export const SEARCHES: (readonly [string, number])[] = [
  ["iphone 16", 10], ["galaxy s25", 8], ["magsafe charger", 6], ["airpods", 6], ["pixel 9", 5], ["fast charger", 5],
  ["s25 ultra case", 4], ["screen protector iphone", 4], ["power bank", 4], ["smart watch", 3], ["usb c cable", 3],
  ["sony headphones", 2], ["oneplus", 2], ["redmi note", 2],
  // Zero-result searches: products we don't sell (useful signal for the analyst)
  ["iphone 17", 3], ["laptop", 2], ["galaxy s24 case", 2], ["tripod", 1],
];

// ---------------------------------------------------------------------------------------------
// Session plan
// ---------------------------------------------------------------------------------------------
export type Step =
  | { t: "page"; path: string }
  | { t: "category"; kind: ProductKind; path: string }
  | { t: "product"; product: SimProduct; path: string }
  | { t: "search"; query: string; path: string }
  | { t: "add"; product: SimProduct; variant: SimProduct["variants"][number]; path: string }
  | { t: "remove"; sku: string; qty: number; path: string }
  | { t: "login"; user: SimUser; path: string }
  | { t: "checkout"; path: string }
  | { t: "pay"; method: "cod" | "card_approve" | "card_decline"; path: string }
  | { t: "place"; outcome: "success" | "payment_declined" | "out_of_stock"; path: string };

export interface SessionPlan {
  device: Device;
  /** Logged in from the first page (remembered session) */
  user: SimUser | null;
  /** Logs in part-way through (identify) */
  loginUser: SimUser | null;
  anonymousId: string;
  steps: { gapMs: number; step: Step }[];
}

export interface Catalog {
  products: SimProduct[];
  phones: SimProduct[];
  byKind: Map<ProductKind, SimProduct[]>;
  /** Popularity weight per product: flagships and cheap accessories get more views. */
  weight: Map<string, number>;
}

export function buildCatalog(products: SimProduct[]): Catalog {
  const byKind = new Map<ProductKind, SimProduct[]>();
  for (const p of products) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  const weight = new Map<string, number>();
  for (const p of products) {
    let w = 1;
    if (p.kind === "phone") w = /iPhone 16|Galaxy S25|Pixel 9|Galaxy A56/.test(p.name) ? 5 : 2.5;
    if (p.kind === "case" || p.kind === "charging") w = 1.6;
    weight.set(p._id, w);
  }
  return { products, phones: byKind.get("phone") ?? [], byKind, weight };
}

const KIND_WEIGHTS: (readonly [ProductKind, number])[] = [
  ["phone", 38], ["case", 16], ["charging", 14], ["audio", 12], ["screen_protector", 8], ["power_bank", 6], ["smartwatch", 6],
];

export function planSession(r: Rng, catalog: Catalog, users: SimUser[]): SessionPlan {
  const device = r.weighted(DEVICES);
  // 25% returning customers already logged in, 10% log in during the session, rest guests
  const who = r.weighted([["loggedIn", 25], ["logsIn", 10], ["guest", 65]] as const);
  const user = who === "loggedIn" ? r.pick(users) : null;
  const loginUser = who === "logsIn" ? r.pick(users) : null;
  const known = user ?? loginUser;
  // Customers mostly come back on a browser they've used before; guests usually get a new id
  const anonymousId = known?.anonymousIds.length && r.chance(0.8) ? r.pick(known.anonymousIds) : r.uuid();

  const steps: SessionPlan["steps"] = [];
  const gap = (min: number, max: number) => r.int(min, max) * 1000;
  const push = (step: Step, gapMs = gap(4, 45)) => steps.push({ gapMs: steps.length ? gapMs : 0, step });

  const pickProduct = (kind: ProductKind) => {
    const list = catalog.byKind.get(kind)!;
    return r.weighted(list.map((p) => [p, catalog.weight.get(p._id)!] as const));
  };
  const viewProduct = (p: SimProduct) => push({ t: "product", product: p, path: `/p/${p.slug}` });

  // Landing
  const landing = r.weighted([["home", 40], ["category", 30], ["product", 20], ["search", 10]] as const);
  let focusKind = r.weighted(KIND_WEIGHTS);
  if (landing === "home") push({ t: "page", path: "/" });
  if (landing === "category" || landing === "home") push({ t: "category", kind: focusKind, path: `/c/${focusKind}` });
  if (landing === "search") {
    const q = r.weighted(SEARCHES);
    push({ t: "search", query: q, path: `/search?q=${encodeURIComponent(q)}` });
  }

  if (r.chance(FUNNEL.bounce)) {
    if (landing === "product") viewProduct(pickProduct(focusKind));
    return { device, user, loginUser, anonymousId, steps };
  }

  // Browse 1–6 products; after a phone, often look at an accessory that fits it
  const viewed: SimProduct[] = [];
  const browseCount = r.weighted([[1, 30], [2, 25], [3, 18], [4, 12], [5, 8], [6, 7]] as const);
  let lastPhone: SimProduct | undefined;
  for (let i = 0; i < browseCount; i++) {
    let p: SimProduct;
    const accessories = lastPhone ? catalog.products.filter((x) => x.compatibleModels?.includes(lastPhone!.modelKey!)) : [];
    if (accessories.length && r.chance(0.45)) p = r.pick(accessories);
    else {
      if (r.chance(0.25)) {
        focusKind = r.weighted(KIND_WEIGHTS);
        push({ t: "category", kind: focusKind, path: `/c/${focusKind}` });
      } else if (r.chance(0.12)) {
        const q = r.weighted(SEARCHES);
        push({ t: "search", query: q, path: `/search?q=${encodeURIComponent(q)}` });
      }
      p = pickProduct(focusKind);
    }
    viewProduct(p);
    viewed.push(p);
    if (p.kind === "phone") lastPhone = p;
  }

  // Funnel
  let pAdd = FUNNEL.addToCart[device.type] * (known ? FUNNEL.returningCustomerBoost : 1);
  const cart: { product: SimProduct; variant: SimProduct["variants"][number] }[] = [];
  for (const p of viewed) {
    if (!r.chance(pAdd)) continue;
    const inStock = p.variants.filter((v) => v.stock > 0);
    if (!inStock.length) continue;
    const variant = r.pick(inStock);
    push({ t: "add", product: p, variant, path: `/p/${p.slug}` }, gap(5, 30));
    cart.push({ product: p, variant });
    pAdd *= 0.55; // each extra item is less likely
  }
  if (cart.length > 1 && r.chance(0.12)) {
    const removed = cart.pop()!;
    push({ t: "remove", sku: removed.variant.sku, qty: 1, path: "/cart" }, gap(5, 20));
  }

  if (cart.length && r.chance(FUNNEL.checkoutGivenCart)) {
    if (loginUser) push({ t: "login", user: loginUser, path: "/login?next=/checkout" }, gap(5, 25));
    push({ t: "checkout", path: "/checkout" }, gap(3, 15));
    if (r.chance(FUNNEL.paymentGivenCheckout)) {
      const outcome = r.weighted(FUNNEL.outcome);
      // Only a card can be declined; otherwise customers pick COD or card
      const method = outcome === "payment_declined" ? "card_decline" : r.weighted([["cod", 55], ["card_approve", 45]] as const);
      push({ t: "pay", method, path: "/checkout" }, gap(30, 120));
      push({ t: "place", outcome, path: "/checkout" }, gap(1, 3));
    }
  } else if (loginUser && r.chance(0.5)) {
    push({ t: "login", user: loginUser, path: "/login" }, gap(5, 25));
  }

  return { device, user, loginUser, anonymousId, steps };
}

/** The cart at the end of a plan (what checkout would buy). */
export function cartOf(plan: SessionPlan) {
  const lines = new Map<string, { product: SimProduct; variant: SimProduct["variants"][number]; qty: number }>();
  for (const { step } of plan.steps) {
    if (step.t === "add") lines.set(step.variant.sku, { product: step.product, variant: step.variant, qty: 1 });
    if (step.t === "remove") lines.delete(step.sku);
  }
  return [...lines.values()];
}
