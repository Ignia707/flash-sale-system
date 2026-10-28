// INTEGRATION TEST: the Redis gate must hand out exactly the stock, however many requests race.

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.ts";
import { createGate } from "../src/lib/gate.ts";
import { createRedis } from "../src/lib/redis.ts";

const PRODUCT_ID = 900001; // far from real ids, so tests never touch real keys
const STOCK = 500;
const BUYERS = 2000;

describe("Redis gate", () => {
  const redis = createRedis(loadConfig().redis);
  const gate = createGate(redis);

  beforeEach(async () => {
    await gate.reset(PRODUCT_ID, STOCK);
  });

  afterEach(async () => {
    await gate.remove(PRODUCT_ID);
  });

  afterAll(() => {
    redis.disconnect();
  });

  it("hands out exactly the stock when many buyers race", async () => {
    const results = await Promise.all(
      Array.from({ length: BUYERS }, (_, i) =>
        gate.reserve(PRODUCT_ID, `user-${i}`),
      ),
    );
    const count = (r: string) => results.filter((x) => x === r).length;

    expect(count("reserved")).toBe(STOCK);
    expect(count("sold_out")).toBe(BUYERS - STOCK);
    expect(await gate.stockLeft(PRODUCT_ID)).toBe(0);
    expect(await gate.buyerCount(PRODUCT_ID)).toBe(STOCK);
  });

  it("lets one user reserve only once, without losing stock", async () => {
    expect(await gate.reserve(PRODUCT_ID, "same-user")).toBe("reserved");
    expect(await gate.reserve(PRODUCT_ID, "same-user")).toBe("already_reserved");

    expect(await gate.stockLeft(PRODUCT_ID)).toBe(STOCK - 1);
  });

  it("refuses everyone when the stock key does not exist", async () => {
    await gate.remove(PRODUCT_ID);

    expect(await gate.reserve(PRODUCT_ID, "user-1")).toBe("sold_out");
  });

  it("takes a token back so someone else can use it", async () => {
    await gate.reserve(PRODUCT_ID, "alice");

    expect(await gate.release(PRODUCT_ID, "alice")).toBe(true);

    expect(await gate.stockLeft(PRODUCT_ID)).toBe(STOCK);
    expect(await gate.buyerCount(PRODUCT_ID)).toBe(0);
    expect(await gate.reserve(PRODUCT_ID, "alice")).toBe("reserved"); // may try again
  });

  it("gives nothing back to a user who holds no token", async () => {
    expect(await gate.release(PRODUCT_ID, "stranger")).toBe(false);

    expect(await gate.stockLeft(PRODUCT_ID)).toBe(STOCK); // stock must not grow
  });
});
