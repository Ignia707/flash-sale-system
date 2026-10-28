import { describe, expect, it } from "vitest";
import { createApi } from "../src/api.ts";

const reply = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const checkoutWith = (fetchFn: typeof fetch) => createApi(fetchFn).checkout("token", 1);

describe("api.checkout", () => {
  it.each([
    [202, { orderId: "o1" }, { kind: "accepted", orderId: "o1" }],
    [409, {}, { kind: "already" }],
    [410, {}, { kind: "soldOut" }],
    [401, {}, { kind: "unauthorized" }],
    [403, { startsAt: "2026-11-01T10:00:00.000Z" }, { kind: "notStarted", startsAt: "2026-11-01T10:00:00.000Z" }],
    [429, {}, { kind: "retry" }],
    [503, {}, { kind: "retry" }],
    [502, {}, { kind: "retry" }],
  ])("turns HTTP %i into %j", async (status, body, expected) => {
    expect(await checkoutWith(reply(status, body))).toEqual(expected);
  });

  it("treats a network failure as something to retry", async () => {
    const down = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;

    expect(await checkoutWith(down)).toEqual({ kind: "retry" });
  });

  it("sends the token and the product", async () => {
    let seen: RequestInit | undefined;
    const spy = (async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response("{}", { status: 410 });
    }) as unknown as typeof fetch;

    await createApi(spy).checkout("abc", 7);

    expect((seen?.headers as Record<string, string>).Authorization).toBe("Bearer abc");
    expect(seen?.body).toBe(JSON.stringify({ productId: 7 }));
  });
});

describe("api.orderStatus", () => {
  it("returns the status", async () => {
    expect(await createApi(reply(200, { status: "confirmed" })).orderStatus("t", "o1")).toBe("confirmed");
  });

  it("returns null when it could not ask", async () => {
    expect(await createApi(reply(503)).orderStatus("t", "o1")).toBeNull();
  });
});
