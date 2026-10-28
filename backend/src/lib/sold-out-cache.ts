// Per-server memory of sold-out products: repeat buyers are refused without calling Redis
// The memory expires quickly because stock may come back (failed orders give tokens back)

import type { ReserveResult } from "./gate.ts";

interface Reserver {
  reserve(productId: number, userId: string): Promise<ReserveResult>;
}

interface Options {
  ttlMs?: number;
  now?: () => number; // defaults to the real Date.now, but tests can pass a fake clock
}

export function withSoldOutCache<G extends Reserver>(
  gate: G,
  { ttlMs = 1500, now = Date.now }: Options = {},
): G {
  const soldOutUntil = new Map<number, number>();

  return {
    ...gate,
    async reserve(productId: number, userId: string): Promise<ReserveResult> {
      const until = soldOutUntil.get(productId);
      if (until !== undefined && now() < until) return "sold_out";

      const result = await gate.reserve(productId, userId);
      if (result === "sold_out") soldOutUntil.set(productId, now() + ttlMs);
      return result;
    },
  };
}
