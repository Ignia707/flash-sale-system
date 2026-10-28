// INTEGRATION TEST: reconcile must notice when Redis drifts from Postgres, and rebuild it on request

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.ts";
import { createPool } from "../src/lib/db.ts";
import { createGate } from "../src/lib/gate.ts";
import { reconcileProduct } from "../src/lib/reconcile.ts";
import { createRedis } from "../src/lib/redis.ts";

describe("reconcileProduct", () => {
  const config = loadConfig();
  const pool = createPool(config.postgres);
  const redis = createRedis(config.redis);
  const gate = createGate(redis);
  let productId: number;

  // Postgres: stock 3, orders for alice (confirmed) and bob (confirmed), carol (failed)
  beforeEach(async () => {
    const { rows } = await pool.query(
      "INSERT INTO products (name, stock) VALUES ('test phone', 3) RETURNING id",
    );
    productId = rows[0].id;
    await pool.query(
      `INSERT INTO orders (user_id, product_id, status) VALUES
         ('alice', $1, 'confirmed'), ('bob', $1, 'confirmed'), ('carol', $1, 'failed')`,
      [productId],
    );
  });

  afterEach(async () => {
    await pool.query("DELETE FROM orders WHERE product_id = $1", [productId]);
    await pool.query("DELETE FROM products WHERE id = $1", [productId]);
    await gate.remove(productId);
  });

  afterAll(async () => {
    await pool.end();
    redis.disconnect();
  });

  it("reports a Redis that matches Postgres as consistent", async () => {
    await gate.reset(productId, 3, ["alice", "bob"]);

    const report = await reconcileProduct(pool, gate, productId);

    expect(report.consistent).toBe(true);
    expect(report.fixed).toBe(false);
  });

  it("reports a drifted Redis without changing it", async () => {
    await gate.reset(productId, 99);

    const report = await reconcileProduct(pool, gate, productId);

    expect(report).toMatchObject({
      consistent: false,
      fixed: false,
      postgresStock: 3,
      redisStock: 99,
      orderBuyers: 2,
      redisBuyers: 0,
    });
    expect(await gate.stockLeft(productId)).toBe(99);
  });

  it("rebuilds Redis from Postgres with --fix: stock and buyers", async () => {
    await gate.reset(productId, 99);

    const report = await reconcileProduct(pool, gate, productId, { fix: true });

    expect(report.fixed).toBe(true);
    expect(await gate.stockLeft(productId)).toBe(3);
    expect(await gate.reserve(productId, "alice")).toBe("already_reserved");
    expect(await gate.reserve(productId, "carol")).toBe("reserved"); // her order failed, she may try again
  });

  it("refuses a product that does not exist", async () => {
    await expect(reconcileProduct(pool, gate, 999999999)).rejects.toThrow("not found");
  });
});
