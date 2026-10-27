// create redis client

import { Redis } from "ioredis";
import type { Config } from "./config.ts";

export function createRedis(config: Config["redis"]): Redis {
  const redis = new Redis({
    ...config,
    // reduce the number of retries
    maxRetriesPerRequest: 1,
  });

  redis.on("error", (err) => {
    console.error("Redis error", err.message);
  });

  return redis;
}
