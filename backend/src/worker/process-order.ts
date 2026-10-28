// Worker logic: turns one queued order into rows in Postgres, safe to run twice for the same message

import type { Pool } from "pg";
import type { OrderMessage } from "../lib/queue.ts";

export type ProcessResult = "confirmed" | "sold_out" | "duplicate";

export async function processOrder(
  pool: Pool,
  order: OrderMessage,
): Promise<ProcessResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // same order id or same buyer again --> unique rule --> nothing inserted
    const insert = await client.query(
      `INSERT INTO orders (id, user_id, product_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT DO NOTHING`,
      [order.orderId, order.userId, order.productId],
    );
    if (insert.rowCount === 0) {
      await client.query("ROLLBACK");
      return "duplicate";
    }

    // check and decrement in one step, as in buyAtomic
    const update = await client.query(
      "UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock > 0",
      [order.productId],
    );
    const confirmed = update.rowCount === 1;
    await client.query("UPDATE orders SET status = $1 WHERE id = $2", [
      confirmed ? "confirmed" : "failed",
      order.orderId,
    ]);

    await client.query("COMMIT");
    return confirmed ? "confirmed" : "sold_out";
  } catch (err) {
    await client.query("ROLLBACK");
    throw err; // the queue will retry the message
  } finally {
    client.release();
  }
}
