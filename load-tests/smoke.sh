#!/bin/sh
# One visitor through the whole flow, via NGINX. Needs the stack up and `pnpm seed 500` done.
cd "$(dirname "$0")/.."
podman run --rm --network host -v "$PWD/load-tests:/scripts:ro,Z" \
  docker.io/grafana/k6:latest run --quiet --no-usage-report /scripts/smoke.js
