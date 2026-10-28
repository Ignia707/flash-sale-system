import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/lib/config.ts";

// UNIT TEST
describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs(); // undo any env changes so tests don't conflict
  });

  it("reads settings from environment variables", () => {
    vi.stubEnv("API_PORT", "4321");

    expect(loadConfig().api.port).toBe(4321);
  });

  it("fails clearly when a variable is missing", () => {
    vi.stubEnv("POSTGRES_PASSWORD", "");

    expect(() => loadConfig()).toThrow(
      "Missing required environment variable: POSTGRES_PASSWORD",
    );
  });

  it("rejects a port that is not a number", () => {
    vi.stubEnv("API_PORT", "abc");

    expect(() => loadConfig()).toThrow("API_PORT must be an integer");
  });

  it("refuses a JWT secret that is too short", () => {
    vi.stubEnv("JWT_SECRET", "short");

    expect(() => loadConfig()).toThrow("JWT_SECRET must be at least 16 characters");
  });

  it("reads the optional sale start time", () => {
    vi.stubEnv("SALE_STARTS_AT", "2026-11-01T10:00:00Z");

    expect(loadConfig().sale.startsAt?.toISOString()).toBe("2026-11-01T10:00:00.000Z");
  });

  it("leaves the sale start empty when unset", () => {
    vi.stubEnv("SALE_STARTS_AT", "");

    expect(loadConfig().sale.startsAt).toBeUndefined();
  });

  it("rejects a sale start that is not a date", () => {
    vi.stubEnv("SALE_STARTS_AT", "tomorrow-ish");

    expect(() => loadConfig()).toThrow("SALE_STARTS_AT must be a date");
  });
});
