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

// Gives a token back, but only if this user really holds one (so stock can't inflate)
const RELEASE_LUA = `
if redis.call('SREM', KEYS[2], ARGV[1]) == 1 then
  redis.call('INCR', KEYS[1])
  return 1
end
return 0
`;

// decalare the commands to be registerd
declare module "ioredis" {
  interface RedisCommander<Context> {
    reserveStock(
      stockKey: string,
      buyersKey: string,
      userId: string,
    ): Promise<number>;
    releaseStock(
      stockKey: string,
      buyersKey: string,
      userId: string,
    ): Promise<number>;
  }
}

const stockKey = (productId: number) => `stock:${productId}`;
const buyersKey = (productId: number) => `buyers:${productId}`;

export type Gate = ReturnType<typeof createGate>;

export function createGate(redis: Redis) {
  // the script is sent to Redis once ---> called by its hash
  redis.defineCommand("reserveStock", { numberOfKeys: 2, lua: RESERVE_LUA });
  redis.defineCommand("releaseStock", { numberOfKeys: 2, lua: RELEASE_LUA });

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

    // true if a token went back to the pool, false if this user held none
    async release(productId: number, userId: string): Promise<boolean> {
      const code = await redis.releaseStock(
        stockKey(productId),
        buyersKey(productId),
        userId,
      );
      return code === 1;
    },

    // set the stock and replace the record of buyers (none, unless given)
    async reset(
      productId: number,
      stock: number,
      buyers: string[] = [],
    ): Promise<void> {
      const tx = redis
        .multi()
        .set(stockKey(productId), stock)
        .del(buyersKey(productId));
      if (buyers.length > 0) tx.sadd(buyersKey(productId), ...buyers);
      await tx.exec();
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
