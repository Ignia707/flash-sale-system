// The only file that talks to the server. Everything it returns is already sorted into the cases the screen needs.

export interface Sale {
  open: boolean;
  startsAt: string | null;
  serverTime: string;
}

export type OrderStatus = "processing" | "confirmed" | "failed";

export type CheckoutOutcome =
  | { kind: "accepted"; orderId: string }
  | { kind: "already" } // 409: this visitor already holds a phone
  | { kind: "soldOut" } // 410
  | { kind: "notStarted"; startsAt: string } // 403
  | { kind: "unauthorized" } // 401: token expired
  | { kind: "retry" }; // 429, 503, 5xx, no network: safe to try again

export interface Session {
  token: string;
  userId: string;
}

export function createApi(fetchFn: typeof fetch = (...args) => fetch(...args)) {
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  return {
    async session(): Promise<Session> {
      const response = await fetchFn("/api/session", { method: "POST" });
      if (!response.ok) throw new Error(`session failed (${response.status})`);
      return response.json();
    },

    async sale(): Promise<Sale> {
      const response = await fetchFn("/api/sale");
      if (!response.ok) throw new Error(`sale info failed (${response.status})`);
      return response.json();
    },

    async checkout(token: string, productId: number): Promise<CheckoutOutcome> {
      let response: Response;
      try {
        response = await fetchFn("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...bearer(token) },
          body: JSON.stringify({ productId }),
        });
      } catch {
        return { kind: "retry" }; // network error
      }
      if (response.status === 202) return { kind: "accepted", orderId: (await response.json()).orderId };
      if (response.status === 409) return { kind: "already" };
      if (response.status === 410) return { kind: "soldOut" };
      if (response.status === 401) return { kind: "unauthorized" };
      if (response.status === 403) {
        const body = await response.json().catch(() => ({}));
        return { kind: "notStarted", startsAt: body.startsAt };
      }
      return { kind: "retry" };
    },

    // null = could not ask right now (ask again later)
    async orderStatus(token: string, orderId: string): Promise<OrderStatus | null> {
      try {
        const response = await fetchFn(`/api/orders/${orderId}`, { headers: bearer(token) });
        if (!response.ok) return null;
        return (await response.json()).status;
      } catch {
        return null;
      }
    },
  };
}

export type Api = ReturnType<typeof createApi>;
