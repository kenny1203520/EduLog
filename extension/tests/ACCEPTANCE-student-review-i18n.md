# EduLog 0.1.0：學生共用核對與工作台 i18n 驗收

日期：2026-10-05。此更新沿用既有 API、資料庫與匯入契約，不新增 migration 或端點。所有測試使用隔離資料；未向 corp 送出教學紀錄。

## 已通過：自動測試

| 範圍 | 結果 |
| --- | --- |
| 擴充套件 | **196 項 Node/JSDOM 測試通過**。涵蓋學生姓名與來源 ID、可靠 ID 分組、無 ID 完全相同姓名暫時分組、報名拆分、身份衝突保留、課程先行載入教材、映射變更後保存草稿與重算摘要、歷史核對及安全阻擋。 |
| 工作台語言 | 繁中／英文切換、動態狀態翻譯、瀏覽器語言回退、跨分頁偏好同步、來源原文及原站選項保留原文均有測試。語言切換不重建表單。 |
| API | `extensionIntegrationRouter.test.ts` **11 項通過**；`/me` 只轉送 RPC 回報的能力旗標。第一次受限執行因 localhost socket 權限遭拒，授權後重跑通過。 |
| 資料庫 | PGlite 實際執行既有 migration **1000118–1000126** 測試組，跨班報名、歷史保存、權限、冪等、revision 與交易回滾檢查通過。本次未新增 migration。 |
| Chrome／Edge 合成工作台 | 兩個瀏覽器在 360、390、768、1024、1200、1440、1920 CSS px 通過匯入、預覽、預填、工作紀錄及無水平溢出檢查；嵌入式助手在 360／1440 px 通過；IndexedDB 各 12 項 ownership、期限及 checkpoint 檢查通過。 |

命令：

```powershell
rtk npm --prefix extension test
rtk npm --prefix server test -- src/extensionIntegrationRouter.test.ts
rtk npm run test:extension-db --prefix server
rtk node extension/tests/workspace-browser-check.mjs
```

## 尚待驗收

- Chrome／Edge 實際側載、corp 最新頁面及正式帳號資料上的讀取／寫入權限。
- 原生 200% 縮放、短視窗和手機軟鍵盤的完整實機檢查。
- 同名異 ID 的實際資料、人工拆分後恢復工作，以及正式環境映射記憶跨裝置流程。
- 實站工作區刷新與來源歷史讀取。原站報告仍由老師人工送出。

尚未執行的項目不列為通過。測試不會更動實站資料。

## 側載包

版本維持 **0.1.0**。封裝沿用既有資料庫及伺服器能力，不要求套用新 migration；能力不支援時仍安全停用相關寫入功能，介面提供重查連線與診斷入口。

封裝指令：

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File extension/scripts/package-side-load.ps1
```

產物：`extension/dist/EduLog-Teaching-Tools-0.1.0-student-review-i18n.zip`。側載包包含擴充套件 runtime、部署說明及本驗收紀錄。
