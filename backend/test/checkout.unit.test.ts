// UNIT TEST with a fake gate and fake queue: checks how the route turns gate answers and bad input into responses and messages

import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import type { ReserveResult } from "../src/lib/gate.ts";
import type { OrderMessage } from "../src/lib/queue.ts";

// a fake queue that just records what was published
function fakeQueue() {
  const published: OrderMessage[] = [];
  return {
    published,
    queue: {
      publish: async (order: OrderMessage) => {
        published.push(order);
      },
    },
  };
}

function appWhereGateSays(result: ReserveResult, queue = fakeQueue().queue) {
  return buildApp({
    checks: {},
    gate: { reserve: async () => result, release: async () => true },
    queue,
    orders: { statusOf: async () => "processing" as const },
  });
}

function checkout(
  app: ReturnType<typeof buildApp>,
  options: { headers?: Record<string, string>; payload?: unknown } = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/checkout",
    headers: options.headers ?? { "x-user-id": "u1" },
    payload: (options.payload ?? { productId: 1 }) as object,
  });
}

describe("POST /api/checkout (fake gate, fake queue)", () => {
  it.each([
    ["already_reserved", 409],
    ["sold_out", 410],
  ] as const)(
    "when the gate says %s, responds %i and queues nothing",
    async (result, code) => {
      const { queue, published } = fakeQueue();

      const response = await checkout(appWhereGateSays(result, queue));

      expect(response.statusCode).toBe(code);
      expect(response.json()).toEqual({ status: result });
      expect(published).toEqual([]);
    },
  );

  it("when the gate reserves, responds 202 with an order id and queues that order", async () => {
    const { queue, published } = fakeQueue();
    const app = appWhereGateSays("reserved", queue);

    const response = await checkout(app, {
      headers: { "x-user-id": "alice" },
      payload: { productId: 7 },
    });

    expect(response.statusCode).toBe(202);
    const { status, orderId } = response.json();
    expect(status).toBe("reserved");
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(published).toEqual([{ orderId, userId: "alice", productId: 7 }]);
  });

  it("gives every order its own id", async () => {
    const app = appWhereGateSays("reserved");

    const first = (await checkout(app)).json().orderId;
    const second = (await checkout(app)).json().orderId;

    expect(first).not.toBe(second);
  });

  it("passes the product and user to the gate", async () => {
    const calls: unknown[][] = [];
    const app = buildApp({
      checks: {},
      gate: {
        reserve: async (...args) => {
          calls.push(args);
          return "reserved";
        },
        release: async () => true,
      },
      queue: fakeQueue().queue,
      orders: { statusOf: async () => "processing" as const },
    });

    await checkout(app, {
      headers: { "x-user-id": "alice" },
      payload: { productId: 7 },
    });

    expect(calls).toEqual([[7, "alice"]]);
  });

  it("rejects a request without a user id", async () => {
    const { queue, published } = fakeQueue();

    const response = await checkout(appWhereGateSays("reserved", queue), {
      headers: {},
    });

    expect(response.statusCode).toBe(400);
    expect(published).toEqual([]);
  });

  it.each([
    {},
    { productId: "abc" },
    { productId: 0 },
    { productId: 1, extra: true },
  ])("rejects an invalid body %j", async (payload) => {
    const response = await checkout(appWhereGateSays("reserved"), { payload });

    expect(response.statusCode).toBe(400);
  });

  it("answers 503 and queues nothing when the gate is down", async () => {
    const { queue, published } = fakeQueue();
    const app = buildApp({
      checks: {},
      gate: {
        reserve: async () => {
          throw new Error("redis down");
        },
        release: async () => true,
      },
      queue,
      orders: { statusOf: async () => "processing" as const },
    });

    const response = await checkout(app);

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(published).toEqual([]);
  });

  it("answers 503 and gives the token back when the queue is down", async () => {
    const released: unknown[][] = [];
    const app = buildApp({
      checks: {},
      gate: {
        reserve: async () => "reserved" as const,
        release: async (...args) => {
          released.push(args);
          return true;
        },
      },
      queue: {
        publish: async () => {
          throw new Error("rabbitmq down");
        },
      },
      orders: { statusOf: async () => "processing" as const },
    });

    const response = await checkout(app, {
      headers: { "x-user-id": "alice" },
      payload: { productId: 7 },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
    expect(released).toEqual([[7, "alice"]]);
  });

  it("still answers 503 if giving the token back fails too", async () => {
    const app = buildApp({
      checks: {},
      gate: {
        reserve: async () => "reserved" as const,
        release: async () => {
          throw new Error("redis down");
        },
      },
      queue: {
        publish: async () => {
          throw new Error("rabbitmq down");
        },
      },
      orders: { statusOf: async () => "processing" as const },
    });

    expect((await checkout(app)).statusCode).toBe(503);
  });
});
