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

// Postgres is the source of truth --> Redis tokens are rebuilt from it
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

  await gate.reset(productId, rows[0].stock);
  return rows[0].stock;
}
