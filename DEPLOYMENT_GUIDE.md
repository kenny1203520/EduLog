# EduLog 部署與安裝指南 (Deployment Guide)

本指南將引導您如何使用 Docker Compose 一鍵部署 EduLog 全端系統，其中包含了後端核心（Supabase 生態系）以及前端網站（EduLog Vue App）。

## 系統需求
- Docker 與 Docker Compose (建議版本 `v2.x` 以上)
- Git

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
   - `EDULOG_IMAGE_TAG`：欲使用的 EduLog 版本標籤，您可以指定特定的版本號（如 `v1.3.0`），或保持為 `latest`。

## 第二步：啟動服務

當環境變數準備就緒後，在根目錄下執行以下指令來啟動所有的服務（包含資料庫、API、前端網頁等）：

```bash
docker compose up -d
```

Docker 將會自動拉取所需的映像檔（其中前端 `edulog` 的映像檔將會從 GitHub Container Registry `ghcr.io/kenny1203520/edulog` 下載）。

## 第三步：驗證部署

啟動完成後，您可以透過瀏覽器造訪下列網址來確認各項服務是否正常運作：

- **EduLog 前端網站**：`http://localhost:4173` (或您設定的 `EDULOG_PORT`)
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

> **注意：** 為了確保資料安全，若您需要完全移除環境（包含資料庫資料），請加上 `-v` 參數（**警告：這將會清除所有資料！**）：
> `docker compose down -v`
