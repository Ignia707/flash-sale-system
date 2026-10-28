// Seeding helpers: create a sale in Postgres, and copy Postgres stock into the Redis gate

import type { Pool } from "pg";
import type { Gate } from "./gate.ts";

// DEV ONLY: wipes everything and creates one product (id 1) with the given stock
export async function startFreshSale(
  pool: Pool,
  stock: number,
): Promise<number> {
  await pool.query("TRUNCATE orders, products RESTART IDENTITY");
  const { rows } = await pool.query(
    "INSERT INTO products (name, stock) VALUES ('phone', $1) RETURNING id",
    [stock],
  );
  return rows[0].id;
}

// Postgres is the source of truth --> Redis tokens AND buyers are rebuilt from it.
// Run it only when the queue is empty (queued orders are not in Postgres yet).
export async function copyStockToRedis(
  pool: Pool,
  gate: Pick<Gate, "reset">,
  productId: number,
): Promise<number> {
  const { rows } = await pool.query(
    "SELECT stock FROM products WHERE id = $1",
    [productId],
  );
  if (rows.length === 0) throw new Error(`Product ${productId} not found`);

  // buyers who already hold an order must not get a second token (failed orders hold none)
  const buyers = await pool.query(
    "SELECT user_id FROM orders WHERE product_id = $1 AND status <> 'failed'",
    [productId],
  );
  await gate.reset(
    productId,
    rows[0].stock,
    buyers.rows.map((r) => r.user_id),
  );
  return rows[0].stock;
}
