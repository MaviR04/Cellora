import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { config, connectAnalystMongo, connectMongo, connectRedis } from "@da2/shared/server";
import { MongoClient } from "mongodb";
import type { Db } from "mongodb";
import { recordText, repoRoot } from "../lib";
import { screenshot } from "../screenshot";
import type { EvidenceSet } from "./index";

const phase = "01-foundation";

export const foundation: EvidenceSet = {
  description: "Containers, replica set, DB access control, Redis persistence, collections & indexes, API health",
  async run() {
    // 1. Running containers
    const composeFile = join(repoRoot, "infra", "docker-compose.yml");
    const ps = execFileSync(
      "docker",
      ["compose", "-f", composeFile, "ps", "--format", "table {{.Name}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"],
      { encoding: "utf8" },
    );
    recordText(
      { phase, name: "docker-compose-ps", title: "Running containers", shows: "Three MongoDB nodes and Redis running and healthy in Docker.", reportSection: "4. Solution design: deployment" },
      { body: ps, command: "docker compose -f infra/docker-compose.yml ps" },
    );

    // 2. Replica set status
    const db = (await connectMongo()).db as unknown as Db;
    const status = await db.admin().command({ replSetGetStatus: 1 });
    const conf = (await db.admin().command({ replSetGetConfig: 1 })).config;
    const priority = new Map<string, number>(conf.members.map((m: any) => [m.host, m.priority]));
    const rows = status.members.map((m: any) =>
      [m.name.padEnd(28), m.stateStr.padEnd(10), String(m.health).padEnd(7), String(priority.get(m.name)).padEnd(9), `${m.uptime}s`].join(""),
    );
    recordText(
      { phase, name: "replica-set-status", title: "Replica set status (rs0)", shows: "A 3-member replica set with one PRIMARY and two SECONDARY nodes, the basis for replication, failover and multi-document transactions.", reportSection: "7. Characteristics: replication & availability" },
      {
        command: "db.adminCommand({ replSetGetStatus: 1 })",
        body: [`set: ${status.set}    date: ${new Date(status.date).toISOString()}`, "", "member                      state     health priority uptime", ...rows].join("\n"),
      },
    );

    // 2b. Database-level access control: app vs analyst vs unauthenticated
    const analyst = await connectAnalystMongo();
    const roles = async (d: Db) =>
      ((await d.command({ connectionStatus: 1 })).authInfo.authenticatedUserRoles as { role: string; db: string }[])
        .map((r) => `${r.role}@${r.db}`)
        .join(", ");
    const attempt = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        return `${label.padEnd(44)} ALLOWED`;
      } catch (e: any) {
        return `${label.padEnd(44)} REJECTED (${e.codeName ?? e.message})`;
      }
    };
    const analystDb = analyst.db as unknown as Db;
    const noAuth = await MongoClient.connect("mongodb://host.docker.internal:27017/?directConnection=true");
    const access = [
      `app user (da2_app) roles:          ${await roles(db)}`,
      `analyst user (da2_analyst) roles:  ${await roles(analystDb)}`,
      "",
      await attempt("analyst: read settings", () => analystDb.collection("settings").findOne({})),
      await attempt("analyst: insert into settings", () => analystDb.collection("settings").insertOne({ probe: true } as any)),
      await attempt("analyst: drop events collection", () => analystDb.collection("events").drop()),
      await attempt("no credentials: read products", () => noAuth.db("da2").collection("products").findOne({})),
    ];
    await noAuth.close();
    await analyst.close();
    recordText(
      { phase, name: "database-access-control", title: "Database-level access control", shows: "MongoDB itself enforces roles: the analyst login can read but every write is rejected, and unauthenticated connections are refused.", reportSection: "7. Characteristics: security model (UC4)" },
      { body: access.join("\n"), command: "connectionStatus + attempted operations per user" },
    );

    // 3. Collections, collection types/options and indexes
    const collections = await db.listCollections().toArray();
    const lines: string[] = [];
    for (const c of collections.sort((a, b) => a.name.localeCompare(b.name))) {
      if (c.name.startsWith("system.")) continue;
      const opts: any = (c as any).options ?? {};
      const extras = [
        opts.timeseries && `timeseries=${JSON.stringify(opts.timeseries)}`,
        opts.expireAfterSeconds && `expireAfterSeconds=${opts.expireAfterSeconds} (${opts.expireAfterSeconds / 86400} days)`,
        opts.validator && `validator=$jsonSchema (required: ${opts.validator.$jsonSchema?.required?.join(", ")})`,
      ].filter(Boolean);
      lines.push(`${c.name}  [${c.type}]`, ...extras.map((e) => `  ${e}`));
      const idx = await db.collection(c.name).indexes().catch(() => []);
      for (const i of idx) {
        const flags = [i.unique && "unique", i.partialFilterExpression && "partial", i.weights && `weights=${JSON.stringify(i.weights)}`].filter(Boolean);
        lines.push(`  index ${i.name}: ${JSON.stringify(i.key)}${flags.length ? "  " + flags.join(" ") : ""}`);
      }
      lines.push("");
    }
    recordText(
      { phase, name: "collections-and-indexes", title: "Collections, options and indexes", shows: "The time-series events collection with TTL, the products $jsonSchema validator, and every index from the data model.", reportSection: "5. Data model" },
      { body: lines.join("\n"), command: "db.getCollectionInfos() + db.<collection>.getIndexes()" },
    );

    // 4. Redis persistence
    const redis = connectRedis();
    const aof = await redis.config("GET", "append*");
    const info = await redis.info("persistence");
    const keep = info.split("\r\n").filter((l) => /^(aof_enabled|aof_last_write_status|aof_rewrite_in_progress|rdb_last_save_time|loading):/.test(l));
    redis.disconnect();
    recordText(
      { phase, name: "redis-persistence", title: "Redis persistence configuration", shows: "Redis runs with append-only-file persistence, fsync every second (at most ~1 s of data at risk).", reportSection: "10. Limitations: Redis durability" },
      { body: [...pairs(aof as string[]), "", ...keep].join("\n"), command: "CONFIG GET append*  /  INFO persistence" },
    );

    // 5. API health (screenshot, only if the API is running)
    const healthUrl = `http://localhost:${config.apiPort}/api/health`;
    if (await reachable(healthUrl)) {
      await screenshot(
        { phase, name: "api-health", title: "API health endpoint", shows: "The Node API connected to the replica set (reporting the current primary) and to Redis.", reportSection: "6. Implementation" },
        {
          url: healthUrl,
          viewport: { width: 1000, height: 500 },
          fullPage: false,
        },
      );
    } else {
      console.log(`  – skipped api-health screenshot (API not running at ${healthUrl})`);
    }
  },
};

function pairs(flat: string[]) {
  const out: string[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(`${flat[i]} = ${flat[i + 1]}`);
  return out;
}

async function reachable(url: string) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}
