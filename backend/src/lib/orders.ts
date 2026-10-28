// Order lookup for customers: what happened to the order I was given?

import type { Pool } from "pg";

// "processing" = the worker has not saved it yet (or the id was never issued)
export type OrderStatus = "processing" | "confirmed" | "failed";

export type OrderStore = ReturnType<typeof createOrderStore>;

export function createOrderStore(pool: Pool) {
  return {
    async statusOf(orderId: string, userId: string): Promise<OrderStatus> {
      const { rows } = await pool.query(
        "SELECT status FROM orders WHERE id = $1 AND user_id = $2",
        [orderId, userId],
      );
      const status = rows[0]?.status;
      return status === "confirmed" || status === "failed"
        ? status
        : "processing";
    },
  };
}
