# 擴充功能 CI/CD 設定

## 流程

`extension-release.yml` 在相關 PR（develop/master）及 develop push 執行檢查與封裝。本儲存庫正式／預設分支為 `master`，不是 `main`。獨立標籤：

```text
extension/beta/v0.1.1.2
extension/stable/v0.1.1
```

beta 必須是 develop 的祖先 commit，stable 必須是 master 的祖先 commit。beta 四段數字，末段為 1–65535；stable 三段數字。每段 0–65535、沒有前置零，同一商店項目的版本須遞增。

這些標籤不會符合 Docker workflow 的 `v*.*.*`。發標籤即授權全自動發佈，不新增人工核准。用 GitHub tag ruleset 限制維護者才能建立 `extension/**`，並禁止更新／刪除。

檢查包含目前擴充功能與發佈程式的憑證樣式掃描、單元、發佈工具、API typecheck／擴充功能 API 測試、隔離 PGlite、Chrome／Edge 合成頁面、實際 ZIP 的 Chromium persistent-context 測試。封裝及驗證時再次掃描解壓後的實際執行檔。掃描不代表完整 Git 歷史審計。封裝一次後傳遞同一 artifact。擴充功能 workflow 不執行資料庫 migration。

標籤工作驗證已部署 API，建立 GitHub Release 並上傳 ZIP、SHA-256、release.json、TESTING.md；遠端同名檔案內容不同時停止，不覆蓋。

ZIP／GitHub Release 工作沒有 `id-token: write`。僅獨立商店發佈與監看工作可取得 OIDC。Actions 以官方儲存庫查核過的完整 commit SHA 固定版本，checkout 不保存 GitHub token。更新 Actions 時重新查核來源 SHA 並跑 actionlint。

## 第一階段：ZIP

Repository Variables：

| 名稱 | 值 |
|---|---|
| `EXTENSION_BETA_DISTRIBUTION` | `zip`（預設） |
| `EXTENSION_STABLE_ENABLED` | `false`（預設停用） |
| `EXTENSION_STORE_MONITOR_ENABLED` | `false`（預設停用） |

建立 `extension-beta` GitHub Environment，不設 required reviewers：

| 類型 | 名稱 | 內容 |
|---|---|---|
| Variable | `EXTENSION_API_URL` | 測試 API HTTPS base URL，不含 `/api/extension/v1/me` |
| Secret | `EXTENSION_API_TOKEN` | 固定測試 ID 配對、具所需權限的專用 CI 測試帳號憑證 |

此流程只用 token 查詢 readiness，但 token 本身仍可操作該帳號獲授權的擴充功能 API，並不是唯讀憑證。使用獨立 CI 測試帳號及最少資料權限，不使用管理員或個人日常帳號。token 不放入產物或 log；有效期沿用 90 天，過期前重新配對、更新 secret 並撤銷舊憑證。商店 ID 改變時重新建立相符 ID 的配對。安全設定與外洩處理見 [extension-security.md](extension-security.md)。

部署並驗收後，提交變更，再建立與推送 beta 標籤：

```powershell
rtk git tag extension/beta/v0.1.1.2
rtk git push origin extension/beta/v0.1.1.2
```

只有推送標籤才會觸發發佈。一般功能分支推送不發佈。儲存庫目前為 Private；Release 下載需有 repo 權限。無 repo 權限的測試人員由維護者透過受控管道取得四份交付檔。

## 第二階段：私人 Chrome Web Store

1. 建立開發者帳號、完成費用及兩步驟驗證。
2. 建立獨立 BETA 草稿，設定 Private 與測試者 Google Group。完成 `CHROMEWEBSTORE.md` 的圖示、截圖、聯絡資料、權限說明與隱私政策公開網址；Unlisted 不提供私人限制。
3. 取得項目 extension ID，以及 Package → View public key 的單行 base64 公鑰。API 白名單加入新 ID，更新 CI 配對 token，分別驗收 Chrome／Edge。
4. Google Cloud 啟用 Chrome Web Store API，建立 service account，將 email 加入開發者後台。
5. 設定 GitHub OIDC Workload Identity Federation 與 service account impersonation，授予 `roles/iam.workloadIdentityUser`；使用 `google-github-actions/auth@v3` 換取短效 token，不建立長效 JSON key。

WIF provider 必須限制 repository **數字 ID**、owner ID 與 workflow/ref。發佈僅接受本 repo 的 extension-release workflow 及 `refs/tags/extension/beta/`／`refs/tags/extension/stable/`；監看僅接受本 repo 預設分支的 extension-store-status workflow。拒絕 PR、fork 與其他 workflow。Environments 的 deployment branch rules 允許相應標籤，不加 required reviewers。

已確認本 repo 的 `repository_id=1149427625`、`repository_owner_id=59145509`，完整名稱 `kenny1203520/EduLog`。可直接採用 [安全文件中的 OIDC 條件](extension-security.md#oidc-信任條件)，不要只限制可重新註冊的 repo 名稱。

Repository Variables：

| 名稱 | 內容 |
|---|---|
| `CWS_WORKLOAD_IDENTITY_PROVIDER` | `projects/.../locations/global/workloadIdentityPools/.../providers/...` |
| `CWS_SERVICE_ACCOUNT` | 已在開發者後台授權的 service account email |
| `CWS_PUBLISHER_ID` | publisher ID |
| `CWS_BETA_EXTENSION_ID` | 私人 BETA 項目 ID |
| `CWS_BETA_PUBLIC_KEY` | 對應單行 base64 公鑰 |
| `EXTENSION_BETA_DISTRIBUTION` | 最後才改為 `store` |
| `EXTENSION_STORE_MONITOR_ENABLED` | 監看權限準備好後改為 `true` |

另建立 `extension-store-monitor` Environment，deployment branch rule 只允許 `master`；不加 required reviewers。在此環境設定監看專用的 `CWS_WORKLOAD_IDENTITY_PROVIDER`，限制只接受監看 workflow／master／此 environment。可以使用同一個已連結 publisher 的 service account，但 readonly scope 只是目前請求範圍，不是 service account 的永久唯讀權限；預設分支仍須受保護。Google 目前每個 publisher 只支援連結一個 service account；beta／stable Item ID 分開並不隔離 publisher 發佈權限。

首次上架先在 Dashboard 完成 listing/privacy。私人項目仍需審查。API V2 使用 `DEFAULT_PUBLISH`，核准後自動上線、不跳過審查；驗證警告會停止。

商店變更與監看共用 concurrency group。上傳／送審前先把 intent 保存到 GitHub Release body 的 machine marker，成功後保存 receipt，不含憑證。不要刪除 marker 或手動替換 draft package。

重跑比對 ZIP、release assets、遠端版本及 receipt。已送審／上線同版只回報狀態；其他版本審查中不覆蓋。回應遺失而無法證明結果時停止，不盲目重傳；在 Dashboard 核對後以更高版本修復。

`extension-store-status.yml` 每小時使用 readonly store scope 檢查；狀態不變不更新 Release。已上線／遭拒時更新，遭拒令該次 Actions 失敗。Schedule 只在預設分支存在此 workflow 時執行。

## 正式通路

建立獨立正式項目，設定 `CWS_STABLE_EXTENSION_ID`／`CWS_STABLE_PUBLIC_KEY`，建立 `extension-stable` Environment 與正式 API 的 URL／token。安裝與升級驗收後才設 `EXTENSION_STABLE_ENABLED=true`。

beta／stable 保持獨立 ID、配對與本機儲存。正式可見性由維護者在 Dashboard 決定，自動化不更改。

## 本機驗證

```powershell
rtk proxy npm ci
rtk proxy npm ci --prefix app
rtk proxy npm ci --prefix server
rtk proxy npm --prefix extension test
rtk proxy npm --prefix extension run scan-secrets
rtk proxy npm --prefix extension run test:release
rtk proxy npm --prefix server run test:extension-db
rtk proxy npm --prefix extension run package -- --channel beta --version 0.1.1.2
rtk proxy npx playwright install chromium
rtk proxy npm --prefix extension run test:installed
$env:EXTENSION_BROWSERS = 'chrome,msedge'
rtk proxy node scripts/extension/browser-tests.mjs
```

官方 Chrome／Edge 不支援這套自動側載旗標；真實 MV3 自動測試使用 Playwright Chromium，真人 Chrome／Edge 安裝驗收依 `extension-testing.md` 記錄。

參考：[固定 ID](https://developer.chrome.com/docs/extensions/reference/manifest/key)、[私人項目](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)、[Service account](https://developer.chrome.com/docs/webstore/service-accounts)、[發佈 API](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish)、[Playwright](https://playwright.dev/docs/chrome-extensions)。
