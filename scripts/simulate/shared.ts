// Helpers shared by the backfill and live simulators.
import { hashPassword, mongoose } from "@da2/shared/server";
import type { Db } from "mongodb";
import { rng, type SimProduct, type SimUser } from "./model";

export const SIM_USER_COUNT = 150;
export const simEmail = (i: number) => `sim-${String(i).padStart(3, "0")}@cellora.test`;

const FIRST = ["Kasun", "Nimali", "Tharindu", "Dilini", "Ashan", "Sachini", "Chamara", "Ishara", "Ruwan", "Hiruni", "Nuwan", "Kavindi", "Pradeep", "Sanduni", "Lahiru", "Anjali", "Mohamed", "Fathima", "Kumar", "Priya"];
const LAST = ["Perera", "Fernando", "Silva", "Jayasinghe", "Bandara", "Wickramasinghe", "Rathnayake", "Dissanayake", "Gunawardena", "Herath", "Rajapaksha", "Senanayake", "Nizar", "Rahman", "Sivakumar", "Kumarasamy"];
export const CITIES = ["Colombo 03", "Colombo 07", "Nugegoda", "Dehiwala", "Maharagama", "Kandy", "Galle", "Negombo", "Kurunegala", "Matara", "Jaffna", "Batticaloa", "Anuradhapura", "Ratnapura"];

/** Create (or keep) the simulated customer accounts. They can log in with SEED_USER_PASSWORD. */
export async function ensureSimUsers(db: Db): Promise<SimUser[]> {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password) throw new Error("Set SEED_USER_PASSWORD in .env");
  const users = db.collection("users");
  const existing = await users.countDocuments({ email: /^sim-\d+@cellora\.test$/ });
  if (existing < SIM_USER_COUNT) {
    const r = rng(1234);
    const passwordHash = await hashPassword(password); // one hash reused: they are test accounts
    const ops = Array.from({ length: SIM_USER_COUNT }, (_, i) => ({
      updateOne: {
        filter: { email: simEmail(i + 1) },
        update: {
          $setOnInsert: {
            email: simEmail(i + 1),
            name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
            passwordHash,
            role: "customer",
            status: "active",
            addresses: [],
            anonymousIds: Array.from({ length: r.int(1, 2) }, () => r.uuid()), // 1–2 devices each
            createdAt: new Date(Date.now() - r.int(20, 400) * 86_400_000),
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));
    await users.bulkWrite(ops);
    console.log(`simulated customers: ${SIM_USER_COUNT} ensured`);
  }
  const docs = await users.find({ email: /^sim-\d+@cellora\.test$/ }, { projection: { email: 1, name: 1, anonymousIds: 1 } }).toArray();
  return docs.map((u) => ({ _id: String(u._id), email: u.email, name: u.name, anonymousIds: u.anonymousIds ?? [] }));
}

export async function loadCatalog(db: Db): Promise<SimProduct[]> {
  const docs = await db
    .collection("products")
    .find({ isActive: true }, { projection: { slug: 1, name: 1, kind: 1, brand: 1, basePrice: 1, modelKey: 1, os: 1, compatibleModels: 1, variants: 1 } })
    .toArray();
  return docs.map((p: any) => ({
    ...p,
    _id: String(p._id),
    variants: p.variants.map((v: any) => ({ sku: v.sku, price: v.price, stock: v.stock, label: v.label })),
  }));
}

/** Result counts for the simulated search queries, from the real text index. */
export async function searchResultCounts(db: Db, queries: string[]) {
  const counts = new Map<string, number>();
  for (const q of queries) counts.set(q, await db.collection("products").countDocuments({ $text: { $search: q }, isActive: true }));
  return counts;
}

export { mongoose };
