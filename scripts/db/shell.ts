// Opens an interactive mongosh session as the app user (or --analyst for the read-only user).
// Runs inside the mongo1 container, where host.docker.internal also resolves, so the
// replica-set URI from .env works unchanged. Usage: npm run db:shell [-- --analyst]
import { spawnSync } from "node:child_process";
import { config } from "@da2/shared/server";

const uri = process.argv.includes("--analyst") ? config.mongoAnalystUri : config.mongoUri;
const { status } = spawnSync("docker", ["exec", "-it", "mongo1", "mongosh", uri, "--quiet"], { stdio: "inherit" });
process.exit(status ?? 0);
