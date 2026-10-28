// INTEGRATION TEST: Redis tokens must be rebuilt from the Postgres stock

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.ts";
import { createPool } from "../src/lib/db.ts";
import { createGate } from "../src/lib/gate.ts";
import { createRedis } from "../src/lib/redis.ts";
import { copyStockToRedis } from "../src/lib/seed.ts";

describe("copyStockToRedis", () => {
  const config = loadConfig();
  const pool = createPool(config.postgres);
  const redis = createRedis(config.redis);
  const gate = createGate(redis);
  let productId: number;

  // own product per test (new id from Postgres) --> no clash with other test files
  beforeEach(async () => {
    const { rows } = await pool.query(
      "INSERT INTO products (name, stock) VALUES ('test phone', 7) RETURNING id",
    );
    productId = rows[0].id;
  });

  afterEach(async () => {
    await pool.query("DELETE FROM products WHERE id = $1", [productId]);
    await gate.remove(productId);
  });

  afterAll(async () => {
    await pool.end();
    redis.disconnect();
  });

  it("copies the Postgres stock into Redis", async () => {
    expect(await copyStockToRedis(pool, gate, productId)).toBe(7);

    expect(await gate.stockLeft(productId)).toBe(7);
  });

  it("replaces a wrong Redis value and forgets old buyers", async () => {
    await gate.reset(productId, 99);
    await gate.reserve(productId, "old-buyer");

    await copyStockToRedis(pool, gate, productId);

    expect(await gate.stockLeft(productId)).toBe(7);
    expect(await gate.buyerCount(productId)).toBe(0);
  });

  it("refuses a product that does not exist", async () => {
    await expect(copyStockToRedis(pool, gate, 999999999)).rejects.toThrow(
      "not found",
    );
  });
});
