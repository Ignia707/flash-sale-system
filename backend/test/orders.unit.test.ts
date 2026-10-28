// UNIT TEST with a fake order store: checks the route's answers and its id validation

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import type { OrderStatus } from "../src/lib/orders.ts";

function appWhereOrderIs(status: OrderStatus, asked: string[] = []) {
  return buildApp({
    checks: {},
    gate: { reserve: async () => "reserved" as const },
    queue: { publish: async () => {} },
    orders: {
      statusOf: async (id) => {
        asked.push(id);
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

      const response = await appWhereOrderIs(status).inject({
        method: "GET",
        url: `/api/orders/${id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ orderId: id, status });
    },
  );

  it.each(["abc", "123", "not-a-uuid-at-all"])(
    "rejects the malformed id %s without asking the store",
    async (badId) => {
      const asked: string[] = [];

      const response = await appWhereOrderIs("confirmed", asked).inject({
        method: "GET",
        url: `/api/orders/${badId}`,
      });

      expect(response.statusCode).toBe(400);
      expect(asked).toEqual([]);
    },
  );
});
