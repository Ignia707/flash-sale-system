// INTEGRATION TEST: each test runs inside a transaction --> roll back

import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.ts";
import { createPool } from "../src/lib/db.ts";

describe("database schema", () => {
  const pool = createPool(loadConfig().postgres);
  let client: PoolClient;

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
  });

  afterEach(async () => {
    await client.query("ROLLBACK"); // discard everything the test did
    client.release();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("refuses negative stock", async () => {
    await expect(
      client.query("INSERT INTO products (name, stock) VALUES ('phone', -1)"),
    ).rejects.toThrow("products_stock_check");
  });

  it("refuses a second order for the same user and product", async () => {
    const { rows } = await client.query(
      "INSERT INTO products (name, stock) VALUES ('phone', 5) RETURNING id",
    );
    const productId = rows[0].id;
    const insertOrder =
      "INSERT INTO orders (user_id, product_id) VALUES ('u1', $1)";

    await client.query(insertOrder, [productId]);

    await expect(client.query(insertOrder, [productId])).rejects.toThrow(
      "orders_user_id_product_id_key",
    );
  });
});
