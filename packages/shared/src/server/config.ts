import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Load the repo-root .env once (Node 22 built-in, no dotenv needed).
const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

export const config = {
  mongoUri: required("MONGO_URI"),
  /** Read-only MongoDB user, secondaryPreferred. Used for all analyst queries. */
  mongoAnalystUri: required("MONGO_ANALYST_URI"),
  redisUrl: required("REDIS_URL"),
  apiPort: Number(process.env.API_PORT ?? 4000),
  sessionSecret: required("SESSION_SECRET"),
};
