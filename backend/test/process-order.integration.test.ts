// INTEGRATION TEST: real Postgres --> one order message becomes one order and one unit of stock, even if delivered twice

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.ts";
import { createPool } from "../src/lib/db.ts";
import type { OrderMessage } from "../src/lib/queue.ts";
import { processOrder } from "../src/worker/process-order.ts";

describe("processOrder", () => {
  const pool = createPool(loadConfig().postgres);
  let productId: number;

  // own product per test, so test files don't clash
  async function createProduct(stock: number) {
    const { rows } = await pool.query(
      "INSERT INTO products (name, stock) VALUES ('test phone', $1) RETURNING id",
      [stock],
    );
    productId = rows[0].id;
  }

  const order = (userId: string): OrderMessage => ({
    orderId: randomUUID(),
    userId,
    productId,
  });

  async function stockLeft(): Promise<number> {
    const { rows } = await pool.query(
      "SELECT stock FROM products WHERE id = $1",
      [productId],
    );
    return rows[0].stock;
  }

  async function ordersWith(status: string): Promise<number> {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM orders WHERE product_id = $1 AND status = $2",
      [productId, status],
    );
    return rows[0].n;
  }

  beforeEach(async () => {
    await createProduct(5);
  });

  afterEach(async () => {
    await pool.query("DELETE FROM orders WHERE product_id = $1", [productId]);
    await pool.query("DELETE FROM products WHERE id = $1", [productId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("confirms an order and takes one unit of stock", async () => {
    const message = order("alice");

    expect(await processOrder(pool, message)).toBe("confirmed");

    expect(await stockLeft()).toBe(4);
    const { rows } = await pool.query(
      "SELECT status FROM orders WHERE id = $1",
      [message.orderId],
    );
    expect(rows).toEqual([{ status: "confirmed" }]);
  });

  it("ignores the same message delivered twice", async () => {
    const message = order("alice");

    await processOrder(pool, message);
    expect(await processOrder(pool, message)).toBe("duplicate");

    expect(await stockLeft()).toBe(4);
    expect(await ordersWith("confirmed")).toBe(1);
  });

  it("ignores a second order from the same buyer", async () => {
    await processOrder(pool, order("alice"));

    expect(await processOrder(pool, order("alice"))).toBe("duplicate");

    expect(await stockLeft()).toBe(4);
    expect(await ordersWith("confirmed")).toBe(1);
  });

  it("marks the order failed when the database has no stock left", async () => {
    await pool.query("UPDATE products SET stock = 0 WHERE id = $1", [productId]);

    expect(await processOrder(pool, order("alice"))).toBe("sold_out");

    expect(await stockLeft()).toBe(0);
    expect(await ordersWith("failed")).toBe(1);
    expect(await ordersWith("confirmed")).toBe(0);
  });

  it("never confirms more than the stock when many orders arrive at once", async () => {
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        processOrder(pool, order(`user-${i}`)),
      ),
    );

    expect(results.filter((r) => r === "confirmed")).toHaveLength(5);
    expect(results.filter((r) => r === "sold_out")).toHaveLength(195);
    expect(await stockLeft()).toBe(0);
    expect(await ordersWith("confirmed")).toBe(5);
  });
});
