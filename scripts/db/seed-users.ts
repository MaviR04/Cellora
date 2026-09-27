// Creates (or resets) one demo account per role. Password: SEED_USER_PASSWORD in .env.
// Usage: npm run db:seed-users
import { connectMongo, hashPassword, mongoose, User } from "@da2/shared/server";
import type { Role } from "@da2/shared";

const password = process.env.SEED_USER_PASSWORD;
if (!password) throw new Error("Set SEED_USER_PASSWORD in .env");

export const DEMO_USERS: { email: string; name: string; role: Role }[] = [
  { email: "admin@cellora.test", name: "Ayesha Admin", role: "admin" },
  { email: "analyst@cellora.test", name: "Nuwan Analyst", role: "analyst" },
  { email: "support@cellora.test", name: "Dilani Support", role: "support" },
  { email: "customer@cellora.test", name: "Kasun Perera", role: "customer" },
];

await connectMongo();
for (const u of DEMO_USERS) {
  await User.updateOne(
    { email: u.email },
    { $set: { name: u.name, role: u.role, status: "active", passwordHash: await hashPassword(password) } },
    { upsert: true },
  );
  console.log(`${u.role.padEnd(9)} ${u.email}`);
}
console.log("password: SEED_USER_PASSWORD from .env");
await mongoose.disconnect();
