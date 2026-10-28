// INTEGRATION TEST: the atomic buy must sell exactly the stock, regardless of many buyers race

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.ts";
import { createPool } from "../src/lib/db.ts";
import { buyAtomic } from "../src/lib/inventory.ts";

const STOCK = 50;
const BUYERS = 500;

describe("buyAtomic", () => {
  const pool = createPool(loadConfig().postgres);
  let productId: number;

  // each test gets its own product - avoid conflict
  beforeEach(async () => {
    const { rows } = await pool.query(
      "INSERT INTO products (name, stock) VALUES ('test phone', $1) RETURNING id",
      [STOCK],
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

  async function stockLeft(): Promise<number> {
    const { rows } = await pool.query(
      "SELECT stock FROM products WHERE id = $1",
      [productId],
    );
    return rows[0].stock;
  }

  async function orderCount(): Promise<number> {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM orders WHERE product_id = $1",
      [productId],
    );
    return rows[0].n;
  }

  it("sells exactly the stock when many buyers race", async () => {
    const results = await Promise.all(
      Array.from({ length: BUYERS }, (_, i) =>
        buyAtomic(pool, `user-${i}`, productId),
      ),
    );
    const count = (r: string) => results.filter((x) => x === r).length;

    expect(count("confirmed")).toBe(STOCK);
    expect(count("sold_out")).toBe(BUYERS - STOCK);
    expect(await stockLeft()).toBe(0);
    expect(await orderCount()).toBe(STOCK);
  });

  it("lets one user buy only once, without losing stock", async () => {
    expect(await buyAtomic(pool, "same-user", productId)).toBe("confirmed");
    expect(await buyAtomic(pool, "same-user", productId)).toBe(
      "already_bought",
    );

    expect(await stockLeft()).toBe(STOCK - 1); // the failed attempt gave its unit back
  });
});
