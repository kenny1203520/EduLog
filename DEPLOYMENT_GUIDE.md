# EduLog 部署與安裝指南 (Deployment Guide)

本指南將引導您如何使用 Docker Compose 一鍵部署 EduLog 全端系統，其中包含了後端核心（Supabase 生態系）以及前端網站（EduLog Vue App）。

## 系統需求
- Docker 與 Docker Compose (建議版本 `v2.x` 以上)
- Git

## 關於舊版資料繼承
如果您是從原有的 `supabase` 專案轉移過來，請不用擔心資料遺失：
1. **實體檔案與資料庫 (Bind Mounts)**：所有的 Postgres 資料與 Storage 檔案都是綁定在您本地端的 `./supabase/volumes/` 資料夾，只要資料夾存在，新啟動的系統就會直接讀取舊資料。
2. **具名卷宗 (Named Volumes)**：包含 `pgsodium` 加解密金鑰的 `db-config` 卷宗，我們已在 `docker-compose.yml` 中指定使用舊有的名稱 (`supabase_db-config`)，確保資料庫加密金鑰的無縫繼承。

## 第一步：準備環境變數

首先，從根目錄的範本檔案複製一份您的環境變數設定檔：

```bash
cp .env.example .env
```

接著，開啟 `.env` 檔案並填寫必要的金鑰與設定。特別留意以下幾個核心設定：

1. **Supabase 密碼與金鑰**：
   - `POSTGRES_PASSWORD`: 必須設定為強密碼。
   - `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`: 請確保這些安全性 Token 的強度。
   - `STUDIO_DEFAULT_ORGANIZATION`, `STUDIO_DEFAULT_PROJECT`: 可改為您的組織與專案名稱。

2. **EduLog 前端設定**（位於檔案最底部）：
   - `EDULOG_PORT`：前端網站對外開放的 Port（預設為 `4173`）。
   - `EDULOG_HTTPS_PORT`：前端原生 HTTPS 對外開放的 Port（預設為 `4174`）。
   - `EDULOG_IMAGE_TAG`：欲使用的 EduLog 版本標籤，您可以指定特定的版本號（如 `v1.3.0`），或保持為 `latest`。
   - `EDULOG_HTTP_ENABLED` / `EDULOG_HTTPS_ENABLED`：控制前端 Nginx 是否啟用 HTTP 與 HTTPS。HTTPS 會使用 `EDULOG_SSL_*` 指定的憑證。
   - `EDULOG_CSP_HEADER` / `EDULOG_HSTS_HEADER`：前端 Nginx 的安全 header；未覆寫時會使用安全預設值。自訂 CSP 會完全取代預設值，須自行在 `frame-ancestors` 列出擴充功能 origin，否則擴充功能側邊欄無法顯示 EduLog。
   - `EDULOG_FRAME_ANCESTORS`：允許在瀏覽器側邊欄嵌入 EduLog 的擴充功能 origin（以空白分隔的精確 `chrome-extension://<id>`）。留空時前端容器沿用 `API_EXTENSION_ALLOWED_ORIGINS`；使用 Caddy/nginx 反向代理時需明確設定。詳見 [docs/deployment/web-extension.md](docs/deployment/web-extension.md)。

## 第二步：啟動服務

當環境變數準備就緒後，在根目錄下執行以下指令來啟動所有的服務（包含資料庫、API、前端網頁等）：

```bash
docker compose up -d
```

Docker 將會自動拉取所需的映像檔（其中前端 `edulog` 的映像檔將會從 GitHub Container Registry `ghcr.io/kenny1203520/edulog` 下載）。

## 第三步：驗證部署

啟動完成後，您可以透過瀏覽器造訪下列網址來確認各項服務是否正常運作：

- **EduLog 前端網站**：`http://localhost:4173` (或您設定的 `EDULOG_PORT`)
- **EduLog 前端 HTTPS**：`https://localhost:4174` (啟用 `EDULOG_HTTPS_ENABLED=true` 後，或您設定的 `EDULOG_HTTPS_PORT`)
- **Supabase Studio (資料庫管理介面)**：`http://localhost:8000` (或您設定的 `KONG_HTTP_PORT`)
- **API 端點**：`http://localhost:8000/rest/v1/`

## 如何停止與更新服務

若要停止系統運行：
```bash
docker compose down
```

若您有更新 `.env` 變數或是有新版本的 EduLog 映像檔發布，可以使用下列指令更新：
```bash
docker compose pull
docker compose up -d
```

前端 image 使用 Nginx 服務靜態檔，不使用 `vite preview`。`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 與 `VITE_SUPABASE_FUNCTIONS_BASE_URL` 會在容器啟動時寫入 runtime config；修改這些環境變數後重啟容器即可，不需要重新 build image。

> **注意：** 為了確保資料安全，若您需要完全移除環境（包含資料庫資料），請加上 `-v` 參數（**警告：這將會清除所有資料！**）：
> `docker compose down -v`
