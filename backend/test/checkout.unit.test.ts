// UNIT TEST with a fake gate: checks how the route turns gate answers and bad input into responses

import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import type { ReserveResult } from "../src/lib/gate.ts";

function appWhereGateSays(result: ReserveResult) {
  return buildApp({
    checks: {},
    gate: { reserve: async () => result },
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

describe("POST /api/checkout (fake gate)", () => {
  it.each([
    ["reserved", 202],
    ["already_reserved", 409],
    ["sold_out", 410],
  ] as const)("when the gate says %s, responds %i", async (result, code) => {
    const response = await checkout(appWhereGateSays(result));

    expect(response.statusCode).toBe(code);
    expect(response.json()).toEqual({ status: result });
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
      },
    });

    await checkout(app, { headers: { "x-user-id": "alice" }, payload: { productId: 7 } });

    expect(calls).toEqual([[7, "alice"]]);
  });

  it("rejects a request without a user id", async () => {
    const response = await checkout(appWhereGateSays("reserved"), { headers: {} });

    expect(response.statusCode).toBe(400);
  });

  it.each([{}, { productId: "abc" }, { productId: 0 }, { productId: 1, extra: true }])(
    "rejects an invalid body %j",
    async (payload) => {
      const response = await checkout(appWhereGateSays("reserved"), { payload });

      expect(response.statusCode).toBe(400);
    },
  );
});
