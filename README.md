# Flash Sale System

Flash-sale checkout that sells exactly 500 phones under a 100k-request spike.
Work in progress: the full write-up (architecture, results) comes at the end.

## Prerequisites

- Node.js 24+ and pnpm
- A container runtime with Compose: **Podman** (`podman-compose`) or **Docker** (`docker compose`).
  The commands below use Podman; with Docker, replace `podman-compose` with `docker compose`.

## Backend

```bash
cd backend
pnpm install
pnpm dev          # API on http://localhost:3000 (restarts on file changes)
pnpm test         # unit + integration tests (needs the services below running)
pnpm typecheck    # TypeScript type check
curl localhost:3000/health
```

## Running the backing services

```bash
cp .env.example .env        # first time only
podman-compose up -d        # Postgres, Redis, RabbitMQ
podman-compose ps           # all three should say "healthy"
podman-compose down         # stop (data is kept); add -v to wipe data
```

| Service | Address | Notes |
|---|---|---|
| PostgreSQL | `localhost:5432` | user/password/db in `.env` |
| Redis | `localhost:6379` | |
| RabbitMQ | `localhost:5672` | management UI at http://localhost:15672 |

## Running the whole system

Besides the three backing services, this starts the API (3 identical replicas), the worker and NGINX.

```bash
podman-compose --profile app up -d --build   # first build takes a few minutes (image downloads)
./scale-api.sh 3                             # Podman only: make sure exactly 3 API replicas run
cd backend && pnpm seed 500                  # load 500 phones into Postgres and Redis
```

Everything is reached through NGINX at **http://localhost:8080** (API under `/api/...`).

```bash
curl -s -X POST localhost:8080/api/session   # get a guest token
curl -s localhost:8080/api/sale
```

| Setting (in `.env`) | Meaning |
|---|---|
| `API_REPLICAS` | API copies when using Docker Compose (`deploy.replicas`). With Podman use `./scale-api.sh N`. |
| `HTTP_PORT` | Port of the NGINX front door (default 8080) |
| `LOG_LEVEL` | `info` logs every request; `warn` silences them (use for load tests) |
| `RATE_SESSION`, `RATE_CHECKOUT` (+ `BURST_*`) | Per-IP requests/second allowed by NGINX on `/api/session` and `/api/checkout` (429 when exceeded) |
| `SALE_STARTS_AT` | Sale opens at this UTC time; unset = open |

If you stop and start a single replica, it gets a new address: run `podman exec app_nginx_1 nginx -s reload` so NGINX notices (`./scale-api.sh` does this itself).
Use **either** the containerized worker **or** `pnpm worker` on your machine, not both.
Stop only the app containers: `podman stop app_nginx_1 app_worker_1 app_api_1 app_api_2 app_api_3`.
With Docker, replace `podman-compose` with `docker compose`.
