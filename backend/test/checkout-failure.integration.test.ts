// INTEGRATION TEST: real Redis gate + a queue that is down --> every token must come back

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import { loadConfig } from "../src/lib/config.ts";
import { createGate } from "../src/lib/gate.ts";
import { createRedis } from "../src/lib/redis.ts";
import { TEST_SECRET } from "./helpers.ts";

const PRODUCT_ID = 900004; // own id: test files run in parallel
const STOCK = 5;

describe("POST /api/checkout when the queue is down (real Redis gate)", () => {
  const redis = createRedis(loadConfig().redis);
  const gate = createGate(redis);
  const app = buildApp({
    jwtSecret: TEST_SECRET,
    checks: {},
    gate,
    queue: {
      publish: async () => {
        throw new Error("rabbitmq down");
      },
    },
    orders: { statusOf: async () => "processing" },
  });

  beforeEach(async () => {
    await gate.reset(PRODUCT_ID, STOCK);
  });

  afterEach(async () => {
    await gate.remove(PRODUCT_ID);
  });

  afterAll(async () => {
    await app.close();
    redis.disconnect();
  });

  it("answers 503 and leaves the stock untouched", async () => {
    await app.ready();
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        app.inject({
          method: "POST",
          url: "/api/checkout",
          headers: { authorization: `Bearer ${app.jwt.sign({ sub: `user-${i}` })}` },
          payload: { productId: PRODUCT_ID },
        }),
      ),
    );

    // sold_out (410) is possible while tokens are briefly held, but nothing may be accepted
    expect(responses.filter((r) => r.statusCode === 202)).toHaveLength(0);
    expect(await gate.stockLeft(PRODUCT_ID)).toBe(STOCK);
    expect(await gate.buyerCount(PRODUCT_ID)).toBe(0);
  });
});
