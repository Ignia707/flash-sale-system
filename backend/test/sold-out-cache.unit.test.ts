// UNIT TEST with a fake gate and a fake clock: checks when the cache skips the gate and when it asks again

import { describe, expect, it } from "vitest";
import type { ReserveResult } from "../src/lib/gate.ts";
import { withSoldOutCache } from "../src/lib/sold-out-cache.ts";

function setup(answers: ReserveResult[]) {
  let calls = 0;
  let time = 0;
  const gate = {
    reserve: async (_productId: number, _userId: string) => {
      calls++;
      return answers.shift() ?? "sold_out";
    },
  };
  const cached = withSoldOutCache(gate, { ttlMs: 1000, now: () => time });
  return {
    cached,
    calls: () => calls,
    advance: (ms: number) => (time += ms),
  };
}

describe("withSoldOutCache", () => {
  it("passes answers through while stock is available", async () => {
    const { cached, calls } = setup(["reserved", "already_reserved", "reserved"]);

    expect(await cached.reserve(1, "a")).toBe("reserved");
    expect(await cached.reserve(1, "a")).toBe("already_reserved");
    expect(await cached.reserve(1, "b")).toBe("reserved");
    expect(calls()).toBe(3);
  });

  it("stops asking the gate once a product is sold out", async () => {
    const { cached, calls } = setup(["sold_out"]);

    for (let i = 0; i < 5; i++) {
      expect(await cached.reserve(1, `user-${i}`)).toBe("sold_out");
    }
    expect(calls()).toBe(1);
  });

  it("asks the gate again after the memory expires", async () => {
    const { cached, calls, advance } = setup(["sold_out", "reserved"]);

    await cached.reserve(1, "a");
    advance(1001);

    expect(await cached.reserve(1, "b")).toBe("reserved");
    expect(calls()).toBe(2);
  });

  it("remembers each product separately", async () => {
    const { cached, calls } = setup(["sold_out", "reserved"]);

    await cached.reserve(1, "a");

    expect(await cached.reserve(2, "a")).toBe("reserved");
    expect(calls()).toBe(2);
  });
});
