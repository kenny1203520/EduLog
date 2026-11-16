#!/usr/bin/env bash
set -euo pipefail

fixture="edulog-auth-smoke-${RANDOM}-$$"
cleanup() {
  docker rm -f "$fixture-auth" "$fixture-db" >/dev/null 2>&1 || true
  docker network rm "$fixture" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fixture_secret=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
docker network create "$fixture" >/dev/null
docker run -d --name "$fixture-db" --network "$fixture" --tmpfs /var/lib/postgresql/data \
  -e "POSTGRES_PASSWORD=$fixture_secret" postgres:15 >/dev/null
for ((attempt=0; attempt<30; attempt++)); do
  if docker exec "$fixture-db" pg_isready -U postgres >/dev/null; then break; fi
  sleep 1
done
docker exec "$fixture-db" psql -U postgres -v ON_ERROR_STOP=1 \
  -c 'CREATE SCHEMA auth; ALTER ROLE postgres SET search_path = auth, public;' >/dev/null

start_auth() {
  docker run -d --name "$fixture-auth" --network "$fixture" -p 127.0.0.1::9999 \
    -e API_EXTERNAL_URL=http://localhost:9999 -e GOTRUE_SITE_URL=http://localhost:5173 \
    -e GOTRUE_JWT_ISSUER=http://localhost:9999 -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e GOTRUE_DB_DRIVER=postgres \
    -e "GOTRUE_DB_DATABASE_URL=postgres://postgres:$fixture_secret@$fixture-db:5432/postgres?sslmode=disable" \
    -e "GOTRUE_JWT_SECRET=$fixture_secret" -e GOTRUE_JWT_ADMIN_ROLES=service_role \
    -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
    "$@" supabase/gotrue:v2.197.0 >/dev/null
  auth_url="http://$(docker port "$fixture-auth" 9999)"
  node --input-type=module - "$auth_url" <<'JS'
import { setTimeout } from 'node:timers/promises'
const health = new URL('/health', process.argv[2])
for (let attempt = 0; attempt < 30; attempt += 1) {
  const response = await fetch(health, { signal: AbortSignal.timeout(2_000) }).catch(() => undefined)
  if (response?.ok) process.exit(0)
  await setTimeout(1_000)
}
throw new Error('GoTrue did not become ready')
JS
}

start_auth
AUTH_SMOKE_TEST_URL="$auth_url" AUTH_SMOKE_TEST_JWT_SECRET="$fixture_secret" \
  node "$(dirname "$0")/auth-gotrue-smoke.mjs"

docker rm -f "$fixture-auth" >/dev/null
fixture_jwk=$(node --input-type=module <<'JS'
import { generateKeyPairSync } from 'node:crypto'
const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' })
console.log(JSON.stringify({ ...key, alg: 'ES256', kid: 'fixture-es256', use: 'sig', key_ops: ['sign', 'verify'] }))
JS
)
GOTRUE_JWT_KEYS="[$fixture_jwk]" start_auth -e GOTRUE_JWT_KEYS \
  -e GOTRUE_OAUTH_SERVER_ENABLED=true -e GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH=/oauth/consent
AUTH_SMOKE_TEST_URL="$auth_url" AUTH_SMOKE_TEST_ADMIN_JWK="$fixture_jwk" \
  node "$(dirname "$0")/auth-gotrue-outbound-smoke.mjs"
