import { describe, expect, it } from "vitest";
import { backoffDelay } from "../src/backoff.ts";

describe("backoffDelay", () => {
  const top = { random: () => 1 }; // the longest wait the jitter allows
  const bottom = { random: () => 0 }; // the shortest

  it("grows after every failure", () => {
    expect(backoffDelay(0, top)).toBeLessThan(backoffDelay(2, top));
    expect(backoffDelay(2, top)).toBeLessThan(backoffDelay(4, top));
  });

  it("never exceeds the maximum", () => {
    expect(backoffDelay(50, { ...top, maxMs: 5000 })).toBe(5000);
  });

  it("waits between half and the full ceiling, so browsers don't retry in step", () => {
    expect(backoffDelay(0, { ...bottom, baseMs: 500 })).toBe(250);
    expect(backoffDelay(0, { ...top, baseMs: 500 })).toBe(500);
  });
});
