import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";

// UNIT TEST with fakes
describe("GET /health (with fake dependencies)", () => {
  it("returns 200 when every dependency is up", async () => {
    const app = buildApp({
      gate: { reserve: async () => "reserved" as const },
      queue: { publish: async () => {} },
      orders: { statusOf: async () => "processing" as const },
      checks: {
        postgres: async () => "fine",
        redis: async () => "fine",
      },
    });

    // inject() to send a fake request into the app
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      checks: { postgres: "ok", redis: "ok" },
    });
  });

  it("returns 503 and names the dependency that is down", async () => {
    const app = buildApp({
      gate: { reserve: async () => "reserved" as const },
      queue: { publish: async () => {} },
      orders: { statusOf: async () => "processing" as const },
      checks: {
        postgres: async () => "fine",
        redis: async () => {
          throw new Error("connection refused");
        },
      },
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "degraded",
      checks: { postgres: "ok", redis: "down" },
    });
  });
});
