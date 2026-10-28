// INTEGRATION TEST of the whole journey: buy --> Redis --> queue --> worker --> Postgres --> status

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import { loadConfig } from "../src/lib/config.ts";
import { createPool } from "../src/lib/db.ts";
import { createGate } from "../src/lib/gate.ts";
import { createOrderStore } from "../src/lib/orders.ts";
import { createQueue, type OrderQueue } from "../src/lib/queue.ts";
import { createRedis } from "../src/lib/redis.ts";
import { startWorker } from "../src/worker/worker.ts";

const STOCK = 2;

describe("order flow, end to end", () => {
  const config = loadConfig();
  const pool = createPool(config.postgres);
  const redis = createRedis(config.redis);
  const gate = createGate(redis);
  let queue: OrderQueue;
  let app: ReturnType<typeof buildApp>;
  let productId: number;

  beforeEach(async () => {
    // a fresh product in Postgres; its new id also keeps Redis keys away from other tests
    const { rows } = await pool.query(
      "INSERT INTO products (name, stock) VALUES ('test phone', $1) RETURNING id",
      [STOCK],
    );
    productId = rows[0].id;
    await gate.reset(productId, STOCK);

    queue = await createQueue(config.rabbitmq, `test.flow.${randomUUID()}`);
    await startWorker(pool, queue);
    app = buildApp({
      checks: {},
      gate,
      queue,
      orders: createOrderStore(pool),
    });
  });

  afterEach(async () => {
    await app.close();
    await queue.destroy();
    await queue.close();
    await gate.remove(productId);
    await pool.query("DELETE FROM orders WHERE product_id = $1", [productId]);
    await pool.query("DELETE FROM products WHERE id = $1", [productId]);
  });

  afterAll(async () => {
    await pool.end();
    redis.disconnect();
  });

  const buy = (userId: string) =>
    app.inject({
      method: "POST",
      url: "/api/checkout",
      headers: { "x-user-id": userId },
      payload: { productId },
    });

  // the worker runs in the background: ask until the answer is final
  async function waitForFinalStatus(orderId: string): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const response = await app.inject({
        method: "GET",
        url: `/api/orders/${orderId}`,
      });
      if (response.json().status !== "processing") return response.json().status;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("order stayed in processing");
  }

  it("turns accepted purchases into confirmed orders and nothing more", async () => {
    const responses = await Promise.all(
      ["alice", "bob", "carol"].map((user) => buy(user)),
    );
    const accepted = responses.filter((r) => r.statusCode === 202);

    expect(accepted).toHaveLength(STOCK);
    expect(responses.filter((r) => r.statusCode === 410)).toHaveLength(1);

    for (const response of accepted) {
      expect(await waitForFinalStatus(response.json().orderId)).toBe("confirmed");
    }
    const { rows } = await pool.query(
      "SELECT stock FROM products WHERE id = $1",
      [productId],
    );
    expect(rows[0].stock).toBe(0);
  });
});
