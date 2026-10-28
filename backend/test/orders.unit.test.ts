// UNIT TEST with a fake order store: checks the route's answers, id validation and who may ask

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import type { OrderStatus } from "../src/lib/orders.ts";
import { asGuest, TEST_SECRET } from "./helpers.ts";

function appWhereOrderIs(status: OrderStatus, asked: string[][] = []) {
  return buildApp({
    jwtSecret: TEST_SECRET,
    checks: {},
    gate: { reserve: async () => "reserved" as const, release: async () => true },
    queue: { publish: async () => {} },
    orders: {
      statusOf: async (id, userId) => {
        asked.push([id, userId]);
        return status;
      },
    },
  });
}

describe("GET /api/orders/:id (fake order store)", () => {
  it.each(["processing", "confirmed", "failed"] as const)(
    "reports an order that is %s",
    async (status) => {
      const id = randomUUID();
      const app = appWhereOrderIs(status);

      const response = await app.inject({
        method: "GET",
        url: `/api/orders/${id}`,
        headers: await asGuest(app, "alice"),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ orderId: id, status });
    },
  );

  it("asks the store about the caller's own orders only", async () => {
    const id = randomUUID();
    const asked: string[][] = [];
    const app = appWhereOrderIs("confirmed", asked);

    await app.inject({
      method: "GET",
      url: `/api/orders/${id}`,
      headers: await asGuest(app, "alice"),
    });

    expect(asked).toEqual([[id, "alice"]]);
  });

  it("rejects a request without a token", async () => {
    const asked: string[][] = [];

    const response = await appWhereOrderIs("confirmed", asked).inject({
      method: "GET",
      url: `/api/orders/${randomUUID()}`,
    });

    expect(response.statusCode).toBe(401);
    expect(asked).toEqual([]);
  });

  it.each(["abc", "123", "not-a-uuid-at-all"])(
    "rejects the malformed id %s without asking the store",
    async (badId) => {
      const asked: string[][] = [];
      const app = appWhereOrderIs("confirmed", asked);

      const response = await app.inject({
        method: "GET",
        url: `/api/orders/${badId}`,
        headers: await asGuest(app, "alice"),
      });

      expect(response.statusCode).toBe(400);
      expect(asked).toEqual([]);
    },
  );
});
