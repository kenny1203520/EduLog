# 自架部署（Docker Compose）

本文說明如何以 Docker Compose 部署 EduLog 全端系統：Nginx 前端、Express API，以及 Self-hosted Supabase（Postgres、Auth、Realtime、Storage）。架構與流量路徑見 [frontend-api-bff.md](frontend-api-bff.md)，所有環境變數見 [environment.md](environment.md)。

## 系統需求

- Docker 與 Docker Compose v2 以上
- Git

## 1. 準備環境變數

```bash
cp .env.example .env
```

至少需要設定：

- Supabase 密鑰：`POSTGRES_PASSWORD`、`JWT_SECRET`、`ANON_KEY`、`SERVICE_ROLE_KEY` 等，正式環境務必全部重新產生。
- EduLog API：`EDULOG_COOKIE_SECRET`（至少 32 字元）、`EDULOG_WEB_BASE_URL`（瀏覽器使用的前端網址）、`EDULOG_ALLOWED_ORIGINS`（未設定時 production API 會拒絕啟動）。
- 映像檔版本：`EDULOG_IMAGE_TAG`（前端）與 `EDULOG_API_IMAGE`（API），可指定版本號或 `latest`。
- 前端 Nginx：`EDULOG_PORT` / `EDULOG_HTTPS_PORT`、`EDULOG_HTTP_ENABLED` / `EDULOG_HTTPS_ENABLED` 與 `EDULOG_SSL_*`。原生 HTTPS 需掛載憑證（預設目錄 `./ssl`，可用 `EDULOG_SSL_DIR` 改變）。
- 瀏覽器擴充功能：`API_EXTENSION_ALLOWED_ORIGINS` 與 `EDULOG_FRAME_ANCESTORS`，詳見 [web-extension.md](web-extension.md)。自訂 `EDULOG_CSP_HEADER` 會完全取代預設 CSP，須自行在 `frame-ancestors` 列出擴充功能 origin。

瀏覽器不需要、也不會取得任何 Supabase URL 或金鑰；前端一律透過同源 `/api/*` 呼叫 Express。

## 2. 啟動

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

`docker-compose.prod.yml` 只公開前端 Nginx 的 port，Kong、Auth、Realtime、Storage、Postgres 都不對外。前端與 API 映像檔分別從 `ghcr.io/kenny1203520/edulog` 與 `EDULOG_API_IMAGE` 下載。

需要 TLS 反向代理時，可另外疊加 `supabase/docker-compose.caddy.yml` 或 `supabase/docker-compose.nginx.yml`；改用 Envoy 取代 Kong 時疊加 `supabase/docker-compose.envoy.yml`（用法見各檔案開頭註解）。

## 3. 驗證

- 前端：`http://localhost:4173`（或 `EDULOG_PORT`）；啟用原生 HTTPS 時為 `https://localhost:4174`（或 `EDULOG_HTTPS_PORT`）。
- API 健康檢查：`http://localhost:4173/api/healthz`。

Supabase Studio 與 `/rest/v1/` 在 production 部署不對外。需要直接操作資料庫時，請在本機使用 `supabase/dev/docker-compose.dev.yml` 或另建只限本機的 override，不要在正式環境公開這些 port。

## 4. 更新與停止

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans
```

新版本若包含資料庫 migration，請先閱讀對應的 GitHub Release 說明與 [supabase/migrations/README.md](../../supabase/migrations/README.md)。

停止服務：

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
```

> **警告：** 加上 `-v` 會一併刪除具名 volume（包含 `db-config` 中的資料庫加密金鑰），資料無法復原。

## 從舊版 Supabase 專案遷移

Postgres 資料與 Storage 檔案綁定在 `./supabase/volumes/`；只要該資料夾存在，新的部署會直接沿用。存放 pgsodium 金鑰的具名 volume 固定命名為 `supabase_db-config`，因此加密金鑰也會延續。
