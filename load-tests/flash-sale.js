// The flash sale: 100,000 purchase attempts in 10 seconds for 500 phones.
// Every attempt is a different visitor. Tokens are signed here with the same secret the API uses
// (equivalent to what POST /api/session returns, without 100k extra requests before the spike).
//
// Run through ./load-tests/run.sh, which prepares the stack and checks the database afterwards.

import crypto from "k6/crypto";
import encoding from "k6/encoding";
import exec from "k6/execution";
import http from "k6/http";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const SECRET = __ENV.JWT_SECRET;
const TOTAL = Number(__ENV.TOTAL || 100000);
const SECONDS = Number(__ENV.SECONDS || 10);

// 202 / 409 / 410 are the answers we expect; anything else is a failure
http.setResponseCallback(http.expectedStatuses(202, 409, 410));

const accepted = new Counter("answers_202_accepted");
const duplicate = new Counter("answers_409_duplicate");
const soldOut = new Counter("answers_410_sold_out");
const unexpected = new Counter("answers_unexpected");

export const options = {
  scenarios: {
    spike: {
      executor: "constant-arrival-rate", // a fixed number of attempts per second, however slow the server is
      rate: TOTAL / SECONDS,
      timeUnit: "1s",
      duration: `${SECONDS}s`,
      preAllocatedVUs: Number(__ENV.VUS || 2000),
      maxVUs: Number(__ENV.MAX_VUS || 8000),
    },
  },
  thresholds: {
    answers_unexpected: ["count==0"],
    http_req_failed: ["rate==0"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const b64 = (s) => encoding.b64encode(s, "rawurl");
const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function tokenFor(userId) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${header}.${b64(JSON.stringify({ sub: userId, iat: now, exp: now + 1800 }))}`;
  return `${body}.${crypto.hmac("sha256", SECRET, body, "base64rawurl")}`;
}

const params = (userId) => ({
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(userId)}` },
});
const payload = JSON.stringify({ productId: 1 });

export default function () {
  const userId = `load-${exec.scenario.iterationInTest}`;
  const res = http.post(`${BASE}/api/checkout`, payload, params(userId));

  if (res.status === 202) accepted.add(1);
  else if (res.status === 409) duplicate.add(1);
  else if (res.status === 410) soldOut.add(1);
  else unexpected.add(1);
}

export function handleSummary(data) {
  const file = __ENV.SUMMARY_FILE || "/results/summary.json";
  return { [file]: JSON.stringify(data, null, 2) };
}
