// INTEGRATION TEST: real RabbitMQ + real Postgres --> published orders end up in the database

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.ts";
import { createPool } from "../src/lib/db.ts";
import { createQueue, type OrderQueue } from "../src/lib/queue.ts";
import { startWorker } from "../src/worker/worker.ts";

describe("worker", () => {
  const config = loadConfig();
  const pool = createPool(config.postgres);
  let queue: OrderQueue;
  let productId: number;

  beforeEach(async () => {
    const { rows } = await pool.query(
      "INSERT INTO products (name, stock) VALUES ('test phone', 10) RETURNING id",
    );
    productId = rows[0].id;
    queue = await createQueue(config.rabbitmq, `test.worker.${randomUUID()}`);
  });

  afterEach(async () => {
    await queue.destroy();
    await queue.close();
    await pool.query("DELETE FROM orders WHERE product_id = $1", [productId]);
    await pool.query("DELETE FROM products WHERE id = $1", [productId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("saves every queued order and counts down the stock", async () => {
    const COUNT = 8;
    let processed = 0;
    const done = new Promise<void>((resolve) => {
      void startWorker(pool, queue, () => {
        if (++processed === COUNT) resolve();
      });
    });

    for (let i = 0; i < COUNT; i++) {
      await queue.publish({
        orderId: randomUUID(),
        userId: `user-${i}`,
        productId,
      });
    }
    await done;

    const orders = await pool.query(
      "SELECT count(*)::int AS n FROM orders WHERE product_id = $1 AND status = 'confirmed'",
      [productId],
    );
    const product = await pool.query(
      "SELECT stock FROM products WHERE id = $1",
      [productId],
    );
    expect(orders.rows[0].n).toBe(COUNT);
    expect(product.rows[0].stock).toBe(10 - COUNT);
  });
});
