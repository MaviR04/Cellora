import { config, connectMongo, connectRedis } from "@da2/shared/server";
import { createApp } from "./app";

const mongo = await connectMongo();
const redis = connectRedis();

createApp({ mongo, redis }).listen(config.apiPort, () => {
  console.log(`API listening on http://localhost:${config.apiPort}`);
});
