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
});
