// INTEGRATION TEST: real Redis gate + real RabbitMQ behind the real route --> a flood of requests gets exactly the stock, and exactly those orders are queued

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import { loadConfig } from "../src/lib/config.ts";
import { createGate } from "../src/lib/gate.ts";
import {
  createQueue,
  type OrderMessage,
  type OrderQueue,
} from "../src/lib/queue.ts";
import { createRedis } from "../src/lib/redis.ts";

const PRODUCT_ID = 900003; // differs from the gate test's id: test files run in parallel
const STOCK = 100;
const BUYERS = 1000;

describe("POST /api/checkout (real Redis gate and queue)", () => {
  const config = loadConfig();
  const redis = createRedis(config.redis);
  const gate = createGate(redis);
  let queue: OrderQueue;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await gate.reset(PRODUCT_ID, STOCK);
    queue = await createQueue(config.rabbitmq, `test.checkout.${randomUUID()}`);
    app = buildApp({
      checks: {},
      gate,
      queue,
      orders: { statusOf: async () => "processing" },
    });
  });

  afterEach(async () => {
    await app.close();
    await queue.destroy();
    await queue.close();
    await gate.remove(PRODUCT_ID);
  });

  afterAll(() => {
    redis.disconnect();
  });

  it("accepts exactly the stock, queues exactly those orders, turns the rest away", async () => {
    const responses = await Promise.all(
      Array.from({ length: BUYERS }, (_, i) =>
        app.inject({
          method: "POST",
          url: "/api/checkout",
          headers: { "x-user-id": `user-${i}` },
          payload: { productId: PRODUCT_ID },
        }),
      ),
    );
    const count = (code: number) =>
      responses.filter((r) => r.statusCode === code).length;

    expect(count(202)).toBe(STOCK);
    expect(count(410)).toBe(BUYERS - STOCK);
    expect(await gate.stockLeft(PRODUCT_ID)).toBe(0);

    // read the queue back: the messages must match the 202 answers
    const queued: OrderMessage[] = [];
    const all = new Promise<void>((resolve) => {
      void queue.consume(async (order) => {
        queued.push(order);
        if (queued.length === STOCK) resolve();
      });
    });
    await all;
    await new Promise((resolve) => setTimeout(resolve, 200)); // would catch any extra message

    const accepted = responses
      .filter((r) => r.statusCode === 202)
      .map((r) => r.json().orderId);
    expect(queued).toHaveLength(STOCK);
    expect(queued.map((o) => o.orderId).sort()).toEqual(accepted.sort());
  });
});
