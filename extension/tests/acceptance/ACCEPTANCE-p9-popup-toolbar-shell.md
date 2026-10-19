# P9：Popup 與原站 EduLog 外殼（2026-10-19）

依 `docs/design/MASTER.md` §3、§6.8、§6.12、§7 與已核准原型 v2（`#popup/*`、`#site/on`、`#site/off-panel`）。

## 本次範圍

- **字級角色 token**：`styles/edulog-tokens.css` 新增 `--edulog-font-{tag,caption,body,button,name,heading,title}`（12／13／14／14／16／18／22）與 `--edulog-control-height-sm`（30px）。只新增，不改既有名稱。
- **Popup**：結構不變（連線標籤、依分頁的單一主操作、工作紀錄（N）、齒輪設定頁）。樣式只用角色 token：標題 18、情境標題 16、按鈕 14、說明與狀態 13；連線標籤改為圓點＋文字（無底色）；設定頁主題改為開關樣式；非班級／報告情境的圖示改灰、連線異常為紅、等待核准為琥珀。
- **主題開啟（工具列）**：高 48px 白底 sticky，左側（窄螢幕先有「網站導覽」）EduLog 標誌＋本頁名稱，右側連線狀態、**一顆**主操作（班級頁「同步本班」、報告編輯頁「預填本報告」、其他頁「開啟工作台」；未連線或能力未就緒時不顯示）、「EduLog 更多」圖示鈕。原站頁面保留高度 `--edulog-toolbar-height` 改為 48px（`sites/orange-apple/orange-apple.css` 僅此兩行，對應新工具列）。
- **主題關閉或本頁設為原版（浮動按鈕）**：取代舊的「本頁套用 EduLog／EduLog 功能」兩鈕膠囊，右下角只有一顆 40px EduLog 圖示按鈕，右上 10px 連線狀態點（ok 綠／neutral 灰／warn 琥珀／danger 紅），`aria-label="EduLog（已連線）"`。
- **面板（兩種模式共用）**：手動 Popover（進 top layer，不被原站 overflow 或 z-index 蓋住）；點外面、Esc、關閉鈕皆可關閉，Esc／關閉鈕把焦點還給觸發鈕，開啟時焦點進面板。內容：標題列（EduLog＋連線標籤）→「本頁套用 EduLog」開關（主題開時；主題整體關閉時改為「套用 EduLog 清晰主題」開關）→ 主題關閉時的主操作（同 popup，經 `open-integration-workspace` 的 `import`／`prefill` 流程）；主題開啟時改為「開啟工作台」「工作紀錄」→ 連線狀態（伺服器、最近驗證；未連線時說明到瀏覽器工具列圖示連線；連線異常有「重新檢查」與診斷）→「設定」展開：主題開關、介面語言、開啟整合設定。
- `shared/integration-ui.js` 改為外殼的共用樣式（只用 `--edulog-*`）、Lucide 圖示與中英文案；`shared/connection-ui.js` 的 `describe()` 增加 `key`，並註冊 `conn.<狀態>.{chip,label,detail}` 中英文案。
- 連線狀態在工具列建立時讀一次（背景已有 30 秒快取），重建工具列時沿用上次結果；開啟面板時重新檢查。

## 驗證

- `npm test`（本地時區與 `TZ=UTC`）：419/419。`ui.test.mjs` 新增：主題關閉只有一顆浮動按鈕、面板內容與主操作送出 `import`、報告頁送出 `prefill`、未連線說明、Esc 與點外面關閉、主題開啟工具列主操作與面板開關。`startup.test.mjs`、`ui.test.mjs` 啟動訊息改為「偏好＋一次連線狀態」。
- Playwright（`TZ=UTC node scripts/extension/browser-tests.mjs`，Chrome＋Edge）：`browser-check.mjs` 每頁 × 8 種寬度檢查工具列高 48、無溢出、只有一顆主按鈕、字級只在 12／13／14／16／18／22；面板為 top-layer popover 且在視窗內；主題關閉時只有一顆 40px 浮動按鈕、面板在按鈕上方且不超出視窗、Esc 關閉並還原焦點；`en-US` 360px 的班級頁與報告頁工具列、兩種面板無溢出。`startup-browser-check`（保留高度＝48）、`hours-browser-check`（開關改為 switch 角色）通過。
- 截圖：`<browser>-popup-*.png`、`<browser>-toolbar-panel-{360,1440}.png`、`<browser>-fab-closed-{360,1440}.png`、`<browser>-fab-panel-{360,1440}.png`、`<browser>-en-*-360.png`（`extension/tests/artifacts/ci/<browser>/browser-check/`）。

## 未驗證

- 實站：連線狀態點的實際網路行為（未配對時背景回應速度）、窄螢幕實站頁名長度。
- Popup 主要文案仍只有中文（沿用 P4）；英文只涵蓋原站外殼。
