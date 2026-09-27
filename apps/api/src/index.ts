import { config, connectAnalystMongo, connectMongo, connectRedis } from "@da2/shared/server";
import { createApp } from "./app";

const mongo = await connectMongo();
// Separate read-only connection (da2_analyst, secondaryPreferred) for analyst queries
const analyst = await connectAnalystMongo();
const redis = connectRedis();

createApp({ mongo, analyst, redis }).listen(config.apiPort, () => {
  console.log(`API listening on http://localhost:${config.apiPort}`);
});
