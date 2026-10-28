// UNIT TEST with a fake gate and fake queue: checks how the route turns tokens, gate answers and bad input into responses and messages

import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import type { ReserveResult } from "../src/lib/gate.ts";
import type { OrderMessage } from "../src/lib/queue.ts";
import { asGuest, TEST_SECRET } from "./helpers.ts";

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

const orders = { statusOf: async () => "processing" as const };

function appWith(
  gate: Parameters<typeof buildApp>[0]["gate"],
  extra: Partial<Parameters<typeof buildApp>[0]> = {},
) {
  return buildApp({
    jwtSecret: TEST_SECRET,
    checks: {},
    gate,
    queue: fakeQueue().queue,
    orders,
    ...extra,
  });
}

const gateSaying = (result: ReserveResult) => ({
  reserve: async () => result,
  release: async () => true,
});

async function checkout(
  app: ReturnType<typeof buildApp>,
  options: { user?: string | null; payload?: unknown } = {},
) {
  const { user = "u1", payload = { productId: 1 } } = options;
  return app.inject({
    method: "POST",
    url: "/api/checkout",
    headers: user === null ? {} : await asGuest(app, user),
    payload: payload as object,
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

      const response = await checkout(appWith(gateSaying(result), { queue }));

      expect(response.statusCode).toBe(code);
      expect(response.json()).toEqual({ status: result });
      expect(published).toEqual([]);
    },
  );

  it("when the gate reserves, responds 202 with an order id and queues that order", async () => {
    const { queue, published } = fakeQueue();
    const app = appWith(gateSaying("reserved"), { queue });

    const response = await checkout(app, {
      user: "alice",
      payload: { productId: 7 },
    });

    expect(response.statusCode).toBe(202);
    const { status, orderId } = response.json();
    expect(status).toBe("reserved");
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(published).toEqual([{ orderId, userId: "alice", productId: 7 }]);
  });

  it("gives every order its own id", async () => {
    const app = appWith(gateSaying("reserved"));

    const first = (await checkout(app)).json().orderId;
    const second = (await checkout(app)).json().orderId;

    expect(first).not.toBe(second);
  });

  it("takes the user from the token and the product from the body", async () => {
    const calls: unknown[][] = [];
    const app = appWith({
      reserve: async (...args) => {
        calls.push(args);
        return "reserved";
      },
      release: async () => true,
    });

    await checkout(app, { user: "alice", payload: { productId: 7 } });

    expect(calls).toEqual([[7, "alice"]]);
  });

  it("ignores a user id the client tries to type in", async () => {
    const calls: unknown[][] = [];
    const app = appWith({
      reserve: async (...args) => {
        calls.push(args);
        return "reserved";
      },
      release: async () => true,
    });

    await app.inject({
      method: "POST",
      url: "/api/checkout",
      headers: { ...(await asGuest(app, "alice")), "x-user-id": "mallory" },
      payload: { productId: 7 },
    });

    expect(calls).toEqual([[7, "alice"]]);
  });

  describe("identity", () => {
    it("rejects a request without a token", async () => {
      const { queue, published } = fakeQueue();

      const response = await checkout(appWith(gateSaying("reserved"), { queue }), {
        user: null,
      });

      expect(response.statusCode).toBe(401);
      expect(published).toEqual([]);
    });

    it("rejects a token signed with another secret", async () => {
      const forger = appWith(gateSaying("reserved"), { jwtSecret: "another-secret-16-chars!!" });
      const target = appWith(gateSaying("reserved"));
      await forger.ready();

      const response = await target.inject({
        method: "POST",
        url: "/api/checkout",
        headers: { authorization: `Bearer ${forger.jwt.sign({ sub: "mallory" })}` },
        payload: { productId: 1 },
      });

      expect(response.statusCode).toBe(401);
    });

    it("rejects an expired token", async () => {
      const app = appWith(gateSaying("reserved"));
      await app.ready();
      const token = app.jwt.sign({ sub: "alice" }, { expiresIn: 1 });
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const response = await app.inject({
        method: "POST",
        url: "/api/checkout",
        headers: { authorization: `Bearer ${token}` },
        payload: { productId: 1 },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("sale window", () => {
    const opensAt = new Date("2026-11-01T10:00:00Z");

    it("refuses before the sale starts, without touching the gate", async () => {
      const calls: unknown[][] = [];
      const app = appWith(
        {
          reserve: async (...args) => {
            calls.push(args);
            return "reserved";
          },
          release: async () => true,
        },
        { saleStartsAt: opensAt, now: () => opensAt.getTime() - 1 },
      );

      const response = await checkout(app);

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        status: "not_started",
        startsAt: "2026-11-01T10:00:00.000Z",
      });
      expect(calls).toEqual([]);
    });

    it("accepts from the very moment the sale starts", async () => {
      const app = appWith(gateSaying("reserved"), {
        saleStartsAt: opensAt,
        now: () => opensAt.getTime(),
      });

      expect((await checkout(app)).statusCode).toBe(202);
    });
  });

  it("rejects an invalid body", async () => {
    for (const payload of [{}, { productId: "abc" }, { productId: 0 }, { productId: 1, extra: true }]) {
      const response = await checkout(appWith(gateSaying("reserved")), { payload });

      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("answers 503 and queues nothing when the gate is down", async () => {
    const { queue, published } = fakeQueue();
    const app = appWith(
      {
        reserve: async () => {
          throw new Error("redis down");
        },
        release: async () => true,
      },
      { queue },
    );

    const response = await checkout(app);

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(published).toEqual([]);
  });

  it("answers 503 and gives the token back when the queue is down", async () => {
    const released: unknown[][] = [];
    const app = appWith(
      {
        reserve: async () => "reserved" as const,
        release: async (...args) => {
          released.push(args);
          return true;
        },
      },
      {
        queue: {
          publish: async () => {
            throw new Error("rabbitmq down");
          },
        },
      },
    );

    const response = await checkout(app, { user: "alice", payload: { productId: 7 } });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
    expect(released).toEqual([[7, "alice"]]);
  });

  it("still answers 503 if giving the token back fails too", async () => {
    const app = appWith(
      {
        reserve: async () => "reserved" as const,
        release: async () => {
          throw new Error("redis down");
        },
      },
      {
        queue: {
          publish: async () => {
            throw new Error("rabbitmq down");
          },
        },
      },
    );

    expect((await checkout(app)).statusCode).toBe(503);
  });
});
