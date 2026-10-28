// Reconcile: compares the Redis gate with Postgres (the truth) and can rebuild Redis from it.
// Only meaningful when the queue is empty, i.e. no order is in flight.

import type { Pool } from "pg";
import type { Gate } from "./gate.ts";

export interface ReconcileReport {
  productId: number;
  postgresStock: number;
  redisStock: number;
  orderBuyers: number;
  redisBuyers: number;
  consistent: boolean;
  fixed: boolean;
}

export async function reconcileProduct(
  pool: Pool,
  gate: Pick<Gate, "stockLeft" | "buyerCount" | "reset">,
  productId: number,
  { fix = false } = {},
): Promise<ReconcileReport> {
  const product = await pool.query("SELECT stock FROM products WHERE id = $1", [
    productId,
  ]);
  if (product.rows.length === 0) throw new Error(`Product ${productId} not found`);

  // failed orders hold no phone, so those buyers may try again
  const buyers = await pool.query(
    "SELECT user_id FROM orders WHERE product_id = $1 AND status <> 'failed'",
    [productId],
  );
  const orderBuyers: string[] = buyers.rows.map((r) => r.user_id);

  const postgresStock: number = product.rows[0].stock;
  const redisStock = await gate.stockLeft(productId);
  const redisBuyers = await gate.buyerCount(productId);
  const consistent =
    redisStock === postgresStock && redisBuyers === orderBuyers.length;

  let fixed = false;
  if (!consistent && fix) {
    await gate.reset(productId, postgresStock, orderBuyers);
    fixed = true;
  }

  return {
    productId,
    postgresStock,
    redisStock,
    orderBuyers: orderBuyers.length,
    redisBuyers,
    consistent,
    fixed,
  };
}
