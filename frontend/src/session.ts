// Keeps the guest token in the browser, so a page refresh is the same visitor (not a new one who could buy again).

import type { Api, Session } from "./api.ts";

const KEY = "flash.session";
const ORDER_KEY = "flash.order";

// the token's expiry (seconds) is inside its middle part
function expiresAt(token: string): number {
  try {
    const payload = token.split(".")[1] ?? "";
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000;
  } catch {
    return 0;
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage can be blocked (private mode)
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // keeping the value is a convenience, not a requirement
  }
}

export async function ensureSession(api: Api, now = Date.now()): Promise<Session> {
  const saved = read(KEY);
  if (saved) {
    const session: Session = JSON.parse(saved);
    if (expiresAt(session.token) - now > 60_000) return session; // still good for a minute
  }
  const fresh = await api.session();
  write(KEY, JSON.stringify(fresh));
  return fresh;
}

export const forgetSession = () => write(KEY, null);
export const savedOrderId = () => read(ORDER_KEY);
export const saveOrderId = (orderId: string | null) => write(ORDER_KEY, orderId);
