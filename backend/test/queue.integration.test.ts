// INTEGRATION TEST: real RabbitMQ --> messages arrive intact, none are lost, failed ones are retried

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/lib/config.ts";
import {
  createQueue,
  type OrderMessage,
  type OrderQueue,
} from "../src/lib/queue.ts";

const order = (i: number): OrderMessage => ({
  orderId: `order-${i}`,
  userId: `user-${i}`,
  productId: 1,
});

describe("order queue", () => {
  let queue: OrderQueue;

  // one queue per test (random name) --> avoid clash with the real queue or other tests
  beforeEach(async () => {
    queue = await createQueue(
      loadConfig().rabbitmq,
      `test.orders.${randomUUID()}`,
      { maxAttempts: 3, retryDelayMs: 0 },
    );
  });

  afterEach(async () => {
    await queue.destroy();
    await queue.close();
  });

  it("delivers a published order unchanged", async () => {
    const received = new Promise<OrderMessage>((resolve) => {
      void queue.consume(async (o) => resolve(o));
    });

    await queue.publish(order(1));

    expect(await received).toEqual(order(1));
  });

  it("delivers every message once, even in a burst", async () => {
    const COUNT = 200;
    const seen: string[] = [];
    const done = new Promise<void>((resolve) => {
      void queue.consume(async (o) => {
        seen.push(o.orderId);
        if (seen.length === COUNT) resolve();
      });
    });

    await Promise.all(
      Array.from({ length: COUNT }, (_, i) => queue.publish(order(i))),
    );
    await done;

    expect(new Set(seen).size).toBe(COUNT);
  });

  it("retries a message when the handler fails", async () => {
    let attempts = 0;
    const done = new Promise<void>((resolve) => {
      void queue.consume(async () => {
        attempts++;
        if (attempts === 1) throw new Error("db hiccup");
        resolve();
      });
    });

    await queue.publish(order(1));
    await done;

    expect(attempts).toBe(2);
  });

  it("parks a message that keeps failing in the dead-letter queue", async () => {
    let attempts = 0;
    await queue.consume(async () => {
      attempts++;
      throw new Error("always fails");
    });

    await queue.publish(order(1));

    await vi.waitFor(async () => expect(await queue.deadDepth()).toBe(1));
    expect(attempts).toBe(3); // maxAttempts, then no more retries
    expect(await queue.depth()).toBe(0);
  });
});
