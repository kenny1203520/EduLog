# Upgrading EduLog's self-hosted Supabase stack

> 繁體中文版：[supabase-upgrade.zh-TW.md](supabase-upgrade.zh-TW.md)

This guide is for EduLog deployments that still run the **January 2026 Supabase set** (Studio `2026.01.27-sha-6aa59ff`, Kong `2.8.1`, GoTrue `v2.185.0`, Postgres `15.8.1.085`, and so on). It takes them to the **Supabase self-hosted release `self-hosted/v0.8.4` (2026-11-05)**, the latest at the time of writing (2026-11-09).

## Why the official `update.sh` cannot be used

Upstream now updates installs with `sh update.sh` (a three-way merge against `self-hosted/v*` tags) and starts them with `run.sh`. Both expect the upstream `docker/` layout. EduLog differs from that layout in four ways:

| Upstream | EduLog |
|---|---|
| `docker-compose.yml` sits next to `./volumes/` | `docker-compose.yml` is at the repo root; volumes are under `./supabase/volumes/` |
| Containers are named `supabase-*` | Containers are named `edulog-*` |
| Only Supabase services | Also runs `api`, `edulog`, and the `net` / `frontend` networks |
| `utils/upgrade-pg17.sh` expects `supabase-db` and `./volumes/db` | Neither name nor path matches |

So the upgrade is done by hand, using the upstream `v0.8.4` files as the reference. The Postgres script needs small, explicit patches (see Phase 2).

### Shortcut when you deploy from this repository

The EduLog repository already contains the v0.8.4 set, adapted to EduLog's layout:

- `docker-compose.yml`, `docker-compose.prod.yml`, and the `supabase/docker-compose.*.yml` overlays
- `supabase/volumes/` (gateway, pooler, and DB init files)
- `.env.example`
- `supabase/utils/upgrade-pg17.sh`, already patched for EduLog

If your deployment is a checkout of this repository and you have not edited those files, you can skip the manual edits in Phase 1:

1. Back up (1.2).
2. Update the checkout.
3. Update `.env` (1.5).
4. Run 1.7 and 1.8.

For Phase 2, use the script that is already in the repository (2.2).

Before updating the checkout, keep your own edits to compose files or `supabase/volumes/` with `git stash` or a branch. Re-apply them afterwards.

What the repository does differently from upstream:

- **Postgres:** stays on 15 in `docker-compose.yml`. PG17 lives in `supabase/docker-compose.pg17.yml`.
- **Gateway:** Envoy has no basic auth, and its port is bound to `127.0.0.1`. The Caddy and nginx overlays provide the Studio login.
- **Removed services:** Edge Functions are gone, and analytics and Vector are only in `supabase/docker-compose.logs.yml`.

## Plan: two maintenance windows

| Phase | What changes | Downtime | Can you roll back? |
|---|---|---|---|
| **Phase 1** | Every service except Postgres moves to v0.8.4. Postgres stays on your current 15.x tag (`15.8.1.085`, which is upstream's PG15 pin, or `15.14.1.112` from EduLog alpha.3 and later). | Minutes | Only by restoring the backup: Storage and Auth migrations are one-way |
| **Phase 2** | Postgres 15 → 17 (`17.6.1.136`) with `pg_upgrade` | Depends on database size; the whole stack is down | Yes: the script keeps `data.bak.pg15` |

Run Phase 2 only after Phase 1 has been stable for a while. Rehearse both phases first on a copy: a VM snapshot, or a staging host with a copy of `supabase/volumes/`.

## Version changes

| Service | Current | v0.8.4 | Notes |
|---|---|---|---|
| studio | 2026.01.27-sha-6aa59ff | **2026.11.02-sha-a05e7ec** | |
| API gateway | kong:2.8.1 | **envoyproxy/envoy:v1.39.6** (default) or kong/kong:3.9.3 | Service renamed `kong` → `api-gw` |
| auth (gotrue) | v2.185.0 | **v2.197.0** | |
| rest (postgrest) | v14.3 | **v14.18** | |
| realtime | v2.72.0 | **v2.148.3** | Includes security fixes |
| storage-api | v1.33.5 | **v1.89.12** | One-way DB migrations; security fixes |
| imgproxy | v3.30.1 | **v4.0.21** | Major version; some env vars are ignored |
| postgres-meta | v0.95.2 | **v0.100.0** | |
| edge-runtime | v1.74.0 | v1.77.9 | **EduLog: remove** (Edge Functions are no longer used) |
| logflare (analytics) | 1.30.3 | 1.50.15 (optional) | No longer in the default stack. Do not use ≥ 1.52.0 |
| vector | 0.28.1-alpine | 0.53.0-alpine (optional) | Optional, together with analytics |
| supavisor | 2.7.4 | **2.9.13** | |
| postgres | 15.8.1.085 or 15.14.1.112 | Phase 1: **keep your current 15.x tag**; Phase 2: **17.6.1.136** | EduLog v2.0.0-alpha.3 and later ship 15.14.1.112. Never move to an older Postgres image |

## Breaking changes that affect EduLog

| Upstream change (release) | What it means for EduLog | Action |
|---|---|---|
| Gateway blocks Realtime `/api/tenants` and `/api/openapi` (0.6.0, security) | Your Kong 2.8.1 `kong.yml` does not have this block | Replace the gateway config with the v0.8.4 files |
| Envoy replaces Kong; service renamed to `api-gw`, with network aliases `kong` and `envoy` (0.8.0) | `api` uses `http://kong:8000`. The alias keeps that URL working, but `depends_on: kong` and the `kong:` block in `docker-compose.prod.yml` will break | Rename those references to `api-gw` |
| Analytics and Vector removed from the default stack (0.5.0) | Many services have `depends_on: analytics`, and `db` depends on `vector` | Remove those dependencies and both services, or keep them with the logs override |
| `API_EXTERNAL_URL` now includes `/auth/v1`; `GOTRUE_JWT_ISSUER` added (0.5.0 / 0.7.0) | The `iss` claim in new access tokens may change | Update `.env`, then check `SUPABASE_JWT_ISSUER` in `server/.env` |
| Storage settings come from env vars (`STORAGE_TENANT_ID`, `GLOBAL_S3_BUCKET`, `REGION`) | Your files are stored under `supabase/volumes/storage/stub/stub/…` | **All three must stay `stub`**, or existing files become unreachable |
| `REALTIME_DB_ENC_KEY` added (0.7.0) | It must equal the old hard-coded `supabaserealtime` | Set it to `supabaserealtime` |
| Storage migrations are one-way (0.8.3) | After the new Storage starts, the old image cannot upload files | Back up first; roll back only by restoring that backup |
| imgproxy v4 silently ignores some old env vars (0.8.4) | `IMGPROXY_ENABLE_WEBP_DETECTION` is the old name | Use `IMGPROXY_AUTO_WEBP` |
| Studio and meta connect as `postgres` instead of `supabase_admin` (0.6.0) | Needs object ownership reassigned. Studio is not public in EduLog production | **Keep `supabase_admin` for now** (optional; see the end of this guide) |
| `app.settings.jwt_secret` removed from DB init (0.8.2) | Affects new installs only; EduLog migrations do not use it | Replace `jwt.sql` |
| Edge Functions CORS and memory limit (0.8.4) | EduLog removed Edge Functions | Remove the `functions` service |

---

## Phase 1: every service except Postgres

All commands run on the deployment host, from the EduLog deployment directory (where `docker-compose.yml` and `.env` are). Production uses the prod override, so define:

```bash
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
```

If you do not use `docker-compose.prod.yml`, use `DC="docker compose"`.

### 1.1 Prerequisites

- Docker Compose v2.24 or newer. The override files use `!reset` and `!override`.
- Free disk space of at least 2 × the size of `supabase/volumes/` (for the backup).
- Check the actual Storage tenant directory name. This decides the value of `STORAGE_TENANT_ID` later:

```bash
ls supabase/volumes/storage/
```

It is normally `stub`. If it shows another name, use that name instead of `stub` for `STORAGE_TENANT_ID` below.

### 1.2 Backup (required)

Take a logical backup and copy the config while the stack is still running:

```bash
BK=~/edulog-backup-$(date +%Y%m%d-%H%M)
mkdir -p "$BK"
docker exec edulog-db pg_dumpall -h localhost -U supabase_admin > "$BK/pg15_dumpall.sql"
cp -a docker-compose*.yml .env "$BK/"
cp -a server/.env "$BK/server.env"
tar -czf "$BK/supabase-config.tgz" --exclude='supabase/volumes/db/data' --exclude='supabase/volumes/storage' supabase/volumes
docker run --rm -v supabase_db-config:/src:ro -v "$BK":/dst alpine cp /src/pgsodium_root.key /dst/pgsodium_root.key.backup
```

The cold data backup (DB data directory and Storage files) is taken in 1.7, after the stack is stopped.

> ⚠️ Never run `docker compose down -v`. The `supabase_db-config` volume holds the pgsodium/Vault key. If it is deleted, encrypted data cannot be recovered.

### 1.3 Get the upstream v0.8.4 files

```bash
git clone --depth 1 --branch self-hosted/v0.8.4 --filter=blob:none --sparse \
  https://github.com/supabase/supabase ~/supabase-v0.8.4
git -C ~/supabase-v0.8.4 sparse-checkout set docker
UP=~/supabase-v0.8.4/docker
```

Keep `$UP/docker-compose.yml` open beside you while editing. It is the reference for every service block below.

### 1.4 Replace the config files under `supabase/volumes/`

Prefer the files from this repository's `supabase/volumes/`. They are v0.8.4 with EduLog's changes merged in: no Edge Functions routes, and no Envoy basic auth. Copy from upstream only if you cannot use the repository:

```bash
# API gateway (Envoy, the default)
mkdir -p supabase/volumes/api/envoy
cp $UP/volumes/api/envoy/{envoy.yaml,cds.yaml,lds.template.yaml,docker-entrypoint.sh} supabase/volumes/api/envoy/
# Also update the Kong files, so the Kong option keeps working
cp $UP/volumes/api/kong.yml $UP/volumes/api/kong-entrypoint.sh supabase/volumes/api/
# Supavisor now reads POSTGRES_HOST
cp $UP/volumes/pooler/pooler.exs supabase/volumes/pooler/pooler.exs
# DB init scripts (only used on an empty data directory; harmless for an existing DB)
cp $UP/volumes/db/*.sql supabase/volumes/db/
```

If you edited any of these files yourself, diff them against the upstream versions first (`diff -u old new`) and merge your edits back in.

### 1.5 Update `.env`

| Variable | Change |
|---|---|
| `API_EXTERNAL_URL` | Append `/auth/v1`, e.g. `https://edulog.example.com/auth/v1` |
| `API_GW_HTTP_PORT` | Add (`8000`). It falls back to `KONG_HTTP_PORT` when unset |
| `REALTIME_DB_ENC_KEY` | Add: `supabaserealtime` (**must not change**; it must be exactly 16 characters) |
| `STORAGE_TENANT_ID` / `GLOBAL_S3_BUCKET` / `REGION` | Add: `stub` / `stub` / `stub` (or the directory name you found in 1.1) |
| `S3_PROTOCOL_ACCESS_KEY_ID` / `S3_PROTOCOL_ACCESS_KEY_SECRET` | Add. Generate them with `openssl rand -hex 16` and `openssl rand -hex 32` |
| `IMGPROXY_ENABLE_WEBP_DETECTION` | Delete. Add `IMGPROXY_AUTO_WEBP=true` |
| `PGRST_DB_MAX_ROWS` / `PGRST_DB_EXTRA_SEARCH_PATH` | Optional: `1000` / `public` |
| `PGRST_DB_SCHEMAS` | `public,graphql_public` (the new default). This stops exposing the `storage` schema over REST; the EduLog API does not use it |
| `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `JWT_KEYS`, `JWT_JWKS`, `ANON_KEY_ASYMMETRIC`, `SERVICE_ROLE_KEY_ASYMMETRIC` | Add them empty. Empty means legacy HS256 keys, as before |

Leave the existing secrets as they are: `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`, `VAULT_ENC_KEY`, `SECRET_KEY_BASE`, and `PG_META_CRYPTO_KEY`.

**`server/.env`:** if `SUPABASE_JWT_ISSUER` has a value, clear it for now. After 1.8, decode a freshly issued access token, copy its `iss` value into `SUPABASE_JWT_ISSUER`, and recreate the `api` container. Users who are already signed in may have to sign in again.

### 1.6 Update `docker-compose.yml`

Keep EduLog's `container_name: edulog-*` values and the `networks:`. Change each service as described below. Copy each environment block from `$UP/docker-compose.yml`, changing only paths (`./volumes/` → `./supabase/volumes/`) and hostnames (`api-gw`).

**Every service:** delete every `depends_on: analytics:` entry. In `db`, delete `depends_on: vector:`.

**studio**

```yaml
    image: supabase/studio:2026.11.02-sha-a05e7ec
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/api/platform/profile').then((r) => {if (r.status !== 200) throw new Error(r.status)})\""]
      timeout: 10s
      interval: 5s
      retries: 3
      start_period: 20s
    environment:
      HOSTNAME: "0.0.0.0"                       # was "::"
      SUPABASE_URL: http://api-gw:8000           # was http://kong:8000
      PGRST_DB_SCHEMAS: ${PGRST_DB_SCHEMAS}
      PGRST_DB_MAX_ROWS: ${PGRST_DB_MAX_ROWS:-1000}
      PGRST_DB_EXTRA_SEARCH_PATH: ${PGRST_DB_EXTRA_SEARCH_PATH:-public}
      SUPABASE_PUBLISHABLE_KEY: ${SUPABASE_PUBLISHABLE_KEY:-}
      SUPABASE_SECRET_KEY: ${SUPABASE_SECRET_KEY:-}
      ENABLED_FEATURES_LOGS_ALL: "false"
      # Delete: LOGFLARE_API_KEY, LOGFLARE_*_ACCESS_TOKEN, LOGFLARE_URL,
      #         NEXT_PUBLIC_ENABLE_LOGS, NEXT_ANALYTICS_BACKEND_PROVIDER,
      #         EDGE_FUNCTIONS_MANAGEMENT_FOLDER
      # Do not add POSTGRES_USER_READ_WRITE: postgres yet (see "Optional follow-ups")
    volumes:
      - ./supabase/volumes/snippets:/app/snippets:Z
      # Delete the ./supabase/volumes/functions mount
```

**kong → api-gw (Envoy, recommended).** Delete the whole `kong:` service and add:

```yaml
  api-gw:
    container_name: edulog-envoy
    image: envoyproxy/envoy:v1.39.6
    restart: unless-stopped
    networks:
      net:
        aliases: [kong, envoy]   # keeps http://kong:8000 working for the EduLog API
      frontend:
        aliases: [kong, envoy]   # only needed if something on frontend calls the gateway; otherwise remove
    healthcheck:
      test: ["CMD-SHELL", "timeout 1 bash -c '</dev/tcp/127.0.0.1/8000'"]
      interval: 10s
      timeout: 5s
      retries: 3
    depends_on:
      studio:
        condition: service_healthy
    # Host-only; the prod, Caddy, and nginx overrides reset it.
    ports:
      - 127.0.0.1:${API_GW_HTTP_PORT:-${KONG_HTTP_PORT:-8000}}:8000/tcp
    volumes:
      - ./supabase/volumes/api/envoy/envoy.yaml:/etc/envoy/envoy.yaml:ro
      - ./supabase/volumes/api/envoy/cds.yaml:/etc/envoy/cds.yaml:ro
      - ./supabase/volumes/api/envoy/lds.template.yaml:/etc/envoy/lds.template.yaml:ro
      - ./supabase/volumes/api/envoy/docker-entrypoint.sh:/docker-entrypoint.sh:ro
    environment:
      ANON_KEY: ${ANON_KEY}
      SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      SUPABASE_PUBLISHABLE_KEY: ${SUPABASE_PUBLISHABLE_KEY:-}
      SUPABASE_SECRET_KEY: ${SUPABASE_SECRET_KEY:-}
      ANON_KEY_ASYMMETRIC: ${ANON_KEY_ASYMMETRIC:-}
      SERVICE_ROLE_KEY_ASYMMETRIC: ${SERVICE_ROLE_KEY_ASYMMETRIC:-}
      SUPABASE_PUBLIC_URL: ${SUPABASE_PUBLIC_URL}
    entrypoint: ["/bin/sh", "/docker-entrypoint.sh"]
```

> **EduLog's Envoy files differ from upstream.** EduLog's `lds.template.yaml` has no SHA1 basic-auth filter and no Edge Functions route. The Studio login comes from the Caddy or nginx overlay instead. If you copied the upstream Envoy files in 1.4, take `supabase/volumes/api/envoy/` from this repository instead. Otherwise, add `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` to the environment above, because the upstream files need them.

> **Staying on Kong.** Keep the service name `api-gw` and the same `networks` and aliases. Then use `container_name: edulog-kong`, `image: kong/kong:3.9.3`, and copy healthcheck, volumes, environment, and entrypoint from `$UP/docker-compose.kong.yml`, with paths changed to `./supabase/volumes/api/…`. Note that `KONG_ROUTER_FLAVOR: expressions` and `KONG_DECLARATIVE_CONFIG: /usr/local/kong/kong.yml` are required. Upstream has announced that the Kong override will be removed, so Envoy is the long-term choice.

**auth**

```yaml
    image: supabase/gotrue:v2.197.0
    environment:
      GOTRUE_JWT_ISSUER: ${API_EXTERNAL_URL}    # new; API_EXTERNAL_URL now ends in /auth/v1
```

**rest**

```yaml
    image: postgrest/postgrest:v14.18
    healthcheck:
      test: ["CMD", "postgrest", "--ready"]
      interval: 5s
      timeout: 5s
      retries: 3
    environment:
      PGRST_DB_MAX_ROWS: ${PGRST_DB_MAX_ROWS:-1000}
      PGRST_DB_EXTRA_SEARCH_PATH: ${PGRST_DB_EXTRA_SEARCH_PATH:-public}
      PGRST_ADMIN_SERVER_PORT: 3001              # required by --ready
      PGRST_ADMIN_SERVER_HOST: localhost
      PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}
      # Delete PGRST_APP_SETTINGS_JWT_SECRET
```

**realtime**

```yaml
    image: supabase/realtime:v2.148.3
    environment:
      DB_ENC_KEY: ${REALTIME_DB_ENC_KEY:-supabaserealtime}
      METRICS_JWT_SECRET: ${JWT_SECRET}
```

**storage**

```yaml
    image: supabase/storage-api:v1.89.12
    healthcheck:
      # same test as before; add:
      start_period: 10s
    environment:
      AUTH_JWT_SECRET: ${JWT_SECRET}             # replaces PGRST_JWT_SECRET
      STORAGE_PUBLIC_URL: ${SUPABASE_PUBLIC_URL}
      GLOBAL_S3_BUCKET: ${GLOBAL_S3_BUCKET}      # was the literal stub
      TENANT_ID: ${STORAGE_TENANT_ID}            # was the literal stub
      REGION: ${REGION}                          # was the literal stub
      S3_PROTOCOL_ACCESS_KEY_ID: ${S3_PROTOCOL_ACCESS_KEY_ID}
      S3_PROTOCOL_ACCESS_KEY_SECRET: ${S3_PROTOCOL_ACCESS_KEY_SECRET}
```

**imgproxy**

```yaml
    image: darthsim/imgproxy:v4.0.21
    environment:
      IMGPROXY_AUTO_WEBP: ${IMGPROXY_AUTO_WEBP}  # replaces IMGPROXY_ENABLE_WEBP_DETECTION
```

**meta:** `image: supabase/postgres-meta:v0.100.0`. Keep `PG_META_DB_USER: supabase_admin` for now.

**functions:** delete the service, and delete `deno-cache:` from the top-level `volumes:`. Only if you added Edge Functions of your own: port the upstream block (`mem_limit: ${FUNCTIONS_MEMORY_LIMIT:-2g}`, the new healthcheck, `SUPABASE_URL: http://api-gw:8000`) together with `volumes/functions/main/`, and add CORS handling inside your functions. From 0.8.4 the gateway no longer adds CORS headers for them.

**analytics and vector:** delete both services. To keep logs in Studio, adapt `$UP/docker-compose.logs.yml` (logflare `1.50.15`, not ≥ 1.52.0) and remove the public `4000:4000` port.

**db (Phase 1 keeps PG15)**

```yaml
    image: supabase/postgres:15.8.1.085           # unchanged: keep whatever 15.x tag you run now
    # Delete depends_on: vector
    environment:
      # Delete JWT_SECRET (the new jwt.sql no longer uses it)
      JWT_EXP: ${JWT_EXPIRY}
```

**supavisor**

```yaml
    image: supabase/supavisor:2.9.13
    environment:
      POSTGRES_HOST: ${POSTGRES_HOST}            # new; used by the new pooler.exs
```

**api (EduLog)**

```yaml
    depends_on:
      api-gw:                                    # was kong
        condition: service_healthy
```

Leave `SUPABASE_URL` / `EDULOG_SUPABASE_INTERNAL_URL` as `http://kong:8000`, because the `kong` alias still resolves. The `api` service must stay on the `net` network.

### 1.6b Update `docker-compose.prod.yml`

An override that names a service missing from the base file fails `docker compose config`. So:

```yaml
  api-gw:            # was kong:
    ports: !reset []
  # Delete the analytics: block (unless you kept analytics)
```

### 1.7 Validate, pull, stop, back up data, start

```bash
$DC config -q && echo "compose OK"
$DC pull                     # the old stack keeps running during the download
$DC down                     # no -v!
sudo tar -czpf "$BK/supabase-data.tgz" supabase/volumes/db/data supabase/volumes/storage
$DC up -d db
docker inspect -f '{{.State.Health.Status}}' edulog-db   # wait until it says healthy
$DC up -d --remove-orphans   # --remove-orphans removes the old kong/analytics/vector/functions containers
```

### 1.8 Verify

```bash
$DC ps                                              # every service up/healthy
docker logs edulog-storage 2>&1 | tail -n 30         # Storage migrations finished, no errors
docker logs edulog-auth 2>&1 | tail -n 30
docker logs edulog-envoy 2>&1 | tail -n 30           # or edulog-kong
docker exec edulog-api node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>console.log(r.status))"   # 200
# Security fix in place: this must not return 200
docker exec edulog-api node -e "fetch('http://kong:8000/realtime/v1/api/tenants').then(r=>console.log(r.status))"
```

Then check in the browser:

- Sign in, and sign out.
- Open a report and edit it from two windows at once (Realtime collaboration).
- Upload an attachment or image and open it again (Storage and imgproxy).
- Open files uploaded **before** the upgrade. If they fail, `STORAGE_TENANT_ID`, `GLOBAL_S3_BUCKET`, or `REGION` is wrong.

### 1.9 Roll back Phase 1

Storage and Auth migrations do not reverse, so you cannot go back by changing image tags alone:

```bash
$DC down
sudo rm -rf supabase/volumes/db/data supabase/volumes/storage
sudo tar -xzpf "$BK/supabase-data.tgz"
tar -xzf "$BK/supabase-config.tgz"
cp "$BK"/docker-compose*.yml "$BK/.env" .
cp "$BK/server.env" server/.env
$DC up -d
```

---

## Phase 2: Postgres 15 → 17

### 2.1 Before you start

- Phase 1 is finished and stable.
- You have root (`sudo`), `bash`, `curl`, and `setfacl` (Debian/Ubuntu: `apt install acl`).
- Free disk space is at least 2 × the database size + 5 GB.
- All containers are running.
- No unsupported extensions are installed. If this query returns rows and you need those extensions, **stop here**:

```bash
docker exec edulog-db psql -h localhost -U supabase_admin -d postgres -Atc \
  "select extname from pg_extension where extname in ('timescaledb','plv8','plcoffee','plls');"
```

- There are no replication slots. EduLog does not use any by default:

```bash
docker exec edulog-db psql -h localhost -U supabase_admin -d postgres -Atc "select slot_name from pg_replication_slots;"
```

- Take a fresh backup, as in 1.2.

### 2.2 Get a script that matches EduLog's layout

**From this repository (recommended).** `supabase/utils/upgrade-pg17.sh` is the v0.8.4 script, already adapted for EduLog:

- It targets `edulog-db` and `./supabase/volumes/db`.
- It reads `supabase/docker-compose.pg17.yml` (`17.6.1.136`).

Run it from the repository root:

```bash
sudo bash supabase/utils/upgrade-pg17.sh
```

Then continue at 2.4. In 2.4, there is no root `docker-compose.pg17.yml` to delete.

**Without the repository:** patch the upstream script yourself:

```bash
mkdir -p ~/edulog-pg17
curl -fsSL https://raw.githubusercontent.com/supabase/supabase/self-hosted/v0.8.4/docker/utils/upgrade-pg17.sh \
  -o ~/edulog-pg17/upgrade-pg17.sh
sed -i \
  -e 's/^DB_CONTAINER="supabase-db"/DB_CONTAINER="edulog-db"/' \
  -e 's#\./volumes/db#./supabase/volumes/db#g' \
  -e 's#\$(pwd)/volumes/db#$(pwd)/supabase/volumes/db#g' \
  ~/edulog-pg17/upgrade-pg17.sh
grep -n 'DB_CONTAINER=\|volumes/db' ~/edulog-pg17/upgrade-pg17.sh   # every path should now point to ./supabase/volumes/db
printf 'services:\n  db:\n    image: supabase/postgres:17.6.1.136\n' > docker-compose.pg17.yml
```

Read the patched script once before running it. It runs as root.

### 2.3 Run

```bash
sudo bash ~/edulog-pg17/upgrade-pg17.sh
```

The script stops the whole stack and runs `pg_upgrade` in temporary containers. It then starts the stack with `docker compose -f docker-compose.yml -f docker-compose.pg17.yml up -d`. Because that command does not include the prod override, the ports from the base file are published for a short time.

The original data is kept at `supabase/volumes/db/data.bak.pg15`, and the pgsodium key at `supabase/volumes/db/pgsodium_root.key.bak.pg15`.

### 2.4 Make PG17 permanent and verify

1. In `docker-compose.yml`, change `db.image` to `supabase/postgres:17.6.1.136`. Alternatively, add `-f supabase/docker-compose.pg17.yml` to `$DC` permanently.
2. If you used the manual patch, delete the root `docker-compose.pg17.yml`.
3. Restart and check:

```bash
$DC up -d --remove-orphans
docker exec edulog-db psql -U postgres -c "select version();"     # PostgreSQL 17.6
```

4. Repeat the checks from 1.8.
5. Once everything works, clean up. **After this, you can no longer roll back:**

```bash
sudo rm -rf supabase/volumes/db/data.bak.pg15 supabase/volumes/db/pgsodium_root.key.bak.pg15 supabase/volumes/db/pg17_upgrade_bin_*.tar.gz
```

### 2.5 Roll back Phase 2

```bash
$DC down
sudo rm -rf supabase/volumes/db/data
sudo mv supabase/volumes/db/data.bak.pg15 supabase/volumes/db/data
# Set db.image back to your previous 15.x tag, and drop docker-compose.pg17.yml from your -f files
docker compose run --rm db chown -R postgres:postgres /etc/postgresql-custom/   # PG15 and PG17 use different UIDs
$DC up -d
```

---

## Optional follow-ups

- **Studio and meta without superuser:** follow upstream's [Remove superuser access](https://supabase.com/docs/guides/self-hosting/remove-superuser-access) guide. Run `supabase/utils/reassign-owner.sh` (use the v0.8.4 version, and adjust the container name). Then set `POSTGRES_USER_READ_WRITE: postgres` and `PG_META_DB_USER: postgres`.
- **New API keys and asymmetric JWT:** see upstream's auth keys guide and `utils/add-new-auth-keys.sh`. If you enable them, the EduLog API's token verification (`SUPABASE_JWT_SECRET`) must be updated as well. Treat that as a separate change.

## Sources

- [Supabase self-hosted CHANGELOG](https://github.com/supabase/supabase/blob/master/docker/CHANGELOG.md)
- [Supabase self-hosted versions.md](https://github.com/supabase/supabase/blob/master/docker/versions.md)
- [`self-hosted/v0.8.4`: docker-compose.yml, docker-compose.kong.yml, docker-compose.logs.yml, docker-compose.pg15.yml, upgrades.json](https://github.com/supabase/supabase/tree/self-hosted/v0.8.4/docker)
- [Update your self-hosted deployment](https://supabase.com/docs/guides/self-hosting/updating)
- [Upgrade to Postgres 17](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17)
- [Self-hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [0.7.0 migration notes (discussion #47093)](https://github.com/orgs/supabase/discussions/47093)
- [0.8.0 migration notes (discussion #48048)](https://github.com/orgs/supabase/discussions/48048)
