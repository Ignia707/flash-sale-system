import { useEffect, useRef, useState } from "react";
import { createApi, type Api } from "./api.ts";
import { useFlashSale, type View } from "./useFlashSale.ts";

const defaultApi = createApi();

function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

// counts down to the server's start time, using the server's clock
function Countdown({ startsAtMs, offsetMs, onDone }: { startsAtMs: number; offsetMs: number; onDone: () => void }) {
  const remaining = () => startsAtMs - (Date.now() + offsetMs);
  const [left, setLeft] = useState(remaining);
  const done = useRef(false);

  useEffect(() => {
    done.current = false;
    const timer = setInterval(() => {
      const value = remaining();
      setLeft(value);
      if (value <= 0 && !done.current) {
        done.current = true;
        onDone();
      }
    }, 250);
    return () => clearInterval(timer);
  });

  return (
    <p className="countdown" aria-label="Time until the sale starts">
      {format(left)}
    </p>
  );
}

function message(view: View): string {
  switch (view.name) {
    case "loading": return "Loading…";
    case "error": return "We could not reach the shop. Please refresh the page.";
    case "countdown": return "The sale has not started yet.";
    case "ready": return view.notice ?? "Ready when you are. One phone per customer.";
    case "buying": return view.notice ?? "Reserving your phone…";
    case "waiting": return view.stalled
        ? "Your order is placed, but confirmation is taking longer than usual. Refresh the page in a moment to check again."
        : "Order placed. Confirming…";
    case "confirmed": return "Your phone is yours. Order confirmed!";
    case "failed": return "Sorry, we could not complete your order.";
    case "soldOut": return "Sold out. All 500 phones are gone.";
    case "already": return "You already have a phone in this sale.";
  }
}

export function App({ api = defaultApi, options }: { api?: Api; options?: Parameters<typeof useFlashSale>[1] }) {
  const { view, offsetMs, buy, onCountdownDone } = useFlashSale(api, options);

  return (
    <main>
      <h1>Flash Sale</h1>
      <p className="product">500 smartphones · one per customer</p>

      {view.name === "countdown" && (
        <Countdown startsAtMs={view.startsAtMs} offsetMs={offsetMs} onDone={onCountdownDone} />
      )}

      <button type="button" onClick={buy} disabled={view.name !== "ready"}>
        {view.name === "buying" ? "Reserving…" : "Buy now"}
      </button>

      <p className="status" role="status" aria-live="polite">
        {message(view)}
      </p>
      {"orderId" in view && <p className="order">Order {view.orderId}</p>}
    </main>
  );
}
