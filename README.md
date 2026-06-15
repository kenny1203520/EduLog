# EduLog

EduLog 是一套為家教/補教場景設計的學習報告系統，提供比傳統後台更快的撰寫體驗，並支援跨裝置、即時同步與歷史報告參照。

## 核心功能

- 即時報告編修與自動儲存
- 分割畫面（Split Pane）參照同學/歷史報告
- 課程、學生、教室、假期管理
- 課堂發生（Class Occurrence）與報告完成度追蹤
- 多語系介面（預設 `zh-TW`，備援 `en`）
- PWA 安裝與離線快取能力（Vite PWA）

## 技術棧

- Frontend: Vue 3, TypeScript, Vite, Vue Router, Pinia, Vue I18n
- UI / Styling: Tailwind CSS 4
- Backend/Data: Self-hosted Supabase (PostgreSQL + Auth + Realtime + Storage)
- Infra: Docker Compose

## 專案結構

```text
EduLog/
├─ app/                  # Vue 3 前端
└─ supabase/             # Self-hosted Supabase 與資料庫 migration
   └─ migrations/        # EduLog 自定義 schema migrations
```

## 環境需求

- Node.js 20+
- npm 10+
- Docker Desktop（或等效 Docker + Compose）

## 快速開始

### 1. 啟動 Supabase 服務

```bash
cd supabase
cp .env.example .env
docker compose up -d
```

預設 API Gateway 位址為 `http://localhost:8000`。

### 2. 建立前端環境變數

```bash
cd ../app
cp .env.example .env
```

請將 `app/.env` 的 `VITE_SUPABASE_ANON_KEY` 改為 `supabase/.env` 內的 `ANON_KEY` 值。

`app/.env` 範例：

```env
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=<來自 supabase/.env 的 ANON_KEY>
```

### 3. 安裝前端依賴並啟動

```bash
cd app
npm install
npm run dev
```

Vite 開發伺服器啟動後，依終端機顯示網址開啟（通常為 `http://localhost:5173`）。

## 建置

```bash
cd app
npm run build
npm run preview
```

正式 Docker image 會以 Nginx 服務前端靜態檔，並在容器啟動時由環境變數產生 runtime config。修改 `SUPABASE_PUBLIC_URL`、`ANON_KEY` 或 `EDULOG_SUPABASE_FUNCTIONS_BASE_URL` 後，重啟前端容器即可生效，不需要重新 build 前端 image。

## 資料庫 Migration

EduLog 自定義 migration 位於 `supabase/migrations/`，請依序執行：

1. `1000001_core_schema.sql`
2. `1000002_academics.sql`
3. `1000003_operations.sql`
4. `1000004_enhance_report_versions.sql`
5. `1000005_user_visibility_preferences.sql`

可透過 Supabase Studio 的 SQL Editor 逐一執行，或使用 `psql` / `docker exec` 管線方式批次執行。

## 常用指令

### Frontend (`app/`)

- `npm run dev`：啟動開發伺服器
- `npm run build`：型別檢查並建置
- `npm run preview`：預覽建置結果

### Supabase (`supabase/`)

- `docker compose up -d`：背景啟動
- `docker compose down`：停止服務
- `docker compose -f docker-compose.yml -f ./dev/docker-compose.dev.yml down -v --remove-orphans`：完整清除開發容器/volume
- `./reset.sh`：重置 Supabase 開發環境

## 安全注意事項

- `supabase/.env.example` 僅供本機開發，正式環境務必重新產生所有密鑰。
- 請勿將真實金鑰、帳密與敏感資料提交到版本控制。
- 前端 image 內建 Nginx CSP/HSTS 與 HTTP/HTTPS 雙模式；若啟用原生 HTTPS，請掛載憑證並設定 `EDULOG_HTTPS_ENABLED=true`。

## 延伸文件

- `app/README.md`：前端開發細節
- `supabase/README.md`：Self-hosted Supabase 說明
- `supabase/migrations/README.md`：資料庫 migration 指南
