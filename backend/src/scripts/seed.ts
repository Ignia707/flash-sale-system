// Seed: pnpm seed [stock] --> with a number: DEV reset to one fresh product; always: copy Postgres stock into Redis

import { loadConfig } from "../lib/config.ts";
import { createPool } from "../lib/db.ts";
import { createGate } from "../lib/gate.ts";
import { createRedis } from "../lib/redis.ts";
import { copyStockToRedis, startFreshSale } from "../lib/seed.ts";

const config = loadConfig();
const pool = createPool(config.postgres);
const redis = createRedis(config.redis);
const gate = createGate(redis);

const stockArg = process.argv[2];

try {
  if (stockArg !== undefined) {
    const stock = Number(stockArg);
    if (!Number.isInteger(stock) || stock < 0) {
      throw new Error("stock must be a whole number, 0 or more");
    }
    await startFreshSale(pool, stock);
  }

  const { rows } = await pool.query("SELECT id FROM products ORDER BY id");
  if (rows.length === 0) console.log("no products in Postgres, nothing to load");

  for (const { id } of rows) {
    const stock = await copyStockToRedis(pool, gate, id);
    console.log(`product ${id}: ${stock} tokens loaded into Redis`);
  }
} finally {
  await pool.end();
  redis.disconnect();
}
