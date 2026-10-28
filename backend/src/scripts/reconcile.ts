// Reconcile: pnpm reconcile [--fix] --> compares Redis with Postgres per product; --fix rebuilds Redis from Postgres

import { loadConfig } from "../lib/config.ts";
import { createPool } from "../lib/db.ts";
import { createGate } from "../lib/gate.ts";
import { createQueue } from "../lib/queue.ts";
import { reconcileProduct } from "../lib/reconcile.ts";
import { createRedis } from "../lib/redis.ts";

const fix = process.argv.includes("--fix");

const config = loadConfig();
const pool = createPool(config.postgres);
const redis = createRedis(config.redis);
const gate = createGate(redis);
const queue = await createQueue(config.rabbitmq);

try {
  // orders still in the queue are not in Postgres yet --> the numbers would not match
  const waiting = await queue.depth();
  if (waiting > 0) {
    throw new Error(`${waiting} orders are still queued: let the worker finish first`);
  }
  const dead = await queue.deadDepth();
  if (dead > 0) console.log(`warning: ${dead} orders are in the dead-letter queue`);

  const { rows } = await pool.query("SELECT id FROM products ORDER BY id");
  for (const { id } of rows) {
    const r = await reconcileProduct(pool, gate, id, { fix });
    const verdict = r.consistent ? "OK" : r.fixed ? "MISMATCH, fixed" : "MISMATCH (run with --fix)";
    console.log(
      `product ${r.productId}: ${verdict} | stock postgres=${r.postgresStock} redis=${r.redisStock} | buyers orders=${r.orderBuyers} redis=${r.redisBuyers}`,
    );
  }
} finally {
  await queue.close();
  await pool.end();
  redis.disconnect();
}
