// Connects the queue to the database: every queued order goes through processOrder

import type { Pool } from "pg";
import type { OrderMessage, OrderQueue } from "../lib/queue.ts";
import { processOrder, type ProcessResult } from "./process-order.ts";

export async function startWorker(
  pool: Pool,
  queue: Pick<OrderQueue, "consume">,
  onProcessed: (order: OrderMessage, result: ProcessResult) => void = () => {},
): Promise<void> {
  await queue.consume(async (order) => {
    const result = await processOrder(pool, order);
    onProcessed(order, result);
  });
}
