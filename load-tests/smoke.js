// Smoke test: one visitor walks the real flow through NGINX (session -> checkout -> order status).
// Run:  ./load-tests/smoke.sh      (needs the stack up and `pnpm seed 500` done)

import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const json = { "Content-Type": "application/json" };

export const options = { vus: 1, iterations: 1 };

export default function () {
  const session = http.post(`${BASE}/api/session`);
  check(session, { "session 200": (r) => r.status === 200 });
  const auth = { ...json, Authorization: `Bearer ${session.json("token")}` };

  const buy = http.post(`${BASE}/api/checkout`, JSON.stringify({ productId: 1 }), { headers: auth });
  check(buy, { "checkout 202": (r) => r.status === 202 });
  const orderId = buy.json("orderId");

  let status = "processing";
  for (let i = 0; i < 20 && status === "processing"; i++) {
    sleep(0.25);
    status = http.get(`${BASE}/api/orders/${orderId}`, { headers: auth }).json("status");
  }
  check(status, { "order confirmed": (s) => s === "confirmed" });
  console.log(`order ${orderId}: ${status}`);
}
