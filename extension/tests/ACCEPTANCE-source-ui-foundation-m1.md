# 原站改版 M1：設計 tokens、站點詞彙、健康檢查與每頁原版（0.1.0）

## 本次範圍

原站改版方案 v2 的基礎里程碑，外觀與既有行為不變：

- `edulog-tokens.css`：共用語意 tokens（只有自訂屬性，可安全注入原站，並由工具列 Shadow DOM 繼承）。站點 CSS、工具列、整合面板、popup、編輯器預填改用 tokens；`ui-tokens.css` 的 `--ui-*` 對應到 `--edulog-*`。僅淺色；兩個近似色合併（`#526176`→`#475569`、`#f0f5ff`→`#eff4ff`）。
- `adapters/orange-apple-lexicon.js`：路由、結構選擇器、狀態用語、頁面探針集中一處。
- `adapters/orange-apple-model.js`：`matchPage`、`sessionText`、`classifySession`、`readWeekColumns`、`pickWeek`、`checkPage`。報告頁的週欄位與課次狀態判斷（adapter 與 workflows）改由此讀取。
- 健康檢查：增強前檢查探針。權限頁維持原狀；結構不符時該頁保留原站畫面，工具列顯示「此頁暫用原站畫面：原站版面可能已更新…」。
- 每頁原版：工具列「本頁看原版／本頁套用 EduLog」，按頁面種類記住。偏好存為 `edulogUiPreferences[adapterId].pages[kind] = 'original'`；空時不寫入，舊格式不變。啟動時原版頁直接釋放，不閃爍主題。

尚未搬入詞彙表：`orange-apple-integration.js` 的資料解析用語與 workflows 其他頁面的欄位標題比對（歷史、時數、未填寫、行事曆），隨 M2/M3 使用到時再搬。

## 已驗證

- 完整擴充功能測試：329/329 通過。新增 `site-model.test.mjs`（路由、狀態分類、週欄位、健康檢查）、每頁原版的偏好儲存／廣播／驗證、工具列切換、主題關閉時隱藏、結構不符時回原版、啟動不閃爍。
- Chrome／Edge 合成瀏覽器：`browser-check.mjs`（12 種頁面 × 8 寬度 + popup 4 狀態）、`startup-browser-check.mjs`（28 筆）、`unfilled-rating-browser-check.mjs`、`editor-date-browser-check.mjs` 全數通過。360px 工具列換行為三列，按鈕仍為 44px。

## 待驗收

- `hours-browser-check.mjs` 在本次變更前即失敗（尋找已不存在的「使用原站主題」按鈕），未在此修正。
- 真實側載唯讀巡檢、原生 200% 縮放、480px 短視窗、實站完整 Bootstrap 樣式。
- 去識別真站快照 fixture 工具尚未建立（列入下一步）。
