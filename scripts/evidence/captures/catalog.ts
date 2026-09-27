import { connectMongo } from "@da2/shared/server";
import type { Db, Document } from "mongodb";
import { recordText } from "../lib";
import { screenshot } from "../screenshot";
import type { EvidenceSet } from "./index";

const phase = "02-catalog";
const WEB = "http://localhost:5173";

export const catalog: EvidenceSet = {
  description: "Polymorphic product documents, schema validation, query plans, storefront screenshots",
  async run() {
    const db = (await connectMongo()).db as unknown as Db;
    const products = db.collection("products");

    // 1. Two very different documents in the same collection
    const firstVariant = { variants: { $slice: 1 }, __v: 0, createdAt: 0, updatedAt: 0 };
    const phone = await products.findOne({ slug: "galaxy-s25-ultra" }, { projection: firstVariant });
    const protector = await products.findOne({ kind: "screen_protector", slug: /galaxy-s25-ultra/ }, { projection: firstVariant });
    const phoneFields = Object.keys(phone ?? {}).length;
    const protectorFields = Object.keys(protector ?? {}).length;
    recordText(
      {
        phase,
        name: "polymorphic-documents",
        title: "Two product kinds in one collection",
        shows: `A phone (${phoneFields} top-level fields) and a screen protector (${protectorFields} fields) stored side by side in \`products\`. Each document carries only its own attributes: no NULL columns, no EAV table, no migration per product type.`,
        reportSection: "7. Characteristics: flexible schema",
      },
      {
        lang: "json",
        command: 'db.products.findOne({ slug: "galaxy-s25-ultra" }) / findOne({ kind: "screen_protector", ... })',
        body: `// phone\n${JSON.stringify(phone, null, 2)}\n\n// screen_protector\n${JSON.stringify(protector, null, 2)}`,
      },
    );

    // 2. Schema validation: flexible, but not a free-for-all
    const base = { slug: "evidence-probe", name: "Probe", brand: "Test", basePrice: 100, isActive: true };
    const variant = { sku: "PROBE-1", label: "Std", price: 100, stock: 1 };
    const tries: [string, Document][] = [
      ["valid product with an attribute no other product has", { ...base, kind: "audio", variants: [variant], bassBoostLevels: 5 }],
      ["negative stock", { ...base, kind: "audio", variants: [{ ...variant, stock: -1 }] }],
      ["unknown product kind", { ...base, kind: "laptop", variants: [variant] }],
      ["missing required field (no variants)", { ...base, kind: "audio" }],
      ["price as a string", { ...base, kind: "audio", variants: [{ ...variant, price: "100" }] }],
    ];
    const lines: string[] = [];
    for (const [label, doc] of tries) {
      try {
        await products.insertOne(doc);
        lines.push(`${label.padEnd(56)} ACCEPTED`);
      } catch (e: any) {
        const detail = e.errInfo?.details?.schemaRulesNotSatisfied?.[0];
        const rule = detail ? ` [${detail.operatorName}${detail.propertiesNotSatisfied ? `: ${detail.propertiesNotSatisfied.map((p: any) => p.propertyName).join(", ")}` : detail.missingProperties ? `: ${detail.missingProperties}` : ""}]` : "";
        lines.push(`${label.padEnd(56)} REJECTED (${e.codeName ?? e.message})${rule}`);
      } finally {
        await products.deleteMany({ slug: "evidence-probe" });
      }
    }
    recordText(
      {
        phase,
        name: "schema-validation",
        title: "Schema validation on the products collection",
        shows: "The $jsonSchema validator enforces only the shared base fields (kind, price, stock >= 0...). A new, kind-specific attribute is accepted without a migration, while invalid data is rejected by the database itself.",
        reportSection: "7. Characteristics: schema-on-write vs flexible schema",
      },
      { command: "db.products.insertOne(<probe document>)  (probes are deleted afterwards)", body: lines.join("\n") },
    );

    // 3. Query plans: every catalog query uses an index; compare with a forced collection scan
    const total = await products.countDocuments();
    const queries: { label: string; filter: Document; sort?: Document; projection?: Document }[] = [
      { label: "Category listing: phones by price (UC8)", filter: { isActive: true, kind: "phone" }, sort: { basePrice: 1 } },
      { label: "Brand filter: Samsung products (UC8)", filter: { isActive: true, brand: "Samsung" } },
      { label: "Accessories for iPhone 16 Pro (UC8)", filter: { isActive: true, compatibleModels: "apple-iphone-16-pro" } },
      { label: "Product page by slug (UC8)", filter: { slug: "iphone-16-pro", isActive: true } },
      { label: "Text search: 'magsafe charger' (UC9)", filter: { $text: { $search: "magsafe charger" }, isActive: true }, projection: { score: { $meta: "textScore" } }, sort: { score: { $meta: "textScore" } } },
    ];
    const out = [`products in collection: ${total}`, ""];
    for (const q of queries) {
      const cursor = () => products.find(q.filter, { projection: q.projection }).sort(q.sort ?? {});
      const withIndex: any = await cursor().explain("executionStats");
      out.push(`▶ ${q.label}`, `  filter: ${JSON.stringify(q.filter)}${q.sort ? `  sort: ${JSON.stringify(q.sort)}` : ""}`);
      out.push(`  with index    ${summarise(withIndex)}`);
      if (!q.filter.$text) {
        const scan: any = await cursor().hint({ $natural: 1 }).explain("executionStats");
        out.push(`  forced COLLSCAN ${summarise(scan)}`);
      }
      out.push("");
    }
    recordText(
      {
        phase,
        name: "query-plans",
        title: "Catalog query plans (explain executionStats)",
        shows: "Each storefront query is served by the index designed for it (IXSCAN / TEXT_MATCH), examining only the matching documents; the forced collection scan reads every document for the same result.",
        reportSection: "5. Data model: indexing (ESR) / 9. Strengths",
      },
      { command: "db.products.find(...).sort(...).explain('executionStats')  vs  .hint({ $natural: 1 })", body: out.join("\n") },
    );

    // 4. Storefront screenshots (only if the web app is running)
    if (!(await reachable(WEB))) {
      console.log(`  – skipped storefront screenshots (web app not running at ${WEB})`);
      return;
    }
    const shots: { name: string; title: string; shows: string; url: string; section: string }[] = [
      { name: "storefront-home", title: "Storefront: home", shows: "Home page with category tiles (per-kind counts and starting prices from an aggregation).", url: "/", section: "6. Implementation" },
      { name: "storefront-category-phones", title: "Storefront: phones listing", shows: "Phones listing sorted by price, with brand and price facets computed by a $facet aggregation.", url: "/c/phone?sort=price_desc", section: "6. Implementation" },
      { name: "storefront-category-filtered", title: "Storefront: filtered cases", shows: "Cases filtered by brand and price; filters are held in the URL and served by indexed queries.", url: "/c/case?brand=Spigen,OtterBox&max=10000", section: "6. Implementation" },
      { name: "storefront-product-phone", title: "Storefront: phone product page", shows: "Phone page with storage/colour variants, phone-specific specs, and compatible accessories matched by model, connector and platform.", url: "/p/galaxy-s25-ultra", section: "6. Implementation: flexible schema in the UI" },
      { name: "storefront-product-accessory", title: "Storefront: accessory product page", shows: "A case uses the same page template with a completely different spec table, plus the reverse lookup: which phones it fits.", url: "/p/spigen-ultra-hybrid-magfit-iphone-16-pro", section: "6. Implementation: flexible schema in the UI" },
      { name: "storefront-search", title: "Storefront: search", shows: "Full-text search ranked by weighted textScore (name > brand > description).", url: "/search?q=magsafe%20charger", section: "6. Implementation" },
    ];
    for (const s of shots) {
      await screenshot({ phase, name: s.name, title: s.title, shows: s.shows, reportSection: s.section }, { url: WEB + s.url });
    }
  },
};

/** One-line summary of an explain() result: plan stages, index, keys/docs examined, returned, time. */
function summarise(explain: any) {
  const stages: string[] = [];
  let index: string | undefined;
  const walk = (s: any) => {
    if (!s) return;
    stages.push(s.stage);
    index ??= s.indexName;
    walk(s.inputStage);
    s.inputStages?.forEach(walk);
  };
  walk(explain.queryPlanner.winningPlan.queryPlan ?? explain.queryPlanner.winningPlan);
  const e = explain.executionStats;
  return `${stages.join(" <- ").padEnd(34)} index=${(index ?? "-").padEnd(22)} keysExamined=${String(e.totalKeysExamined).padEnd(4)} docsExamined=${String(e.totalDocsExamined).padEnd(4)} returned=${String(e.nReturned).padEnd(4)} ${e.executionTimeMillis}ms`;
}

async function reachable(url: string) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}
