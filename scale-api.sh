#!/bin/sh
# Usage: ./scale-api.sh N   -->  run exactly N API replicas behind NGINX (Podman)
# (With Docker, use:  docker compose --profile app up -d --scale api=N  and restart nginx)
set -e
N=${1:?usage: ./scale-api.sh N}

podman-compose --profile app up -d --scale api="$N" --no-recreate

# podman-compose does not remove extra replicas when scaling down
for name in $(podman ps -a --format '{{.Names}}' | grep '^app_api_'); do
  [ "${name##*_}" -gt "$N" ] && podman rm -f "$name" >/dev/null
done

# NGINX looks up the replicas' addresses only when its configuration is (re)loaded
podman exec app_nginx_1 nginx -s reload 2>/dev/null || podman restart app_nginx_1 >/dev/null
echo "api replicas now: $(podman ps --format '{{.Names}}' | grep -c '^app_api_')"
