// Redis inventory gate: hands out stock "tokens" atomically, refusing everyone else in memory.

import type { Redis } from "ioredis";

export type ReserveResult = "reserved" | "sold_out" | "already_reserved";

// Runs inside Redis as ONE indivisible step
// Returns >= 0 on success, -1 sold out, -2 duplicate
const RESERVE_LUA = `
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
  return -2
end
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
if stock <= 0 then
  return -1
end
redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[2], ARGV[1])
return stock - 1
`;

// decalare the command to be registerd
declare module "ioredis" {
  interface RedisCommander<Context> {
    reserveStock(
      stockKey: string,
      buyersKey: string,
      userId: string,
    ): Promise<number>;
  }
}

const stockKey = (productId: number) => `stock:${productId}`;
const buyersKey = (productId: number) => `buyers:${productId}`;

export function createGate(redis: Redis) {
  // the script is sent to Redis once ---> called by its hash
  redis.defineCommand("reserveStock", { numberOfKeys: 2, lua: RESERVE_LUA });

  return {
    async reserve(productId: number, userId: string): Promise<ReserveResult> {
      const code = await redis.reserveStock(
        stockKey(productId),
        buyersKey(productId),
        userId,
      );
      if (code === -2) return "already_reserved";
      if (code === -1) return "sold_out";
      return "reserved";
    },

    // reset the stock and clear records of previous buyers
    async reset(productId: number, stock: number): Promise<void> {
      await redis
        .multi()
        .set(stockKey(productId), stock)
        .del(buyersKey(productId))
        .exec();
    },

    async remove(productId: number): Promise<void> {
      await redis.del(stockKey(productId), buyersKey(productId));
    },

    async stockLeft(productId: number): Promise<number> {
      return Number((await redis.get(stockKey(productId))) ?? 0);
    },

    async buyerCount(productId: number): Promise<number> {
      return redis.scard(buyersKey(productId));
    },
  };
}
