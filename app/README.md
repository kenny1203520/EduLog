# EduLog Frontend (`app`)

EduLog 前端使用 Vue 3 + TypeScript + Vite，提供教師/助教的日常報告編修流程，包含課堂進度、缺課狀態與歷史報告參照。

## 主要技術

- Vue 3 + Composition API
- TypeScript
- Vue Router
- Pinia
- Vue I18n
- Tailwind CSS 4
- Vite PWA
- Supabase JS Client

## 環境需求

- Node.js 20+
- npm 10+

## 環境變數

本機開發時建立 `.env`：

```bash
cp .env.example .env
```

填入以下值：

```env
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=<your_supabase_anon_key>
```

`VITE_SUPABASE_ANON_KEY` 請對應 `../supabase/.env` 的 `ANON_KEY`。

Docker production image 會在容器啟動時產生 `/runtime-config.js`，因此
`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_SUPABASE_FUNCTIONS_BASE_URL`
可由 `docker-compose.yml` 的 environment 設定。修改這些環境變數後只需要重啟容器，不需要重新建置 image。

## 開發

```bash
npm install
npm run dev
```

## 建置與預覽

```bash
npm run build
npm run preview
```

Production Docker image 使用 Nginx 服務 `dist` 靜態檔，不使用 `vite preview` 作為 Web server。

## 可用腳本

- `npm run dev`：啟動 Vite 開發伺服器
- `npm run build`：執行 `vue-tsc -b` 後進行 Vite build
- `npm run preview`：預覽建置輸出
- `npm run start`：使用 `vite preview --host` 啟動本機預覽，不用於 production image

## 目錄重點

- `src/views/`：頁面層
- `src/components/`：可重用元件
- `src/services/`：資料存取與 Supabase 互動
- `src/models/`：領域模型
- `src/stores/`：Pinia 狀態管理
- `src/locales/`：多語系字串（`zh-TW` / `en`）
- `src/pwa.ts`：Service Worker 註冊與更新邏輯

## 相關文件

請優先參考專案根目錄的 `../README.md` 取得完整啟動流程（含 Supabase 與 Migration）。
