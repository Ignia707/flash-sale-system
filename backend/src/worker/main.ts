// STARTS the worker: pnpm worker

import { loadConfig } from "../lib/config.ts";
import { createPool } from "../lib/db.ts";
import { createQueue, ORDER_QUEUE } from "../lib/queue.ts";
import { startWorker } from "./worker.ts";

const config = loadConfig();
const pool = createPool(config.postgres);
// a database outage of about 20 s is waited out; after that orders are parked (see pnpm replay-dead)
const queue = await createQueue(config.rabbitmq, ORDER_QUEUE, {
  maxAttempts: 8,
  retryDelayMs: 3000,
});

await startWorker(pool, queue, (order, result) => {
  console.log(`order ${order.orderId} (${order.userId}): ${result}`);
});
console.log("worker waiting for orders");

// unacknowledged messages go back to the queue, so stopping is safe
async function shutdown() {
  await queue.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
