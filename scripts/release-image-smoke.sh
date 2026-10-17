#!/usr/bin/env bash
set -euo pipefail
export MSYS_NO_PATHCONV=1

# Isolated containers with placeholder credentials; no production database access.
network="edulog-release-smoke-${RANDOM}-$$"
api="${network}-api"
frontend="${network}-frontend"
cleanup() {
  docker rm -f "$frontend" "$api" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run -d --name "$api" --network "$network" --network-alias api \
  -e SUPABASE_URL=http://127.0.0.1:54321 \
  -e SUPABASE_ANON_KEY=release-smoke-anon \
  -e SUPABASE_SERVICE_ROLE_KEY=release-smoke-service \
  -e COOKIE_SECRET=release-smoke-cookie-secret-at-least-32-characters \
  -e API_ALLOWED_ORIGINS=http://localhost:4173 \
  -e RATE_LIMIT_STORE=supabase edulog-release-smoke:api >/dev/null
docker run -d --name "$frontend" --network "$network" \
  -e VITE_API_V1_MODE=v1 edulog-release-smoke:frontend >/dev/null

for attempt in {1..30}; do
  if docker exec "$api" node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1 \
    && docker exec "$frontend" wget -q -O /dev/null http://127.0.0.1:4173/healthz >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    docker logs "$api"
    docker logs "$frontend"
    exit 1
  fi
  sleep 2
done
docker exec "$frontend" wget -q -O /dev/null http://127.0.0.1:4173/
docker exec "$frontend" wget -q -O - http://127.0.0.1:4173/api/healthz | grep -q '"status":"ok"'
docker exec "$frontend" wget -q -O - http://127.0.0.1:4173/runtime-config.js | grep -q '"v1"'
version="$(node -p "require('./app/package.json').version")"
docker exec "$frontend" grep -r -q "$version" /usr/share/nginx/html/assets
docker exec "$api" node -e "fetch('http://127.0.0.1:3000/api/student-schools').then(r=>{if(r.status!==401)process.exit(1)}).catch(()=>process.exit(1))"
echo 'Frontend/API image health, proxy, runtime configuration and authentication boundary passed.'
