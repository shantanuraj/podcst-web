#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
image=${1:?Usage: scripts/test-container.sh IMAGE}
prefix="podcst-smoke-$$-$RANDOM"
network="$prefix-network"
database="$prefix-db"
redis="$prefix-redis"
web="$prefix-web"

cleanup() {
  local status=$?
  if (( status != 0 )); then docker logs "$web" 2>/dev/null || true; fi
  docker rm -f "$web" "$database" "$redis" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker network create "$network" >/dev/null
docker run -d --network "$network" --name "$database" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
docker run -d --network "$network" --name "$redis" redis:7-alpine >/dev/null

for attempt in {1..30}; do
  if docker exec "$database" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$database" pg_isready -h 127.0.0.1 -U postgres
for migration in migrations/active/*.sql scripts/fixtures/web-smoke.sql; do
  docker exec -i "$database" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 \
    --single-transaction -q < "$migration"
done

docker run -d --network "$network" --name "$web" -p 127.0.0.1::3000 \
  -e "DATABASE_URL=postgres://postgres@$database:5432/postgres" \
  -e "REDIS_URL=redis://$redis:6379" "$image" >/dev/null
binding=$(docker port "$web" 3000/tcp)
base="http://127.0.0.1:${binding##*:}"
for attempt in {1..30}; do
  if curl --fail --silent --max-time 2 "$base/api/health" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent --show-error --max-time 5 "$base/api/health"
printf '\n'
SSR_TEST_BASE_URL="$base" bun --no-env-file test src/app/ssr.integration.test.ts
