// UNIT TEST: the guest session endpoint and the sale clock endpoint

import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.ts";
import { TEST_SECRET } from "./helpers.ts";

const app = (extra: Partial<Parameters<typeof buildApp>[0]> = {}) =>
  buildApp({
    jwtSecret: TEST_SECRET,
    checks: {},
    gate: { reserve: async () => "reserved" as const, release: async () => true },
    queue: { publish: async () => {} },
    orders: { statusOf: async () => "processing" as const },
    ...extra,
  });

describe("POST /api/session", () => {
  it("issues a token whose subject is the returned guest id", async () => {
    const a = app();

    const response = await a.inject({ method: "POST", url: "/api/session" });

    expect(response.statusCode).toBe(200);
    const { token, userId } = response.json();
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.jwt.verify<{ sub: string }>(token).sub).toBe(userId);
  });

  it("gives every visitor a different guest id", async () => {
    const a = app();

    const first = (await a.inject({ method: "POST", url: "/api/session" })).json();
    const second = (await a.inject({ method: "POST", url: "/api/session" })).json();

    expect(first.userId).not.toBe(second.userId);
  });

  it("issues tokens that expire", async () => {
    const a = app();
    const { token } = (await a.inject({ method: "POST", url: "/api/session" })).json();

    const { exp, iat } = a.jwt.decode<{ exp: number; iat: number }>(token)!;

    expect(exp - iat).toBe(30 * 60);
  });
});

describe("GET /api/sale", () => {
  const opensAt = new Date("2026-11-01T10:00:00Z");

  it("reports a sale that has not started, with the server's time", async () => {
    const now = opensAt.getTime() - 60_000;
    const response = await app({ saleStartsAt: opensAt, now: () => now }).inject({
      method: "GET",
      url: "/api/sale",
    });

    expect(response.json()).toEqual({
      open: false,
      startsAt: "2026-11-01T10:00:00.000Z",
      serverTime: "2026-11-01T09:59:00.000Z",
    });
  });

  it("reports an open sale", async () => {
    const response = await app({ saleStartsAt: opensAt, now: () => opensAt.getTime() }).inject({
      method: "GET",
      url: "/api/sale",
    });

    expect(response.json().open).toBe(true);
  });

  it("is always open when no start time is set", async () => {
    const response = await app().inject({ method: "GET", url: "/api/sale" });

    expect(response.json()).toMatchObject({ open: true, startsAt: null });
  });
});
