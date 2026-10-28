// The screen's brain: what the visitor sees now, and what each click or answer changes.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, Session } from "./api.ts";
import { backoffDelay, sleep } from "./backoff.ts";
import { ensureSession, forgetSession, savedOrderId, saveOrderId } from "./session.ts";

export type View =
  | { name: "loading" }
  | { name: "error" }
  | { name: "countdown"; startsAtMs: number } // startsAtMs is on the server's clock
  | { name: "ready"; notice?: string }
  | { name: "buying"; notice?: string }
  | { name: "waiting"; orderId: string; stalled: boolean }
  | { name: "confirmed"; orderId: string }
  | { name: "failed"; orderId: string }
  | { name: "soldOut" }
  | { name: "already" };

interface Options {
  productId?: number;
  wait?: (ms: number) => Promise<void>; // replaceable, so tests don't have to wait
  maxBuyAttempts?: number;
  maxPollMs?: number;
}

export function useFlashSale(
  api: Api,
  { productId = 1, wait = sleep, maxBuyAttempts = 6, maxPollMs = 120_000 }: Options = {},
) {
  const [view, setView] = useState<View>({ name: "loading" });
  const [offsetMs, setOffsetMs] = useState(0); // server clock minus this browser's clock
  const session = useRef<Session | null>(null);
  const locked = useRef(false); // set at once on the first click, before React re-renders
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const show = useCallback((next: View) => {
    if (alive.current) setView(next);
  }, []);

  // ask for the order's result again and again, a little slower each time
  const follow = useCallback(
    async (orderId: string) => {
      const started = Date.now();
      show({ name: "waiting", orderId, stalled: false });
      for (let attempt = 0; alive.current; attempt++) {
        const status = session.current ? await api.orderStatus(session.current.token, orderId) : null;
        if (status === "confirmed" || status === "failed") {
          show({ name: status, orderId });
          return;
        }
        if (Date.now() - started > maxPollMs) {
          show({ name: "waiting", orderId, stalled: true }); // stop asking; a refresh asks again
          return;
        }
        await wait(backoffDelay(attempt));
      }
    },
    [api, maxPollMs, show, wait],
  );

  const loadSale = useCallback(async () => {
    const sale = await api.sale();
    setOffsetMs(Date.parse(sale.serverTime) - Date.now());
    if (sale.open || !sale.startsAt) show({ name: "ready" });
    else show({ name: "countdown", startsAtMs: Date.parse(sale.startsAt) });
  }, [api, show]);

  // first load
  useEffect(() => {
    (async () => {
      try {
        session.current = await ensureSession(api);
        const previous = savedOrderId();
        if (previous) await follow(previous); // came back after a refresh: show that order
        else await loadSale();
      } catch {
        show({ name: "error" });
      }
    })();
  }, [api, follow, loadSale, show]);

  // the countdown reached zero: confirm with the server (our clock may be slightly off)
  const onCountdownDone = useCallback(async () => {
    try {
      await wait(500);
      await loadSale();
    } catch {
      show({ name: "error" });
    }
  }, [loadSale, show, wait]);

  const buy = useCallback(async () => {
    if (locked.current || !session.current) return; // a second click while one is in flight does nothing
    locked.current = true;
    show({ name: "buying" });
    try {
      for (let attempt = 0; attempt < maxBuyAttempts && alive.current; attempt++) {
        const outcome = await api.checkout(session.current.token, productId);
        switch (outcome.kind) {
          case "accepted":
            saveOrderId(outcome.orderId);
            await follow(outcome.orderId);
            return;
          case "already": {
            const previous = savedOrderId();
            if (previous) await follow(previous);
            else show({ name: "already" });
            return;
          }
          case "soldOut":
            show({ name: "soldOut" });
            return;
          case "notStarted":
            show({ name: "countdown", startsAtMs: Date.parse(outcome.startsAt) });
            return;
          case "unauthorized":
            forgetSession();
            session.current = await ensureSession(api);
            break;
          case "retry":
            show({ name: "buying", notice: "The shop is very busy. Trying again…" });
            await wait(backoffDelay(attempt));
            break;
        }
      }
      show({ name: "ready", notice: "Still busy. Please press the button again." });
    } finally {
      locked.current = false;
    }
  }, [api, follow, maxBuyAttempts, productId, show, wait]);

  return { view, offsetMs, buy, onCountdownDone };
}
