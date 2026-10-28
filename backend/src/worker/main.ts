// STARTS the worker: pnpm worker

import { loadConfig } from "../lib/config.ts";
import { createPool } from "../lib/db.ts";
import { createQueue } from "../lib/queue.ts";
import { startWorker } from "./worker.ts";

const config = loadConfig();
const pool = createPool(config.postgres);
const queue = await createQueue(config.rabbitmq);

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
