#!/bin/sh
# Usage: ./load-tests/run.sh N [TOTAL] [SECONDS]
#   Starts the stack with N API replicas (load-test settings), runs the flash sale
#   (default: 100000 attempts in 10 s for 500 phones), then checks the database.
# Results are saved in load-tests/results/replicas-N.txt
set -e
cd "$(dirname "$0")/.."

N=${1:?usage: ./load-tests/run.sh N [TOTAL] [SECONDS]}
TOTAL=${2:-100000}
DURATION=${3:-10}
STOCK=500
OUT=load-tests/results/replicas-$N

set -a; . ./.env; set +a      # JWT_SECRET and database credentials
mkdir -p load-tests/results

# --- 1. fresh containers: quiet logs, no per-IP limits (k6 sends everything from one address)
LOG_LEVEL=warn RATE_SESSION=1000000 BURST_SESSION=1000000 RATE_CHECKOUT=1000000 BURST_CHECKOUT=1000000
export LOG_LEVEL RATE_SESSION BURST_SESSION RATE_CHECKOUT BURST_CHECKOUT
# NGINX and the worker depend on the API, so they must go first
for service in nginx worker api; do
  podman ps -aq --filter name=app_${service}_ | xargs -r podman rm -f >/dev/null
done
podman-compose --profile app up -d --build --scale api="$N" >/dev/null 2>&1

echo "waiting for $N API replicas..."
for _ in $(seq 1 60); do
  healthy=$(podman ps --filter name=app_api_ --filter health=healthy --format '{{.Names}}' | wc -l)
  [ "$healthy" -ge "$N" ] && break
  sleep 2
done
[ "$healthy" -ge "$N" ] || { echo "API replicas did not become healthy"; exit 1; }
podman exec app_nginx_1 nginx -s reload 2>/dev/null   # make sure NGINX knows every replica
sleep 2

# --- 2. clean sale: 500 phones, empty queue; warm the servers up a little
(cd backend && pnpm -s seed "$STOCK" >/dev/null)
podman exec app_rabbitmq_1 rabbitmqctl purge_queue orders >/dev/null 2>&1 || true
for _ in $(seq 1 300); do curl -s -o /dev/null localhost:"${HTTP_PORT:-8080}"/health; done

# --- 3. the spike
echo "running: $TOTAL attempts in ${DURATION}s against $N replicas..."
# k6 joins the compose network and talks to NGINX directly (the published port goes through a slower user-space proxy)
podman run --rm --network app_default --user root --ulimit nofile=500000:500000 \
  -v "$PWD/load-tests:/scripts:ro,Z" -v "$PWD/load-tests/results:/results:Z" \
  -e JWT_SECRET -e TOTAL="$TOTAL" -e SECONDS="$DURATION" -e BASE_URL="http://nginx:80" \
  -e SUMMARY_FILE="/results/replicas-$N.json" \
  docker.io/grafana/k6:latest run --quiet --no-usage-report /scripts/flash-sale.js >"$OUT.k6.log" 2>&1 || true

# --- 4. let the worker finish, then compare the three places that hold the truth
db() { podman exec app_postgres_1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1"; }
queued() { podman exec app_rabbitmq_1 rabbitmqctl -q list_queues name messages | awk '$1=="orders"{print $2}'; }
for _ in $(seq 1 90); do
  [ "$(queued)" = "0" ] && [ "$(db "SELECT count(*) FROM orders WHERE status='pending'")" = "0" ] && break
  sleep 1
done
sleep 1

confirmed=$(db "SELECT count(*) FROM orders WHERE status='confirmed'")
failed=$(db "SELECT count(*) FROM orders WHERE status='failed'")
stock_pg=$(db "SELECT stock FROM products WHERE id=1")
stock_redis=$(podman exec app_redis_1 redis-cli get stock:1)
dead=$(podman exec app_rabbitmq_1 rabbitmqctl -q list_queues name messages | awk '$1=="orders.dead"{print $2}')

{
  echo "== Flash sale: $N API replica(s), $TOTAL attempts in ${DURATION}s, $STOCK phones =="
  echo "API containers running: $(podman ps --filter name=app_api_ -q | wc -l)"
  node load-tests/report.mjs "$OUT.json"
  echo "-- database after the sale --"
  echo "orders confirmed:     $confirmed   (expected $STOCK)"
  echo "orders failed:        $failed"
  echo "stock in Postgres:    $stock_pg   (expected 0)"
  echo "stock in Redis:       $stock_redis   (expected 0)"
  echo "dead-letter messages: ${dead:-0}"
  if [ "$confirmed" = "$STOCK" ] && [ "$stock_pg" = "0" ] && [ "$failed" = "0" ] && [ "${dead:-0}" = "0" ]; then
    echo "RESULT: PASS - exactly $STOCK sold, no oversell"
  else
    echo "RESULT: FAIL - check the numbers above"
  fi
} | tee "$OUT.txt"

# remove the load-test containers, so the next `up` starts with normal settings (logs on, rate limits on)
for service in nginx worker api; do
  podman ps -aq --filter name=app_${service}_ | xargs -r podman rm -f >/dev/null
done
echo "(load-test containers removed; start normally with: podman-compose --profile app up -d)"
