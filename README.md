# Flash Sale System

A flash-sale checkout that sells **exactly 500 phones** while **100,000 purchase attempts arrive in 10 seconds**.

The earlier trial of this feature sold 540 phones out of 500, with slow requests and database row-lock timeouts. This system fixes both problems: the stock decision is made atomically in Redis (no database in the request path), and orders are written to Postgres afterwards through a queue.

**Result:** in 6 load-test runs (1 to 8 API replicas), 100,000 attempts in 10 seconds each, the system sold exactly 500 phones every time, with no unexpected answers. Median latency 0.2 ms, p95 4 to 22 ms with 1 to 6 replicas (see [Load test results](#load-test-results)).

## Contents

1. [Architecture](#architecture)
2. [How "exactly 500" is guaranteed](#how-exactly-500-is-guaranteed)
3. [Technology choices](#technology-choices)
4. [Quick start](#quick-start)
5. [API](#api)
6. [Tests](#tests)
7. [Load test results](#load-test-results)
8. [Frontend strategy](#frontend-strategy)
9. [What happens when something fails](#what-happens-when-something-fails)
10. [Operations runbook](#operations-runbook)
11. [Production architecture](#production-architecture)
12. [Limitations and next steps](#limitations-and-next-steps)
13. [Project layout](#project-layout)

## Architecture

```
                         browser (React page)
                                 │
                                 ▼
                ┌──────────────────────────────────┐
                │ NGINX  :8080                     │  static page (cached, gzip)
                │  - least_conn load balancing     │  per-IP rate limits (429)
                │  - passive failover              │
                └───────┬──────────┬──────────┬────┘
                        ▼          ▼          ▼
                    ┌───────┐  ┌───────┐  ┌───────┐
                    │ API 1 │  │ API 2 │  │ API 3 │   stateless Fastify replicas
                    └───┬───┘  └───┬───┘  └───┬───┘   (count is a setting)
                        └──────────┼──────────┘
              1. token check (JWT)  │  2. atomic "take a token"
                        ┌───────────┴───────────┐
                        ▼                       ▼
                ┌───────────────┐       ┌────────────────┐
                │ Redis         │       │ RabbitMQ       │  3. publish the order
                │ stock counter │       │ queue "orders" │     (wait for broker confirm)
                │ + buyers set  │       │ + dead letters │
                └───────────────┘       └───────┬────────┘
                                                │ 4. consume
                                                ▼
                                        ┌───────────────┐
                                        │ Worker        │  idempotent, one transaction
                                        └───────┬───────┘
                                                ▼
                                        ┌───────────────┐
                                        │ PostgreSQL    │  source of truth:
                                        │ products,     │  stock, orders
                                        │ orders        │
                                        └───────────────┘
```

**A purchase, step by step**

1. The page gets a signed guest token (`POST /api/session`) and the server's clock (`GET /api/sale`).
2. `POST /api/checkout` (with the token): NGINX picks the least busy replica. The replica verifies the token, then checks the sale window.
3. **The gate:** one Lua script in Redis checks "has this visitor bought already?" and "is stock left?", takes one token and records the buyer, as a single indivisible step. The answer is `202`, `409` (already has one) or `410` (sold out). Rejected visitors (99.5% of the spike) never touch Postgres or the queue; after the first "sold out", each replica answers from its own memory for 1.5 s without even calling Redis.
4. A visitor who got a token receives an order id, and the order is published to RabbitMQ. The `202` is sent only after the broker confirmed it stored the message. If publishing fails, the token is given back and the answer is `503`.
5. The worker takes the order from the queue and, in one Postgres transaction, inserts the order (using the same order id) and decrements the stock with `UPDATE ... WHERE stock > 0`, then marks it `confirmed`. It acknowledges the message only after the commit.
6. The page polls `GET /api/orders/:id` (backoff with jitter) until it reads `confirmed`.

## How "exactly 500" is guaranteed

Several independent layers, each of which would catch a bug in the one before it:

| Layer | What it does |
|---|---|
| Redis Lua script | Check and take a token in one atomic step; one token per visitor. A plain GET-then-DECR was tested and sold 2000 of 500, so the atomic script is the core fix. |
| Worker idempotency | The order id is chosen when the token is issued; processing the same message twice inserts nothing the second time. Delivery is at-least-once, so this matters. |
| SQL guard | `UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock > 0`: the check and the decrement are one statement; the row lock serialises concurrent updates. |
| Database constraints | `CHECK (stock >= 0)` and `UNIQUE (user_id, product_id)`: even buggy code cannot oversell or double-sell. |
| Reconcile script | Compares Redis with Postgres and can rebuild Redis from Postgres (the source of truth). |

Every load test finishes by checking all three data stores: exactly 500 confirmed orders, stock 0 in Postgres and Redis, nothing in the dead-letter queue.

## Technology choices

| Choice | Why |
|---|---|
| **Redis + Lua** for the gate | Single-threaded and in memory: one script is atomic and takes microseconds. Postgres row locks were the original bottleneck. |
| **RabbitMQ** for the queue | Publisher confirms, acknowledgements and persistent messages give at-least-once delivery. A queue absorbs the spike so Postgres sees a calm, steady load. |
| **PostgreSQL** | The durable source of truth, with constraints as the last line of defence. |
| **Fastify (Node 24, TypeScript)** | Fast, schema-validated routes. Node 24 runs `.ts` files directly (no build step). |
| **NGINX** | Load balancing (`least_conn`), per-IP rate limits, static files with cache rules, gzip. |
| **Guest JWT** | The server decides who the visitor is; a typed-in user id would let anyone claim thousands of identities. Short-lived (30 min), not a login. |
| **React + Vite** | Small bundle (69 KB transferred), standard tooling. |
| **k6** | Load-testing tool with a fixed arrival rate, which models a crowd realistically. |
| **Podman / Docker Compose** | The whole system starts with one command. |

## Quick start

**Prerequisites:** Node.js 24+, pnpm, and Podman (`podman-compose`) or Docker (`docker compose`). The commands use Podman; with Docker replace `podman-compose` with `docker compose`.

```bash
cp .env.example .env                           # first time only (development passwords)
podman-compose --profile app up -d --build     # Postgres, Redis, RabbitMQ, API, worker, NGINX
./scale-api.sh 3                               # Podman only: run exactly 3 API replicas
cd backend && pnpm install && pnpm seed 500    # 500 phones in Postgres and Redis
```

Open **http://localhost:8080** and press *Buy now*. (The first start downloads images and takes a few minutes.)

Useful commands:

```bash
curl -s -X POST localhost:8080/api/session     # a guest token
curl -s localhost:8080/api/sale                # sale window and the server's clock
podman-compose --profile app ps                # state of all services
podman stop app_nginx_1 app_worker_1 app_api_1 app_api_2 app_api_3   # stop only the app containers
podman-compose --profile app down              # stop everything (data is kept; -v wipes it)
```

**Development without the app containers** (only the three backing services):

```bash
podman-compose up -d                           # Postgres, Redis, RabbitMQ
cd backend && pnpm install && pnpm seed 500
pnpm dev                                       # API on :3000
pnpm worker                                    # in a second terminal: saves the orders
cd ../frontend && pnpm install && pnpm dev     # page on :5173, proxies /api to :3000
```

Use **either** the containerized worker **or** `pnpm worker`, not both.

**Settings** (`.env`, see `.env.example`):

| Setting | Meaning |
|---|---|
| `SALE_STARTS_AT` | Sale opens at this UTC time (e.g. `2026-11-01T10:00:00Z`); unset = always open |
| `JWT_SECRET` | Signs guest tokens (16+ characters; use a long random value outside development) |
| `API_REPLICAS` | API copies with Docker Compose; with Podman use `./scale-api.sh N` |
| `HTTP_PORT` | NGINX port (default 8080) |
| `LOG_LEVEL` | `info` logs every request; `warn` silences them |
| `RATE_SESSION`, `RATE_CHECKOUT` (+ `BURST_*`) | Per-IP requests/second allowed on `/api/session` and `/api/checkout` (429 beyond) |

## API

| Method and path | Needs token | Answers |
|---|---|---|
| `POST /api/session` | no | `200 { token, userId }` a new guest identity, valid 30 minutes |
| `GET /api/sale` | no | `200 { open, startsAt, serverTime }` |
| `POST /api/checkout` body `{ "productId": 1 }` | yes | `202 { status: "reserved", orderId }` · `409` already has one · `410` sold out · `403 { status: "not_started", startsAt }` · `401` bad/expired token · `400` invalid body · `503 { status: "unavailable" }` with `Retry-After` · `429` too many requests (NGINX) |
| `GET /api/orders/:id` | yes | `200 { orderId, status }` with `processing`, `confirmed` or `failed`; only the buyer sees the real status |
| `GET /health` | no | `200` when Postgres and Redis are reachable, else `503` naming the one that is down |

## Tests

```bash
cd backend  && pnpm test      # 80 tests: unit tests with fakes, integration tests against the real services (they need the containers up)
cd frontend && pnpm test      # 24 tests: logic and component tests, no server needed
pnpm typecheck                # in either folder
```

The most important backend tests: 1000 simultaneous buyers against 100 tokens give exactly 100 accepted, and exactly those 100 orders end up in the queue; 200 simultaneous worker transactions confirm exactly the stock; the whole journey (session, checkout, queue, worker, Postgres, order status) runs end to end; failure tests cover Redis down, queue down (the token comes back), poison messages (parked in the dead-letter queue and replayable), and a broker restart.

## Load test results

**Scenario:** 100,000 purchase attempts in 10 seconds (10,000 per second, each from a different visitor) for 500 phones, through NGINX. **Machine:** one 16-core desktop running everything at once (k6, NGINX, API replicas, worker, Redis, RabbitMQ, Postgres), so the numbers are conservative; each is a single run.

| API replicas | Requests sent | Not sent* | Phones sold | Unexpected answers | p95 | p99 |
|---|---|---|---|---|---|---|
| 1 | 99,306 | 695 | 500 | 0 | 22.3 ms | 1341 ms |
| 2 | 100,001 | 0 | 500 | 0 | 13.1 ms | 316 ms |
| 3 | 99,955 | 46 | 500 | 0 | 7.2 ms | 629 ms |
| 4 | 100,001 | 0 | 500 | 0 | 4.5 ms | 329 ms |
| 6 | 100,002 | 0 | 500 | 0 | 6.6 ms | 109 ms |
| 8 | 99,114 | 888 | 500 | 0 | 52.6 ms | 182 ms |

\* attempts k6 could not even send because its virtual users were all busy.

- Correctness never depended on the replica count: always exactly 500, with stock 0 in Postgres and Redis and nothing dead-lettered.
- One replica is at its limit; 2 to 6 handle the full rate; 8 is worse because the machine has no spare CPU (more replicas help only while there are free cores or more machines). Differences between 2, 3, 4 and 6 are within run-to-run noise.
- **Findings from the tests:** a first NGINX failover setting (drop a replica after one failed connection) turned a spike into an outage (everything answered 502) and was loosened; a small connection backlog refused bursts, so Node and NGINX now queue up to 4096 connections.

Run it yourself (about 1.5 minutes; do not run other heavy programs meanwhile):

```bash
./load-tests/smoke.sh          # one visitor through the real flow
./load-tests/run.sh 4          # the full spike with 4 replicas; prints RESULT: PASS only if exactly 500 sold
./load-tests/run.sh 2 20000 5  # lighter: 20,000 attempts in 5 seconds with 2 replicas
```

Details and per-run files: [`load-tests/results/`](load-tests/results/SUMMARY.md). `run.sh` removes its load-test containers at the end; start normally again with `podman-compose --profile app up -d`.

## Frontend strategy

Budgets: bundle under 200 KB, time to interactive under 1.5 s.

- **Size:** 69 KB transferred in total (HTML 0.3 KB, CSS 0.6 KB, JS 69.9 KB gzip; React 19 included), no fonts, images or third-party scripts. Uncompressed the JS is 225 KB; Preact would cut that further if needed. Time to interactive was reasoned about, not measured (no Chrome on the build machine): Lighthouse in Chrome DevTools gives the number.
- **Button throttling:** the button locks on the very first click through a ref set synchronously (React state would be too late for two clicks in one tick); a test proves that three rapid clicks send one request.
- **CDN-style caching:** hashed files under `/assets/` are served `public, max-age=31536000, immutable`; `index.html` is `no-cache`; API answers are `no-store`. A CDN in front only needs a DNS change.
- **Pre-fetching:** one small bundle means nothing to lazy-load; adding `<link rel="preload" as="fetch" href="/api/sale">` and warming the CDN before the sale are the next steps.
- **Polling, not WebSockets, for order status:** only the ~500 buyers poll at all (the 99.5% rejected get an immediate answer), polling is cacheable, rate-limitable and works through every proxy, while 100k open WebSockets need different infrastructure. Polling uses exponential backoff with jitter so browsers do not retry in lock-step. WebSockets or Server-Sent Events would be right for a live "stock left" counter.
- **Optimistic UI:** "Reserving…" appears on click, "Order placed" on the `202`, before the database write; the final state follows.
- **Server clock:** the countdown uses the server's time, and at zero the page re-checks with the server before unlocking.
- **Resilience:** automatic retry with backoff on 429/503/network errors; the guest token and order id survive a page refresh.

## What happens when something fails

Checked by hand on the running system (drills) and by automated tests:

| Failure | Effect | Recovery |
|---|---|---|
| Redis down | Checkout answers `503` with `Retry-After`; `/health` answers `503` naming Redis; `/api/sale` still works | Automatic when Redis returns. If its data was lost: `pnpm reconcile --fix` |
| RabbitMQ down or restarted | Checkout answers `503` and the token goes back to the pool; no purchase is lost | Connection, channel and worker subscription rebuild automatically |
| Postgres down | `/health` `503`; checkout keeps working (it does not use Postgres); accepted orders wait in the queue and the worker retries (8 tries, 3 s apart) | After about 20 s of outage unprocessed orders are parked in `orders.dead`; `pnpm replay-dead` sends them back |
| An API replica dies | NGINX skips it after 3 failed attempts for 10 s; others keep serving | A restarted replica gets a new address: `podman exec app_nginx_1 nginx -s reload` |
| Worker down | Orders wait safely in the queue; customers see `processing` | The worker catches up when started |
| A message that always fails | Retried, then parked in `orders.dead` instead of looping forever | Fix the cause, `pnpm replay-dead` |
| Redis and Postgres disagree | `pnpm reconcile` reports it | `pnpm reconcile --fix` rebuilds Redis (stock and buyers) from Postgres |

## Operations runbook

All commands run in `backend/` and use the containers' published ports.

```bash
pnpm seed 500          # DEV: wipe and start a fresh sale of 500 phones (Postgres and Redis)
pnpm seed              # rebuild Redis (stock and buyers) from Postgres; only when the queue is empty
pnpm reconcile         # compare Redis with Postgres per product (refuses while orders are queued)
pnpm reconcile --fix   # ... and repair Redis from Postgres
pnpm replay-dead       # move parked (dead-letter) orders back to the queue
```

RabbitMQ's management page is at http://localhost:15672 (user and password in `.env`): queue depth, rates, the dead-letter queue.

## Production architecture

What I would run for a real launch, and why. Put a **CDN** (for example CloudFront) in front for the page and its hashed assets, and a **WAF** with per-IP rate limits and bot rules at the edge, so most abusive traffic never reaches the servers. Behind it an **application load balancer** (ALB) spreads requests over an **auto-scaling group of stateless API containers** (ECS or Kubernetes); they are stateless because identity is a signed token and all state is in Redis and Postgres, which is why scaling out is trivial. **Pre-scale before 8 PM** instead of relying on reactive autoscaling, since a 10-second spike is over before new servers boot. Use **managed Redis** (ElastiCache) with a replica and persistence (AOF) for the stock gate; Redis is single-threaded, so one hot key tops out around 100k operations per second, and above that the stock can be split across keys (for example 10 shards of 50 tokens) or a **virtual waiting room** can meter admissions. Use a **managed queue** (Amazon MQ or SQS, or Kafka if events must be replayed) with a dead-letter queue and alarms on its depth, and **multi-AZ managed Postgres** (RDS/Aurora) as the source of truth, written to at a calm pace by an auto-scaled **worker fleet**. Add **observability**: p99 latency, 5xx rate, Redis operations and memory, queue depth and age, dead-letter count, and a reconcile job that alerts when Redis and Postgres disagree. Finally, **load-test the real environment** (not the free tiers) with the same k6 script before launch.

## Limitations and next steps

- **Single instances** of Redis, RabbitMQ and Postgres (fine for the exercise; see Production architecture).
- **Per-IP rate limits** treat people behind one shared address (an office, a mobile carrier) as one client; the defaults are loose, but a real deployment needs smarter bot defences (CAPTCHA, a waiting room).
- **`/api/session` is free to call**, so identities can be farmed; the defences are the per-IP limit at NGINX and the short token life. A real system would add proof of work, CAPTCHA or accounts.
- **The page is wired to product 1** and the text "500 smartphones"; it has no live stock counter.
- **NGINX learns replica addresses only when it (re)loads**; production uses service discovery.
- **No HTTPS locally**; in production tokens must travel over TLS.
- **Time to interactive** was not measured directly (no Chrome available); bundle size was.
- **Not deployed to a public host.** An optional free-tier deployment (static page on a free host, small Postgres/Redis/queue services) was left out for time, and the load test must never run against free services.

## Project layout

```
backend/
  src/api/        Fastify app, routes (checkout, session, sale, orders, health), token check
  src/lib/        Redis gate, sold-out memory, queue (retry + dead letters), order store, sale window, seed, reconcile
  src/worker/     the worker: order -> Postgres, idempotent
  src/scripts/    seed, reconcile, replay-dead, oversell demo (the bug, reproduced)
  test/           80 tests
frontend/         React page (src/), 24 tests (test/), Dockerfile (builds the page into the NGINX image)
infra/            Postgres schema (infra/postgres), NGINX config template (infra/nginx/templates)
load-tests/       k6 scripts, run.sh, results/
compose.yaml      all services; `--profile app` adds API, worker, NGINX
scale-api.sh      run N API replicas (Podman)
```

`pnpm demo:oversell naive` (in `backend/`) reproduces the original bug: 10,000 buyers racing for 500 phones with a read-then-write purchase oversell by thousands. `pnpm demo:oversell atomic` shows the fix selling exactly 500.
