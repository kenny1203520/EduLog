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
- Backend: Express.js Auth BFF/API (Node.js 26 LTS)
- Data: Self-hosted Supabase (PostgreSQL + Auth + Realtime + Storage)
- Infra: Docker Compose

## 專案結構

```text
EduLog/
├─ app/                  # Vue 3 前端（Nginx image）
├─ server/               # Express Auth BFF / API（API image）
├─ extension/            # Chrome 擴充功能（Manifest V3）
├─ supabase/             # Self-hosted Supabase、migrations 與資料庫測試
├─ scripts/              # 發佈、環境變數檢查與擴充功能打包腳本
├─ docker/               # 自建映像檔（Presidio）
└─ docs/                 # 架構、部署與維運文件
```

## 環境需求

- Node.js 26+
- npm（隨 Node.js 附帶）
- Docker Desktop（或等效 Docker + Compose）

## 快速開始

### 1. 啟動服務

```bash
cp .env.example .env
# 至少填入 EDULOG_COOKIE_SECRET、EDULOG_WEB_BASE_URL、EDULOG_ALLOWED_ORIGINS，並重新產生 Supabase 密鑰
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

所有環境變數、預設值與 Compose 改名對照請見 [docs/deployment/environment.md](docs/deployment/environment.md)。

正式流量只由 Nginx frontend container 對外提供；`/api/*` 由 Nginx 轉送到 Express，Express 再使用 user JWT client 或受限的 server-side service-role client 存取 Supabase。Production Compose 不公開 Kong、Auth、Realtime、Storage 或 Postgres port。

本機若需要直接操作 Supabase Studio/資料庫，請使用 development profile 或另行建立 local-only override，不要把這些 port 暴露在 production 部署。

### 2. 前端環境變數

前端不讀取任何 `VITE_*` 變數，也不設定 Supabase URL、anon key 或 Functions URL。瀏覽器一律透過同源 `/api/*` 與 HttpOnly session cookie 呼叫 Express；開發時由 Vite 代理 `/api`（`EDULOG_API_DEV_TARGET`，預設 `http://localhost:3000`）。

### 3. 安裝與啟動前端/後端

```bash
cd app && npm install && npm run dev
cd ../server && npm install && npm run dev
```
## 建置

```bash
cd app && npm run build
cd ../server && npm run build
```

正式 Docker image 以 Nginx 服務 Vue 靜態檔；Express API image 獨立建置並只在 server container 讀取 Supabase secrets。瀏覽器不會取得任何 Supabase key 或執行期設定。

## 資料庫 Migration

EduLog 自定義 migration 位於 `supabase/migrations/`，依檔名順序全部套用；各版本的前置檢查與注意事項見 [supabase/migrations/README.md](supabase/migrations/README.md)。

## 常用指令

### Frontend (`app/`)

- `npm run dev`：啟動開發伺服器
- `npm run build`：型別檢查並建置
- `npm run test`：執行 Vitest

### API (`server/`)

- `npm run dev`：啟動 Express 開發伺服器
- `npm run typecheck` / `npm test` / `npm run build`

### Supabase (`supabase/`)

- `docker compose up -d`：背景啟動
- `docker compose down`：停止服務
- `docker compose -f docker-compose.yml -f ./supabase/dev/docker-compose.dev.yml down -v --remove-orphans`：完整清除開發容器/volume（於專案根目錄執行）
- `./supabase/reset.sh`：重置 Supabase 開發環境

## 安全注意事項

- `supabase/.env.example` 僅供本機開發，正式環境務必重新產生所有密鑰。
- Supabase URL、anon key、service-role key 只注入 Express container；禁止出現在 Vue source 或 frontend artifact。
- Express 的一般資料操作必須使用帶 user JWT 的 client，RLS 是 API 之外的最後防線。
- 請勿將真實金鑰、帳密與敏感資料提交到版本控制。
- 前端 image 內建 Nginx CSP/HSTS 與 HTTP/HTTPS 雙模式；若啟用原生 HTTPS，請掛載憑證並設定 `EDULOG_HTTPS_ENABLED=true`。

## 延伸文件

- [docs/deployment/self-hosting.md](docs/deployment/self-hosting.md)：自架部署步驟
- [docs/deployment/environment.md](docs/deployment/environment.md)：環境變數總表
- [AGENT.md](AGENT.md)：架構與開發規範
- `app/README.md`：前端開發細節
- `extension/README.md`：瀏覽器擴充功能
- `supabase/README.md`：Self-hosted Supabase 說明
- `supabase/migrations/README.md`：資料庫 migration 指南
