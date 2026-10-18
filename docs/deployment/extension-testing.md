# EduLog 擴充功能測試版

先以 ZIP 側載，後續轉入 Chrome Web Store 私人 BETA 項目。Chrome 與 Edge 共用測試包。只使用指定的 EduLog 測試環境及測試帳號。

## 維護者：產生交付檔

需求：Git、Node.js 26。封裝本身不需要 npm 依賴。在專案根目錄執行：

```powershell
rtk proxy npm --prefix extension run package -- --channel beta --version 0.1.1.1
rtk proxy npm --prefix extension run verify-package
rtk proxy npm --prefix extension run scan-secrets
```

輸出 `extension/dist/beta/`：ZIP、同名 `.sha256`、`release.json` 及 `TESTING.md`。交付這四份檔案；ZIP 根目錄直接包含 manifest，文件與 SQL 不放進 ZIP。

預設來源為 **HEAD 的已提交執行檔**，忽略未提交變更。可加 `--ref <commit-or-tag>` 與 `--out <directory>`。修改執行檔後先提交，再產生對外交付版。封裝工具及公開設定來自目前工作目錄；正式產物以包含這些工具的乾淨 checkout 重現。

`release.json` 記錄 commit、版本、預期 ID、逐檔雜湊及 API 能力。ZIP 使用排序後路徑與固定時間；相同 Node.js 版本及建置輸入可產生相同 ZIP。不可重用已發佈版本來交付不同內容。

封裝及驗證會掃描實際 ZIP 的常見憑證樣式，遇到疑似私鑰或權杖就停止；此檢查不是完整祕密審計。ZIP 中所有程式碼都能被收件人讀取，不得內嵌後端密鑰。SHA-256 用來核對檔案一致性，不能證明發佈者身分；下載位置及另行通知的版本／雜湊必須可信。

側載固定 ID：`caefagceiajdhjnmogiaicaijckmplge`。公開金鑰位於 `scripts/extension/config.json`，僅固定開發 ID，不取代後端配對授權。沒有私鑰需要交付。

他人可以複製公鑰建立同 ID 的側載版本，因此 ID 相同不代表內容可信。只安裝管理者提供的檔案。配對 token 儲存在瀏覽器 profile，受信任儲存限制不等於作業系統保險箱；不要分享或同步備份整個測試 profile。不要把含有 token 的瀏覽器儲存內容截圖。

## 維護者：部署測試環境

1. 部署 release 所記錄 commit 的主站與 API，依序套用尚未部署的 migrations。擴充功能依賴包含 **1000141**；整個主站可能需要後續 migration，以該 commit 的完整部署流程為準。
2. 設定下列 API 環境變數並重新啟動。多個 ID 用逗號分隔，不能使用萬用字元，也不要覆蓋主站的 `API_ALLOWED_ORIGINS`。

```dotenv
API_EXTENSION_ALLOWED_ORIGINS=chrome-extension://caefagceiajdhjnmogiaicaijckmplge
EDULOG_WEB_BASE_URL=https://YOUR-TEST-WEB-HOST
```

3. 提供測試人員可由瀏覽器到達的 API 網址、前端登入網址及測試帳號；不要填容器內部地址。確認該帳號的教學權限。

CI 會用精確 extension origin 與專用配對 token 呼叫 `/api/extension/v1/me`，檢查帳號、安裝及功能能力。現有端點不提供完整 migration ledger 或部署 commit；能力通過不能證明所有 SQL 已部署。部署者仍須確認同 commit 的主站、API 及 migration chain，不能只提高能力旗標。

## 測試人員：安裝

1. 將 ZIP 解壓至固定資料夾，例如 `Documents/EduLog-Beta`，確認資料夾直接包含 `manifest.json`。不要直接載入 ZIP。
2. 開啟 `chrome://extensions` 或 `edge://extensions`，啟用「開發人員模式」，選「載入未封裝項目」，選取上述資料夾。
3. 確認名稱含 BETA、版本符合 `release.json`，ID 為 `caefagceiajdhjnmogiaicaijckmplge`。
4. 開啟 popup，輸入維護者提供的測試 API 網址並授予該站權限。
5. 在 EduLog 登入並核准此瀏覽器配對，回到 popup 檢查連線。

無法配對時核對 ID 白名單、API／前端網址、HTTPS、帳號及 API 能力。回報錯誤碼與 request ID，不分享憑證。

可在交付資料夾核對下載檔案：

```powershell
Get-FileHash -Algorithm SHA256 .\EduLog-Teaching-Tools-beta-0.1.1.1.zip
```

將結果與 `.sha256` 檔比較。

## 更新與恢復

先保存原站表單草稿，關閉工作台與 popup。保留固定資料夾，移除其中舊執行檔，再解壓新版至同一路徑。不要刪除瀏覽器 profile、解除安裝或清除擴充功能儲存空間。

在管理頁按「重新載入」，重新整理來源分頁，開啟工作台並檢查連線與草稿。遇到不確定的同步結果，重新檢查原工作及伺服器 checkpoint；不要建立新工作或清空 IndexedDB 來重送。

## 真實安裝驗收

以下各項分別記錄 Chrome／Edge 版本、OS、extension version、commit 及結果：

- 首次安裝、ID、版本；未配對、拒絕、核准、撤銷及過期後重新配對。
- 支援頁面顯示工具列；未知網站不受影響；切回原版保留表單草稿。
- 對指定測試資料完成讀取、差異預覽、明確確認後同步。
- 權限與 API 能力不足時阻擋操作。
- 斷線、儲存失敗及不確定寫入後重試，保留原工作／批次識別碼，不重複寫入。
- 更新及重開瀏覽器後，配對、偏好、草稿與待處理工作仍可恢復。

原站表單仍由老師人工確認及提交。合成頁面、Chromium 真實擴充功能與真人 Chrome／Edge 安裝驗收分開記錄。

## 改用私人商店版

商店 ID 可能不同。先完成或取消側載工作並保存原站表單，再移除側載版、從私人商店連結安裝並重新配對；不搬移憑證或未完成工作，也不同時啟用兩份擴充功能。

使用已加入測試名單的 Google 帳號。Edge 首次安裝需允許其他商店的擴充功能；私人項目可見性與安裝權限須各自驗收。

## 問題回報

提供版本、commit、瀏覽器／OS、來源頁面類型、重現步驟、預期／實際結果、錯誤碼與 request ID。截圖遮蔽學生個資；不要附 API token、完整教學內容或瀏覽器 profile。
