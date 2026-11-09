# 升級 EduLog 的 Self-hosted Supabase

> English version: [supabase-upgrade.md](supabase-upgrade.md)

本指南適用於仍在使用 **2026 年 1 月 Supabase 組合** 的 EduLog 部署（Studio `2026.01.27-sha-6aa59ff`、Kong `2.8.1`、GoTrue `v2.185.0`、Postgres `15.8.1.085` 等），目標是升級到 **Supabase self-hosted 正式版 `self-hosted/v0.8.4`（2026-11-05）**。撰寫本文時（2026-11-09），這是最新版本。

## 為什麼不能直接用官方的 `update.sh`

官方現在的更新方式是 `sh update.sh`（以 `self-hosted/v*` tag 做三方合併），再用 `run.sh` 啟動。這兩支腳本都預設使用官方的 `docker/` 目錄結構，而 EduLog 有四點不同：

| 官方 | EduLog |
|---|---|
| `docker-compose.yml` 與 `./volumes/` 放在同一層 | `docker-compose.yml` 在 repo 根目錄，volumes 在 `./supabase/volumes/` |
| 容器名稱為 `supabase-*` | 容器名稱為 `edulog-*` |
| 只有 Supabase 服務 | 另有 `api`、`edulog` 服務，以及 `net` / `frontend` 網路 |
| `utils/upgrade-pg17.sh` 寫死 `supabase-db` 與 `./volumes/db` | 名稱與路徑都不符合 |

因此本指南採手動方式，以官方 `v0.8.4` 的檔案為基準逐一修改。Postgres 升級腳本只需要明確的少量修補，見第二階段。

### 從本 repo 部署時的捷徑

EduLog repo 已包含依 EduLog 目錄結構調整過的 v0.8.4 組合：

- `docker-compose.yml`、`docker-compose.prod.yml` 與 `supabase/docker-compose.*.yml` 各 overlay
- `supabase/volumes/`（gateway、pooler 與 DB 初始化檔）
- `.env.example`
- 已修補好的 `supabase/utils/upgrade-pg17.sh`

若您的部署就是本 repo 的 checkout，而且沒有改過上述檔案，可以略過第一階段的手動修改：

1. 備份（1.2）。
2. 更新 checkout。
3. 更新 `.env`（1.5）。
4. 執行 1.7 與 1.8。

第二階段則直接使用 repo 內的腳本（見 2.2）。

更新 checkout 前，請先用 `git stash` 或另開分支保留您對 compose 檔或 `supabase/volumes/` 的修改，更新後再套回。

repo 與官方設定的差異：

- **Postgres：** `docker-compose.yml` 維持 15，PG17 放在 `supabase/docker-compose.pg17.yml`。
- **Gateway：** Envoy 不使用 basic auth，port 只綁 `127.0.0.1`，Studio 登入由 Caddy／nginx overlay 提供。
- **移除的服務：** 已移除 Edge Functions；analytics 與 Vector 只在 `supabase/docker-compose.logs.yml` 中。

## 計畫：分兩個維護時段

| 階段 | 內容 | 停機時間 | 能否回復 |
|---|---|---|---|
| **第一階段** | Postgres 以外的所有服務升級到 v0.8.4。Postgres 維持目前使用的 15.x tag（官方 PG15 鎖定的 `15.8.1.085`，或 EduLog alpha.3 以後的 `15.14.1.112`）。 | 數分鐘 | 只能還原備份：Storage 與 Auth 的 migration 是單向的 |
| **第二階段** | 以 `pg_upgrade` 將 Postgres 15 升到 17（`17.6.1.136`） | 視資料庫大小而定，期間整個堆疊停止 | 可以：腳本會保留 `data.bak.pg15` |

第一階段穩定運作一段時間後，再進行第二階段。正式執行前，請先在副本上演練兩個階段：可以用 VM 快照，或在 staging 主機上放一份 `supabase/volumes/` 的副本。

## 版本變動

| 服務 | 目前版本 | v0.8.4 | 備註 |
|---|---|---|---|
| studio | 2026.01.27-sha-6aa59ff | **2026.11.02-sha-a05e7ec** | |
| API gateway | kong:2.8.1 | **envoyproxy/envoy:v1.39.6**（預設）或 kong/kong:3.9.3 | 服務名稱由 `kong` 改為 `api-gw` |
| auth (gotrue) | v2.185.0 | **v2.197.0** | |
| rest (postgrest) | v14.3 | **v14.18** | |
| realtime | v2.72.0 | **v2.148.3** | 包含安全性修正 |
| storage-api | v1.33.5 | **v1.89.12** | 單向的資料庫 migration；包含安全性修正 |
| imgproxy | v3.30.1 | **v4.0.21** | 主版號升級，部分環境變數會被忽略 |
| postgres-meta | v0.95.2 | **v0.100.0** | |
| edge-runtime | v1.74.0 | v1.77.9 | **EduLog：移除**（已不使用 Edge Functions） |
| logflare (analytics) | 1.30.3 | 1.50.15（選用） | 已不在預設堆疊中。不要使用 1.52.0 以上 |
| vector | 0.28.1-alpine | 0.53.0-alpine（選用） | 與 analytics 一起選用 |
| supavisor | 2.7.4 | **2.9.13** | |
| postgres | 15.8.1.085 或 15.14.1.112 | 第一階段：**維持目前的 15.x tag**；第二階段：**17.6.1.136** | EduLog v2.0.0-alpha.3 起使用 15.14.1.112。絕對不要換成較舊的 Postgres 映像檔 |

## 會影響 EduLog 的重大變更

| 官方變更（版本） | 對 EduLog 的影響 | 處理方式 |
|---|---|---|
| Gateway 封鎖 Realtime 的 `/api/tenants` 與 `/api/openapi`（0.6.0，安全性） | 目前 Kong 2.8.1 的 `kong.yml` 沒有這項封鎖 | 換成 v0.8.4 的 gateway 設定檔 |
| Envoy 取代 Kong；服務改名為 `api-gw`，並保留網路別名 `kong` 與 `envoy`（0.8.0） | `api` 使用 `http://kong:8000`。別名讓這個網址仍可使用，但 `depends_on: kong` 與 `docker-compose.prod.yml` 中的 `kong:` 區塊會失效 | 將這些參照改為 `api-gw` |
| Analytics 與 Vector 移出預設堆疊（0.5.0） | 很多服務有 `depends_on: analytics`，`db` 也依賴 `vector` | 移除這些依賴與兩個服務，或透過 logs override 保留 |
| `API_EXTERNAL_URL` 改為包含 `/auth/v1`，並新增 `GOTRUE_JWT_ISSUER`（0.5.0 / 0.7.0） | 新簽發 access token 的 `iss` 可能會改變 | 更新 `.env`，再檢查 `server/.env` 的 `SUPABASE_JWT_ISSUER` |
| Storage 設定改由環境變數提供（`STORAGE_TENANT_ID`、`GLOBAL_S3_BUCKET`、`REGION`） | 既有檔案存放在 `supabase/volumes/storage/stub/stub/…` | **三個值都必須維持 `stub`**，否則既有檔案會讀不到 |
| 新增 `REALTIME_DB_ENC_KEY`（0.7.0） | 必須等於舊版寫死的 `supabaserealtime` | 設為 `supabaserealtime` |
| Storage migration 為單向（0.8.3） | 新版 Storage 啟動後，舊映像檔將無法上傳檔案 | 先備份；要回復只能還原這份備份 |
| imgproxy v4 會默默忽略部分舊環境變數（0.8.4） | `IMGPROXY_ENABLE_WEBP_DETECTION` 是舊名稱 | 改用 `IMGPROXY_AUTO_WEBP` |
| Studio 與 meta 改以 `postgres` 連線，不再使用 `supabase_admin`（0.6.0） | 需要轉移物件擁有者。EduLog 正式環境不公開 Studio | **暫時維持 `supabase_admin`**（選用，見文末） |
| DB 初始化不再設定 `app.settings.jwt_secret`（0.8.2） | 只影響全新安裝；EduLog 的 migration 沒有使用 | 更新 `jwt.sql` |
| Edge Functions 的 CORS 與記憶體上限（0.8.4） | EduLog 已移除 Edge Functions | 移除 `functions` 服務 |

---

## 第一階段：升級 Postgres 以外的所有服務

以下指令都在部署主機上執行，工作目錄為 EduLog 部署目錄（`docker-compose.yml` 與 `.env` 所在處）。正式環境使用 prod override，因此先定義：

```bash
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
```

沒有使用 `docker-compose.prod.yml` 的話，改用 `DC="docker compose"`。

### 1.1 前置條件

- Docker Compose v2.24 以上。override 檔使用了 `!reset` 與 `!override`。
- 可用磁碟空間至少為 `supabase/volumes/` 大小的 2 倍（備份用）。
- 確認 Storage tenant 目錄的實際名稱，這會決定之後 `STORAGE_TENANT_ID` 的值：

```bash
ls supabase/volumes/storage/
```

通常是 `stub`。若顯示其他名稱，下面的 `STORAGE_TENANT_ID` 就改用該名稱，不要用 `stub`。

### 1.2 備份（必做）

趁堆疊還在運作時，先做邏輯備份並複製設定：

```bash
BK=~/edulog-backup-$(date +%Y%m%d-%H%M)
mkdir -p "$BK"
docker exec edulog-db pg_dumpall -h localhost -U supabase_admin > "$BK/pg15_dumpall.sql"
cp -a docker-compose*.yml .env "$BK/"
cp -a server/.env "$BK/server.env"
tar -czf "$BK/supabase-config.tgz" --exclude='supabase/volumes/db/data' --exclude='supabase/volumes/storage' supabase/volumes
docker run --rm -v supabase_db-config:/src:ro -v "$BK":/dst alpine cp /src/pgsodium_root.key /dst/pgsodium_root.key.backup
```

資料目錄與 Storage 檔案的冷備份，會在 1.7 停止堆疊後進行。

> ⚠️ 絕對不要執行 `docker compose down -v`。`supabase_db-config` volume 存放 pgsodium/Vault 金鑰，一旦刪除，加密資料將無法復原。

### 1.3 取得官方 v0.8.4 檔案

```bash
git clone --depth 1 --branch self-hosted/v0.8.4 --filter=blob:none --sparse \
  https://github.com/supabase/supabase ~/supabase-v0.8.4
git -C ~/supabase-v0.8.4 sparse-checkout set docker
UP=~/supabase-v0.8.4/docker
```

編輯時把 `$UP/docker-compose.yml` 開在旁邊，以下每個服務區塊都以它為準。

### 1.4 更新 `supabase/volumes/` 內的設定檔

建議優先使用本 repo 的 `supabase/volumes/`：那是 v0.8.4 加上 EduLog 修改（沒有 Edge Functions 路由、Envoy 沒有 basic auth）的合併版本。只有無法使用 repo 時，才從官方複製：

```bash
# API gateway（Envoy，預設）
mkdir -p supabase/volumes/api/envoy
cp $UP/volumes/api/envoy/{envoy.yaml,cds.yaml,lds.template.yaml,docker-entrypoint.sh} supabase/volumes/api/envoy/
# 一併更新 Kong 的檔案，讓 Kong 選項仍可使用
cp $UP/volumes/api/kong.yml $UP/volumes/api/kong-entrypoint.sh supabase/volumes/api/
# Supavisor 改為讀取 POSTGRES_HOST
cp $UP/volumes/pooler/pooler.exs supabase/volumes/pooler/pooler.exs
# DB 初始化腳本（只在資料目錄為空時執行，對既有資料庫無影響）
cp $UP/volumes/db/*.sql supabase/volumes/db/
```

若您曾自行修改這些檔案，請先用 `diff -u 舊檔 新檔` 與官方版本比對，再把自己的修改合併回去。

### 1.5 更新 `.env`

| 變數 | 變更 |
|---|---|
| `API_EXTERNAL_URL` | 結尾加上 `/auth/v1`，例如 `https://edulog.example.com/auth/v1` |
| `API_GW_HTTP_PORT` | 新增（`8000`）。未設定時會沿用 `KONG_HTTP_PORT` |
| `REALTIME_DB_ENC_KEY` | 新增：`supabaserealtime`（**不可更改**，且必須剛好 16 個字元） |
| `STORAGE_TENANT_ID` / `GLOBAL_S3_BUCKET` / `REGION` | 新增：`stub` / `stub` / `stub`（或 1.1 查到的目錄名稱） |
| `S3_PROTOCOL_ACCESS_KEY_ID` / `S3_PROTOCOL_ACCESS_KEY_SECRET` | 新增，分別以 `openssl rand -hex 16` 與 `openssl rand -hex 32` 產生 |
| `IMGPROXY_ENABLE_WEBP_DETECTION` | 刪除，改為新增 `IMGPROXY_AUTO_WEBP=true` |
| `PGRST_DB_MAX_ROWS` / `PGRST_DB_EXTRA_SEARCH_PATH` | 選用：`1000` / `public` |
| `PGRST_DB_SCHEMAS` | `public,graphql_public`（新的預設值）。這會停止透過 REST 公開 `storage` schema；EduLog API 沒有使用它 |
| `SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`、`JWT_KEYS`、`JWT_JWKS`、`ANON_KEY_ASYMMETRIC`、`SERVICE_ROLE_KEY_ASYMMETRIC` | 新增並留空。留空代表沿用舊的 HS256 金鑰 |

既有的密鑰維持不變：`JWT_SECRET`、`ANON_KEY`、`SERVICE_ROLE_KEY`、`POSTGRES_PASSWORD`、`VAULT_ENC_KEY`、`SECRET_KEY_BASE`、`PG_META_CRYPTO_KEY`。

**`server/.env`：** 若 `SUPABASE_JWT_ISSUER` 有值，先清空。完成 1.8 後，解碼一個新簽發的 access token，把其中的 `iss` 填回 `SUPABASE_JWT_ISSUER`，再重建 `api` 容器。已登入的使用者可能需要重新登入。

### 1.6 更新 `docker-compose.yml`

保留 EduLog 的 `container_name: edulog-*` 與 `networks:`，依下列說明修改各服務。環境變數區塊請從 `$UP/docker-compose.yml` 複製，只需調整路徑（`./volumes/` → `./supabase/volumes/`）與主機名稱（`api-gw`）。

**所有服務：** 刪除每一個 `depends_on: analytics:`。`db` 另外刪除 `depends_on: vector:`。

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
      HOSTNAME: "0.0.0.0"                       # 原為 "::"
      SUPABASE_URL: http://api-gw:8000           # 原為 http://kong:8000
      PGRST_DB_SCHEMAS: ${PGRST_DB_SCHEMAS}
      PGRST_DB_MAX_ROWS: ${PGRST_DB_MAX_ROWS:-1000}
      PGRST_DB_EXTRA_SEARCH_PATH: ${PGRST_DB_EXTRA_SEARCH_PATH:-public}
      SUPABASE_PUBLISHABLE_KEY: ${SUPABASE_PUBLISHABLE_KEY:-}
      SUPABASE_SECRET_KEY: ${SUPABASE_SECRET_KEY:-}
      ENABLED_FEATURES_LOGS_ALL: "false"
      # 刪除：LOGFLARE_API_KEY、LOGFLARE_*_ACCESS_TOKEN、LOGFLARE_URL、
      #       NEXT_PUBLIC_ENABLE_LOGS、NEXT_ANALYTICS_BACKEND_PROVIDER、
      #       EDGE_FUNCTIONS_MANAGEMENT_FOLDER
      # 暫時不要加入 POSTGRES_USER_READ_WRITE: postgres（見「選用的後續工作」）
    volumes:
      - ./supabase/volumes/snippets:/app/snippets:Z
      # 刪除 ./supabase/volumes/functions 的掛載
```

**kong → api-gw（Envoy，建議）。** 刪除整個 `kong:` 服務，改為加入：

```yaml
  api-gw:
    container_name: edulog-envoy
    image: envoyproxy/envoy:v1.39.6
    restart: unless-stopped
    networks:
      net:
        aliases: [kong, envoy]   # 讓 EduLog API 的 http://kong:8000 繼續可用
      frontend:
        aliases: [kong, envoy]   # 只有在 frontend 網路上有服務直接呼叫 gateway 時才需要，否則可刪除
    healthcheck:
      test: ["CMD-SHELL", "timeout 1 bash -c '</dev/tcp/127.0.0.1/8000'"]
      interval: 10s
      timeout: 5s
      retries: 3
    depends_on:
      studio:
        condition: service_healthy
    # 只綁本機；prod、Caddy、nginx override 都會重設這個 port
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

> **EduLog 的 Envoy 設定檔與官方不同。** EduLog 的 `lds.template.yaml` 沒有 SHA1 basic auth filter，也沒有 Edge Functions 路由；Studio 登入改由 Caddy 或 nginx overlay 提供。若您在 1.4 複製了官方的 Envoy 檔案，請改用本 repo 的 `supabase/volumes/api/envoy/`；否則必須在上面的 environment 補上 `DASHBOARD_USERNAME` 與 `DASHBOARD_PASSWORD`，因為官方檔案需要這兩個變數。

> **想繼續使用 Kong：** 服務名稱同樣用 `api-gw`，`networks` 與別名也相同。接著設定 `container_name: edulog-kong`、`image: kong/kong:3.9.3`，並從 `$UP/docker-compose.kong.yml` 複製 healthcheck、volumes、environment 與 entrypoint，路徑改為 `./supabase/volumes/api/…`。注意 `KONG_ROUTER_FLAVOR: expressions` 與 `KONG_DECLARATIVE_CONFIG: /usr/local/kong/kong.yml` 都是必要設定。官方已宣布未來會移除 Kong override，長期建議使用 Envoy。

**auth**

```yaml
    image: supabase/gotrue:v2.197.0
    environment:
      GOTRUE_JWT_ISSUER: ${API_EXTERNAL_URL}    # 新增；API_EXTERNAL_URL 現在以 /auth/v1 結尾
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
      PGRST_ADMIN_SERVER_PORT: 3001              # --ready 需要
      PGRST_ADMIN_SERVER_HOST: localhost
      PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}
      # 刪除 PGRST_APP_SETTINGS_JWT_SECRET
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
      # test 不變；新增：
      start_period: 10s
    environment:
      AUTH_JWT_SECRET: ${JWT_SECRET}             # 取代 PGRST_JWT_SECRET
      STORAGE_PUBLIC_URL: ${SUPABASE_PUBLIC_URL}
      GLOBAL_S3_BUCKET: ${GLOBAL_S3_BUCKET}      # 原為寫死的 stub
      TENANT_ID: ${STORAGE_TENANT_ID}            # 原為寫死的 stub
      REGION: ${REGION}                          # 原為寫死的 stub
      S3_PROTOCOL_ACCESS_KEY_ID: ${S3_PROTOCOL_ACCESS_KEY_ID}
      S3_PROTOCOL_ACCESS_KEY_SECRET: ${S3_PROTOCOL_ACCESS_KEY_SECRET}
```

**imgproxy**

```yaml
    image: darthsim/imgproxy:v4.0.21
    environment:
      IMGPROXY_AUTO_WEBP: ${IMGPROXY_AUTO_WEBP}  # 取代 IMGPROXY_ENABLE_WEBP_DETECTION
```

**meta：** `image: supabase/postgres-meta:v0.100.0`。暫時維持 `PG_META_DB_USER: supabase_admin`。

**functions：** 刪除整個服務，並刪除最上層 `volumes:` 中的 `deno-cache:`。只有在您自行加入了 Edge Functions 時才需要保留：依官方區塊移植（`mem_limit: ${FUNCTIONS_MEMORY_LIMIT:-2g}`、新的 healthcheck、`SUPABASE_URL: http://api-gw:8000`）並同步 `volumes/functions/main/`，同時在函式內自行處理 CORS。從 0.8.4 起，gateway 不再為它們加上 CORS 標頭。

**analytics 與 vector：** 刪除這兩個服務。若想在 Studio 保留日誌，請改寫 `$UP/docker-compose.logs.yml` 使用（logflare `1.50.15`，不要用 1.52.0 以上），並移除公開的 `4000:4000` port。

**db（第一階段維持 PG15）**

```yaml
    image: supabase/postgres:15.8.1.085           # 不變：維持您目前使用的 15.x tag
    # 刪除 depends_on: vector
    environment:
      # 刪除 JWT_SECRET（新版 jwt.sql 已不使用）
      JWT_EXP: ${JWT_EXPIRY}
```

**supavisor**

```yaml
    image: supabase/supavisor:2.9.13
    environment:
      POSTGRES_HOST: ${POSTGRES_HOST}            # 新增，新版 pooler.exs 會使用
```

**api（EduLog）**

```yaml
    depends_on:
      api-gw:                                    # 原為 kong
        condition: service_healthy
```

`SUPABASE_URL` / `EDULOG_SUPABASE_INTERNAL_URL` 維持 `http://kong:8000` 即可，因為 `kong` 別名仍然有效。`api` 服務必須留在 `net` 網路上。

### 1.6b 更新 `docker-compose.prod.yml`

override 檔若提到 base 檔中不存在的服務，`docker compose config` 會失敗。因此：

```yaml
  api-gw:            # 原為 kong:
    ports: !reset []
  # 刪除 analytics: 區塊（除非您保留了 analytics）
```

### 1.7 驗證設定、下載映像、停機、備份資料、啟動

```bash
$DC config -q && echo "compose OK"
$DC pull                     # 下載期間舊堆疊仍持續運作
$DC down                     # 不要加 -v！
sudo tar -czpf "$BK/supabase-data.tgz" supabase/volumes/db/data supabase/volumes/storage
$DC up -d db
docker inspect -f '{{.State.Health.Status}}' edulog-db   # 等到顯示 healthy
$DC up -d --remove-orphans   # --remove-orphans 會移除舊的 kong/analytics/vector/functions 容器
```

### 1.8 驗證

```bash
$DC ps                                              # 所有服務都是 up/healthy
docker logs edulog-storage 2>&1 | tail -n 30         # Storage migration 已完成，沒有錯誤
docker logs edulog-auth 2>&1 | tail -n 30
docker logs edulog-envoy 2>&1 | tail -n 30           # 或 edulog-kong
docker exec edulog-api node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>console.log(r.status))"   # 200
# 安全性修正已生效：這裡不應回傳 200
docker exec edulog-api node -e "fetch('http://kong:8000/realtime/v1/api/tenants').then(r=>console.log(r.status))"
```

接著在瀏覽器確認：

- 登入，然後登出。
- 開啟一份報告，用兩個視窗同時編輯（Realtime 協作）。
- 上傳附件或圖片後再開啟（Storage 與 imgproxy）。
- 開啟**升級前**上傳的檔案。如果打不開，代表 `STORAGE_TENANT_ID`、`GLOBAL_S3_BUCKET` 或 `REGION` 設定錯誤。

### 1.9 回復第一階段

Storage 與 Auth 的 migration 無法倒回，所以單純改回舊的映像檔 tag 並不能回復：

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

## 第二階段：Postgres 15 → 17

### 2.1 開始前確認

- 第一階段已完成並穩定運作。
- 具備 root（`sudo`）、`bash`、`curl` 與 `setfacl`（Debian/Ubuntu：`apt install acl`）。
- 可用磁碟空間至少為資料庫大小的 2 倍再加 5 GB。
- 所有容器都在執行中。
- 沒有安裝不支援的擴充套件。若下列查詢有結果，而且您需要這些擴充套件，**請停止升級**：

```bash
docker exec edulog-db psql -h localhost -U supabase_admin -d postgres -Atc \
  "select extname from pg_extension where extname in ('timescaledb','plv8','plcoffee','plls');"
```

- 沒有 replication slot。EduLog 預設不會建立：

```bash
docker exec edulog-db psql -h localhost -U supabase_admin -d postgres -Atc "select slot_name from pg_replication_slots;"
```

- 依 1.2 重新做一次完整備份。

### 2.2 取得符合 EduLog 目錄結構的腳本

**使用本 repo 的腳本（建議）。** `supabase/utils/upgrade-pg17.sh` 是已依 EduLog 調整過的 v0.8.4 腳本：

- 目標容器為 `edulog-db`，資料路徑為 `./supabase/volumes/db`。
- 讀取 `supabase/docker-compose.pg17.yml`（`17.6.1.136`）。

在 repo 根目錄執行：

```bash
sudo bash supabase/utils/upgrade-pg17.sh
```

接著直接跳到 2.4。2.4 中沒有根目錄的 `docker-compose.pg17.yml` 需要刪除。

**沒有 repo 時：** 自行修補官方腳本：

```bash
mkdir -p ~/edulog-pg17
curl -fsSL https://raw.githubusercontent.com/supabase/supabase/self-hosted/v0.8.4/docker/utils/upgrade-pg17.sh \
  -o ~/edulog-pg17/upgrade-pg17.sh
sed -i \
  -e 's/^DB_CONTAINER="supabase-db"/DB_CONTAINER="edulog-db"/' \
  -e 's#\./volumes/db#./supabase/volumes/db#g' \
  -e 's#\$(pwd)/volumes/db#$(pwd)/supabase/volumes/db#g' \
  ~/edulog-pg17/upgrade-pg17.sh
grep -n 'DB_CONTAINER=\|volumes/db' ~/edulog-pg17/upgrade-pg17.sh   # 所有路徑都應指向 ./supabase/volumes/db
printf 'services:\n  db:\n    image: supabase/postgres:17.6.1.136\n' > docker-compose.pg17.yml
```

修補後的腳本會以 root 執行，執行前請先完整讀過一次。

### 2.3 執行

```bash
sudo bash ~/edulog-pg17/upgrade-pg17.sh
```

腳本會停止整個堆疊，在暫時的容器中執行 `pg_upgrade`，最後以 `docker compose -f docker-compose.yml -f docker-compose.pg17.yml up -d` 啟動。由於這個指令沒有套用 prod override，base 檔中的 port 會短暫對外開放。

原始資料保留在 `supabase/volumes/db/data.bak.pg15`，pgsodium 金鑰保留在 `supabase/volumes/db/pgsodium_root.key.bak.pg15`。

### 2.4 固定使用 PG17 並驗證

1. 將 `docker-compose.yml` 中的 `db.image` 改為 `supabase/postgres:17.6.1.136`，或在 `$DC` 中固定加上 `-f supabase/docker-compose.pg17.yml`。
2. 若使用的是手動修補方式，刪除根目錄的 `docker-compose.pg17.yml`。
3. 重新啟動並確認版本：

```bash
$DC up -d --remove-orphans
docker exec edulog-db psql -U postgres -c "select version();"     # PostgreSQL 17.6
```

4. 重做 1.8 的所有檢查。
5. 確認一切正常後再清理。**清理後就無法回復：**

```bash
sudo rm -rf supabase/volumes/db/data.bak.pg15 supabase/volumes/db/pgsodium_root.key.bak.pg15 supabase/volumes/db/pg17_upgrade_bin_*.tar.gz
```

### 2.5 回復第二階段

```bash
$DC down
sudo rm -rf supabase/volumes/db/data
sudo mv supabase/volumes/db/data.bak.pg15 supabase/volumes/db/data
# 將 db.image 改回原本的 15.x tag，並從 -f 參數中移除 docker-compose.pg17.yml
docker compose run --rm db chown -R postgres:postgres /etc/postgresql-custom/   # PG15 與 PG17 的 UID 不同
$DC up -d
```

---

## 選用的後續工作

- **Studio 與 meta 不再使用 superuser：** 參考官方的 [Remove superuser access](https://supabase.com/docs/guides/self-hosting/remove-superuser-access)。執行 `supabase/utils/reassign-owner.sh`（請用 v0.8.4 版，並調整容器名稱），之後再設定 `POSTGRES_USER_READ_WRITE: postgres` 與 `PG_META_DB_USER: postgres`。
- **新版 API keys 與非對稱 JWT：** 參考官方的 auth keys 指南與 `utils/add-new-auth-keys.sh`。啟用後，EduLog API 的 token 驗證（`SUPABASE_JWT_SECRET`）也要一併調整，建議當成獨立的變更處理。

## 參考資料

- [Supabase self-hosted CHANGELOG](https://github.com/supabase/supabase/blob/master/docker/CHANGELOG.md)
- [Supabase self-hosted versions.md](https://github.com/supabase/supabase/blob/master/docker/versions.md)
- [`self-hosted/v0.8.4`：docker-compose.yml、docker-compose.kong.yml、docker-compose.logs.yml、docker-compose.pg15.yml、upgrades.json](https://github.com/supabase/supabase/tree/self-hosted/v0.8.4/docker)
- [Update your self-hosted deployment](https://supabase.com/docs/guides/self-hosting/updating)
- [Upgrade to Postgres 17](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17)
- [Self-hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [0.7.0 遷移說明（discussion #47093）](https://github.com/orgs/supabase/discussions/47093)
- [0.8.0 遷移說明（discussion #48048）](https://github.com/orgs/supabase/discussions/48048)
