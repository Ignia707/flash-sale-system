// INTEGRATION TEST: real Redis gate behind the real route --> a flood of requests must get exactly the stock

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import { loadConfig } from "../src/lib/config.ts";
import { createGate } from "../src/lib/gate.ts";
import { createRedis } from "../src/lib/redis.ts";

const PRODUCT_ID = 900003; // differs from the gate test's id: test files run in parallel
const STOCK = 100;
const BUYERS = 1000;

describe("POST /api/checkout (real Redis gate)", () => {
  const redis = createRedis(loadConfig().redis);
  const gate = createGate(redis);
  const app = buildApp({ checks: {}, gate });

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

  it("accepts exactly the stock and turns the rest away", async () => {
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
  });
});
