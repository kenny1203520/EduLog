# EduLog 0.1.0：完整歷史同步驗收

日期：2026-10-05。此紀錄區分隔離自動測試與實站驗收；沒有對 corp 送出教學紀錄。

## 已通過：自動測試

| 範圍 | 結果與實際涵蓋 |
| --- | --- |
| 擴充套件 | **182／182** Node／JSDOM 測試；已確認跨班報名、全部歷史讀取、列表直接教學欄位、無 ID 誠實身份、內容去重、空評語／false／0／半星、允許欄位與內部紀錄隔離、讀取續傳／逐筆重試、原工作修正分離、課次摘要與覆寫、無新資料不建立工作、遲到回應與原 key 續傳 |
| API | **38 檔／223 項** server Vitest；历史 query／route／綁定固定 RPC、來源與型別、憑證邊界、版本與查詢限制；server 型別檢查通過 |
| 主站 | **116 檔／472 項** app Vitest；新增歷史服務權限篩選分頁、候選分頁、版本與原 key 套用、逐欄衝突選擇及遲到回應保護；Vue／TypeScript 與 Vite 正式建置通過 |
| 資料庫 | PGlite **實際執行 1000118–1000126**；歷史新增／修改／無變更／分類、完整來源白名單、身份不足／同日歧義、最近日期排序與 >50 筆游標、合法課次與讀寫權限、歷史／報告版本、幂等重送、整批與綁定交易回滾 |
| 10/03 → 10/04 | 在 PGlite 建立真實測試表記錄；只有 10/04 合法目的課次可綁定，原報名班次不改寫。注入歷史更新失敗後，報告新增與歷史關聯都回滾；原 key 重試成功 |
| 調課被取代 | 先調至 A 再調至 B：A 不出現在合法候選及該日核對名單，B 仍可讀／可核對；取消與日期錯誤保持阻擋 |

資料庫測試使用去識別化資料與縮小的權限樣本，執行真實新增 migration SQL；不代表正式完整 migration chain、正式 RBAC 或實站資料已驗收。API 單元測試使用隔離後端，不連接正式資料庫。

### 安裝的 Chrome／Edge，自動瀏覽器檢查

- 新歷史工作台：兩個瀏覽器各 **360、390、768、1024、1200、1440、1920px**，加 **1440×480px**，共 **16 組**。使用實際工作台 DOM／CSS 与合成報告，驗證清單／單筆切換、搜尋、狀態篩選、完成當前項目保留、原文展開、最後操作區、44px 操作高度、長內容、鍵盤、焦點、草稿及捲動保留；無整頁水平溢出。
- 既有工作流程：兩個瀏覽器各 **360、390、768、1024、1440px**，共 **10 組**；匯入、差異、預填與工作紀錄保持可操作。
- 嵌入助手：兩個瀏覽器各 **360／1440px**；覆寫、內部紀錄 opt-in、草稿與不自動送出。
- 原生 IndexedDB：每個瀏覽器 **12 項**檢查；ownership、失效連線重開、revision、七天期限及完成／取消清除。

瀏覽器測試為隔離本機樣本／API 模擬，**不是實際側載與 corp 生產頁面驗收**。先前主題、星等與獨立編輯頁驗收紀錄仍保留，沒有將那些紀錄冒充本次實站測試。

### 可重現指令

在對應目錄執行（依專案 lockfile 安裝依賴）：

```powershell
# extension/
rtk npm test
rtk node tests/history-browser-check.mjs <playwright/index.mjs>
rtk node tests/workspace-browser-check.mjs <playwright/index.mjs>
# server/
rtk npm test
rtk npm run typecheck
rtk npm run test:extension-db
# app/
rtk npm test
rtk npm run build
# 專案根目錄
rtk powershell -NoProfile -ExecutionPolicy Bypass -File extension/scripts/package-side-load.ps1
```

PGlite 是 server lockfile 內的可重現依賴。瀏覽器腳本可接受 Playwright 模組路徑；需安裝 Chrome 與 Edge。畫面截圖存於忽略的 `extension/tests/artifacts/`。

## 尚未通過，保留待驗收

- 真實 Chrome／Edge 側載、corp 最新 DOM／Turbo 與實際原生連動。
- 主站歷史詳情、候選與綁定在正式 RBAC／指定測試資料上的端到端讀寫；跨班次權限及正式完整 migration chain。
- 真實瀏覽器 **200% 原生縮放**、手機軟鍵盤與安全區；CSS viewport／DPR 模擬不列為原生縮放通過。
- Docker 正式建置：已嘗試 `docker build -f Dockerfile -t edulog-history-validation .`，Docker Desktop Linux 引擎 pipe 不存在，無法完成。啟動 Docker Desktop 後需重跑。
- 指定測試班級的實際名單與日期核對、教材映射、完整資料量與網路中斷續傳、再次修改來源報告後的實站同步。

原站確認欄與送出由老師操作。待驗收不阻止產出可審查的側載包，但不能宣稱已在正式環境完整同步。

## 交付

新增 migration **1000126_enrollment_history_reports.sql**；版本 **0.1.0**。

側載包：`extension/dist/EduLog-Teaching-Tools-0.1.0-complete-history-sync.zip`，包含 runtime、部署說明、驗收紀錄及 1000118–1000126。封裝檢查 manifest、入口及本地 JS／HTML 相依。SQL／API／主站須依專案部署，不由 ZIP 自動更新伺服器。
