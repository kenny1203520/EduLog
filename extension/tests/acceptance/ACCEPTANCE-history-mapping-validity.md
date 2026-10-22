# EduLog 0.1.0：有效對應保留與失效原因驗收

日期：2026-10-10（Asia/Taipei）

## 自動驗證

- `npm test --prefix extension`：240 項通過，0 項失敗。
- `npm run typecheck --prefix server`：通過。
- `npm test --prefix server -- src/extensionWorkspaceRouter.test.ts`：22 項通過，0 項失敗。
- `node supabase/tests/web_extension_workspace.mjs`：PGlite migration 與工作區契約通過，包含 1000133 的可靠身份補齊及後續有效記憶核對。
- `node extension/tests/mapping-memory-browser-check.mjs --focused`：Chrome 合成頁面在 390px 與 1440px 通過；覆蓋映射狀態、名稱差異提示、衝突分類、保存回應延遲、跨課程重用、重新開啟及無非預期頁面錯誤。
- `git diff --check` 與修改 JavaScript 的 `node --check`：通過。

## 修正內容

- 補讀來源學生 ID 或課程代碼時，只有伺服器能驗證來源連結與既有 EduLog 目標關係，才更新記憶識別並沿用原對應。
- 同一可靠學生 ID 的姓名差異只保留為提醒，不再單獨使報名或報告失效，也不會改寫 EduLog 姓名。
- 真正學生／課程身份矛盾顯示「來源有矛盾」；目標暫不可讀顯示「待驗證」並保留選取。無理由碼的舊伺服器仍安全要求重核。
- 重新讀取只以非空欄位更新可靠身份；完整讀取成功後重新計算衝突，缺欄或請求失敗不會清除先前識別。

## 尚待驗收

- Edge 合成瀏覽器尚未執行。
- 短視窗專項、200% 縮放及真正側載包尚未驗收。
- 尚未在真實來源網站作只讀操作；本次未提交或修改任何教學紀錄。

側載包：`extension/dist/EduLog-Teaching-Tools-0.1.0-mapping-validity.zip`。資料庫變更使用 `1000133_extension_mapping_memory_reasons.sql`；部署前應依環境中尚未套用的 migration 順序執行，再重啟 API 並重新檢查連線。
