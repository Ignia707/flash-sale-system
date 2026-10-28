// STARTS the app

import { loadConfig } from "../lib/config.ts";
import { createPool } from "../lib/db.ts";
import { createGate } from "../lib/gate.ts";
import { createQueue } from "../lib/queue.ts";
import { createRedis } from "../lib/redis.ts";
import { withSoldOutCache } from "../lib/sold-out-cache.ts";
import { buildApp } from "./app.ts";

const config = loadConfig();
const pool = createPool(config.postgres);
const redis = createRedis(config.redis);
const gate = withSoldOutCache(createGate(redis));
const queue = await createQueue(config.rabbitmq);

const app = buildApp({
  logger: true,
  gate,
  queue,
  checks: {
    postgres: () => pool.query("SELECT 1"),
    redis: () => redis.ping(),
  },
});

// finish in-flight requests, then close connections
async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await queue.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// accept connection from anywhere
await app.listen({ port: config.api.port, host: "0.0.0.0" });
