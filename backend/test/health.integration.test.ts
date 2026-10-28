import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import { loadConfig } from "../src/lib/config.ts";
import { createPool } from "../src/lib/db.ts";
import { createRedis } from "../src/lib/redis.ts";

// INTEGRATION TEST
describe("GET /health (real Postgres and Redis)", () => {
  const config = loadConfig();
  const pool = createPool(config.postgres);
  const redis = createRedis(config.redis);

  const app = buildApp({
    gate: { reserve: async () => "reserved" as const },
    checks: {
      postgres: () => pool.query("SELECT 1"),
      redis: () => redis.ping(),
    },
  });

  // close connections after the tests
  afterAll(async () => {
    await app.close();
    await pool.end();
    redis.disconnect();
  });

  it("reports both dependencies as ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      checks: { postgres: "ok", redis: "ok" },
    });
  });
});
