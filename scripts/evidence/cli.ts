// Usage: npm run evidence -- <set> [<set> ...]    e.g. npm run evidence -- foundation
//        npm run evidence -- --list
import { mongoose } from "@da2/shared/server";
import { closeBrowser } from "./screenshot";
import { sets } from "./captures/index";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--list")) {
  console.log("Evidence sets:");
  for (const [name, set] of Object.entries(sets)) console.log(`  ${name.padEnd(14)} ${set.description}`);
  process.exit(0);
}

let failed = false;
for (const name of args) {
  const set = sets[name];
  if (!set) {
    console.error(`Unknown evidence set "${name}". Use --list to see available sets.`);
    failed = true;
    continue;
  }
  console.log(`▶ ${name}`);
  try {
    await set.run();
  } catch (err) {
    failed = true;
    console.error(`  ✗ ${name} failed:`, err instanceof Error ? err.message : err);
  }
}

await closeBrowser();
await mongoose.disconnect();
process.exit(failed ? 1 : 0);
