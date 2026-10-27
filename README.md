# Flash Sale System

Flash-sale checkout that sells exactly 500 phones under a 100k-request spike.
Work in progress: the full write-up (architecture, results) comes at the end.

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
