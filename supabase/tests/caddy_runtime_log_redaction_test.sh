#!/usr/bin/env bash
set -euo pipefail

container_name="edulog-caddy-auth-log-test-${GITHUB_RUN_ID:-local}-$$"
log_file="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/${container_name}.log"
password_hash="$(docker run --rm caddy:2 caddy hash-password --plaintext test-password)"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -f "$log_file"
}
trap cleanup EXIT

docker run --detach --name "$container_name" \
  --publish 127.0.0.1:18089:8080 \
  --volume "$PWD/supabase/volumes/proxy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  --env "PROXY_DOMAIN=http://localhost:8081" \
  --env "EDULOG_PROXY_DOMAIN=http://localhost:8080" \
  --env "EDULOG_PROXY_UPSTREAM_URL=https://127.0.0.1:9" \
  --env "EDULOG_HSTS_HEADER=max-age=31536000" \
  --env "EDULOG_CSP_HEADER=default-src 'self'" \
  --env "PROXY_AUTH_USERNAME=ci" \
  --env "PROXY_AUTH_PASSWORD=$password_hash" \
  caddy:2 >/dev/null

status=""
for attempt in $(seq 1 30); do
  status="$(curl --silent --show-error --max-time 2 --output /dev/null --write-out '%{http_code}' \
    --header 'Host: localhost:8080' \
    'http://127.0.0.1:18089/api/auth/confirm?token_hash=CANARY_TOKEN&code=CANARY_CODE&state=CANARY_STATE&type=recovery' || true)"
  if [[ "$status" == "502" ]]; then
    break
  fi
  sleep 1
done

docker logs "$container_name" >"$log_file" 2>&1
if [[ "$status" != "502" ]]; then
  cat "$log_file"
  echo "Caddy smoke request did not reach the expected failing upstream (HTTP $status)" >&2
  exit 1
fi

for key in token_hash code state; do
  if ! grep -Fq "$key=REDACTED" "$log_file"; then
    cat "$log_file"
    echo "Caddy runtime error log did not redact the $key query value" >&2
    exit 1
  fi
done

if grep -Eq 'CANARY_TOKEN|CANARY_CODE|CANARY_STATE' "$log_file"; then
  cat "$log_file"
  echo "Caddy runtime error log exposed a single-use auth query value" >&2
  exit 1
fi

echo "Caddy runtime error logs redact token_hash, code, and state."
