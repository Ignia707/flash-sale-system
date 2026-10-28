# Flash Sale System

A flash-sale checkout service that never sells more than the available stock, even under a sudden traffic spike.

- Stock is reserved atomically in Redis, so the database is not in the request path.
- Orders are written to PostgreSQL asynchronously through a queue.
- Verified by a repeatable load test; results are in [`load-tests/results/SUMMARY.md`](load-tests/results/SUMMARY.md).

Design and decisions: see `solution.md`.

## Stack

Fastify (Node 24, TypeScript) · Redis (Lua gate) · RabbitMQ · PostgreSQL · NGINX · React + Vite · k6 · Podman/Docker Compose

```
browser ─► NGINX ─► API replicas ─► Redis (atomic token) ─► RabbitMQ ─► worker ─► PostgreSQL
```

## Quick start

Needs Node.js 24+, pnpm, and Podman (`podman-compose`) or Docker (`docker compose`; replace `podman-compose` below).

```bash
cp .env.example .env                           # first time only
podman-compose --profile app up -d --build     # Postgres, Redis, RabbitMQ, API, worker, NGINX
./scale-api.sh 3                               # Podman only: run exactly 3 API replicas
cd backend && pnpm install && pnpm seed 500    # 500 phones in Postgres and Redis
```

Open **http://localhost:8080** and press *Buy now*. The first start downloads images and takes a few minutes.

Stop with `podman-compose --profile app down` (data is kept; `-v` wipes it).

**Development mode** (only the backing services in containers):

```bash
podman-compose up -d
cd backend && pnpm install && pnpm seed 500
pnpm dev                                       # API on :3000
pnpm worker                                    # second terminal: saves the orders (not together with the worker container)
cd ../frontend && pnpm install && pnpm dev     # page on :5173, proxies /api to :3000
```

**Settings** (`.env`, see `.env.example`): `SALE_STARTS_AT` (UTC; unset = always open), `JWT_SECRET` (16+ characters), `API_REPLICAS` (Docker only), `HTTP_PORT`, `LOG_LEVEL`, `RATE_SESSION` / `RATE_CHECKOUT` (+ `BURST_*`) per-IP limits.

## API

| Method and path | Token | Answers |
|---|---|---|
| `POST /api/session` | no | `200 { token, userId }`, a guest identity valid 30 minutes |
| `GET /api/sale` | no | `200 { open, startsAt, serverTime }` |
| `POST /api/checkout` `{ "productId": 1 }` | yes | `202 { status, orderId }` · `409` already bought · `410` sold out · `403` not started · `401` bad token · `503` + `Retry-After` · `429` rate limited |
| `GET /api/orders/:id` | yes | `200 { orderId, status }`: `processing` / `confirmed` / `failed` (buyer only) |
| `GET /health` | no | `200`, or `503` naming the dependency that is down |

## Tests

```bash
cd backend  && pnpm test       # 80 tests; integration tests need the containers up
cd frontend && pnpm test       # 24 tests
pnpm typecheck                 # in either folder
```

## Load test

```bash
./load-tests/smoke.sh          # one visitor through the real flow
./load-tests/run.sh 4          # 100k attempts in 10 s, 4 replicas (~1.5 min); prints RESULT: PASS only if exactly 500 sold
./load-tests/run.sh 2 20000 5  # lighter: 20,000 attempts in 5 s, 2 replicas
```

Run it with nothing else heavy open. It removes its containers at the end; start again with `podman-compose --profile app up -d`.

## Operations

In `backend/`:

```bash
pnpm seed 500          # DEV: wipe and start a fresh sale
pnpm seed              # rebuild Redis (stock, buyers) from Postgres; only when the queue is empty
pnpm reconcile [--fix] # compare Redis with Postgres; --fix repairs Redis
pnpm replay-dead       # move parked (dead-letter) orders back to the queue
pnpm demo:oversell naive|atomic   # reproduce the original bug / the fix
```

After restarting a single API replica run `podman exec app_nginx_1 nginx -s reload` so NGINX learns its new address. RabbitMQ management: http://localhost:15672 (credentials in `.env`).

## Layout

```
backend/    src/api (routes), src/lib (gate, queue, orders), src/worker, src/scripts, test/
frontend/   React page (src/), tests (test/), Dockerfile (builds the page into the NGINX image)
infra/      Postgres schema, NGINX config template
load-tests/ k6 scripts, run.sh, results/
compose.yaml, scale-api.sh
```
