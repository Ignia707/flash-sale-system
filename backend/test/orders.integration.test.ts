// INTEGRATION TEST: real Postgres --> the store reports what is really saved

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.ts";
import { createPool } from "../src/lib/db.ts";
import { createOrderStore } from "../src/lib/orders.ts";

describe("order store", () => {
  const pool = createPool(loadConfig().postgres);
  const store = createOrderStore(pool);
  let productId: number;

  // own product per test, so test files don't clash
  beforeEach(async () => {
    const { rows } = await pool.query(
      "INSERT INTO products (name, stock) VALUES ('test phone', 5) RETURNING id",
    );
    productId = rows[0].id;
  });

  afterEach(async () => {
    await pool.query("DELETE FROM orders WHERE product_id = $1", [productId]);
    await pool.query("DELETE FROM products WHERE id = $1", [productId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function saveOrder(status: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO orders (id, user_id, product_id, status) VALUES ($1, 'u1', $2, $3)",
      [id, productId, status],
    );
    return id;
  }

  it.each(["confirmed", "failed"] as const)(
    "reports a saved %s order",
    async (status) => {
      expect(await store.statusOf(await saveOrder(status))).toBe(status);
    },
  );

  it("reports a pending row as still processing", async () => {
    expect(await store.statusOf(await saveOrder("pending"))).toBe("processing");
  });

  it("reports an id it has never seen as processing", async () => {
    expect(await store.statusOf(randomUUID())).toBe("processing");
  });
});
