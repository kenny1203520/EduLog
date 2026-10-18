# 擴充功能交付與發佈安全操作

更新：2026-10-18。儲存庫 `kenny1203520/EduLog` 為 Private，預設／正式分支 `master`，測試整合分支 `develop`。預設只交付 ZIP，商店與正式通路需完成外部設定才啟用。

## 憑證放置

| 資料 | 放置位置 | 說明 |
|---|---|---|
| `sideloadPublicKey`、`CWS_*_PUBLIC_KEY` | 原始碼／Repository Variables | 公鑰，可公開；固定 ID 不驗證側載檔案的來源 |
| Extension ID、Publisher ID、WIF provider、service account email | Variables | 識別資訊，不是登入憑證 |
| `EXTENSION_API_TOKEN` | `extension-beta`／`extension-stable` Environment Secret | 專用帳號、精確 ID、獨立安裝的配對憑證 |
| `CWS_ACCESS_TOKEN` | OIDC auth step output，僅傳給商店步驟 | 短效；不寫檔、不記錄到 release receipt |
| `GITHUB_TOKEN` | GitHub 自動提供，依 job 限權 | 只有 Release／商店／狀態寫入工作有 contents write |
| 資料庫密碼、Supabase service role、任何私鑰 | 後端祕密管理 | 不得放進擴充功能、資產 JSON、文件或 Release |

不需要為固定側載 ID 保存或交付私鑰。商店發佈採用 service account impersonation 與短效存取權，不建立長效 JSON key。ZIP 中的 JS／JSON 對所有收件人可讀，私人商店也不能隱藏程式內嵌的密鑰。

## 第一次交付 ZIP

1. 在 GitHub Settings → Rules → Rulesets 保護 `develop` 與 `master`，要求 PR 檢查與審查。保護 workflow、封裝及發佈程式的修改；限制可直接推送和繞過規則的人員。需要全自動發佈時，不新增逐次 environment reviewer。
2. 對 `extension/beta/*` 與 `extension/stable/*` 建立 tag ruleset，只讓指定維護者／發佈身分建立，禁止修改及刪除。標籤代表授權發佈；程式的 ancestry 檢查不能代替 ruleset。
3. 保留 `EXTENSION_BETA_DISTRIBUTION=zip`、`EXTENSION_STABLE_ENABLED=false`、`EXTENSION_STORE_MONITOR_ENABLED=false`。建立 `extension-beta` Environment，只允許 beta 發佈標籤部署，加入測試 API URL 與專用配對 Secret。
4. 提交後從乾淨 checkout 封裝、驗證。交付 ZIP、SHA-256、release.json、TESTING.md；若 `0.1.1.1` 已對外交付，下一版使用 `0.1.1.2`，不重用舊版號裝新內容。
5. 下載檔案由受控管道提供；透過另一個可信管道確認版本及雜湊。SHA-256 驗證一致性，不是發佈者簽章。沒有 repo 權限的測試者無法直接下載本私人 repo 的 Release。
6. 測試者各自使用指定測試帳號配對，不共用 CI token，也不傳遞含有瀏覽器儲存或 IndexedDB 的 profile。完整安裝及更新步驟見 [extension-testing.md](extension-testing.md)。

## 建立或更新 CI 配對 Secret

1. 建立獨立 CI 測試帳號，只給驗證需要的學生／課程權限。不要使用管理員或日常個人帳號。
2. 在獨立瀏覽器 profile 安裝交付版，連到測試 API，登入 CI 測試帳號並核准配對。確認連線與 extension ID。
3. 從這個擴充功能 popup 的 DevTools Console 複製憑證到剪貼簿；下列命令不將 token 印到 Console：

   ```javascript
   copy((await chrome.storage.local.get('edulogExtension')).edulogExtension.token)
   ```

4. GitHub Settings → Environments → `extension-beta` → Environment secrets → `EXTENSION_API_TOKEN`，貼上並保存，隨後清除剪貼簿。不要把值貼在 issue、聊天、命令列參數或截圖。
5. token 有效期沿用 90 天。過期前重新配對並替換 Secret，確認新憑證可用後在 EduLog「整合／連線管理」撤銷舊配對。側載切換商店 ID 時同樣重新配對。

雖然 CI 只查詢 `/api/extension/v1/me`，憑證本身可操作該帳號獲授權的擴充功能 API。最少權限及測試資料隔離不能省略。GitHub Secret 遮罩只保護部分日誌顯示，無法阻止有權修改 workflow 的人外傳憑證。

## OIDC 信任條件

以下數字 ID 已從 GitHub 查核：repository `1149427625`、owner `59145509`。若轉移 repo，重新核對 owner 與信任設定。Google Cloud project number／pool／provider／service account 尚待建立，不能從 GitHub ID 推導。

啟用 Chrome Web Store、IAM、Service Account Credentials、Security Token Service APIs；建立 service account 並在 Chrome Web Store Developer Dashboard 連結。只在該 service account 上向受限 WIF principal 授予 `roles/iam.workloadIdentityUser`；不要為此加入 project Owner／Editor，也不要匯出 service account 私鑰。Google 官方 auth action 的 impersonation 設定見下方來源。

WIF 的 GitHub issuer 為 `https://token.actions.githubusercontent.com`，基本 mapping：

```text
google.subject=assertion.sub
attribute.repository_id=assertion.repository_id
attribute.repository_owner_id=assertion.repository_owner_id
```

beta 發佈 provider 的 attribute condition：

```text
assertion.repository_id == '1149427625' &&
assertion.repository_owner_id == '59145509' &&
assertion.event_name == 'push' &&
assertion.ref.startsWith('refs/tags/extension/beta/') &&
assertion.workflow_ref == 'kenny1203520/EduLog/.github/workflows/extension-release.yml@' + assertion.ref &&
assertion.sub == 'repo:kenny1203520/EduLog:environment:extension-beta'
```

stable 啟用時使用獨立 provider 條件，將 beta tag prefix／environment 改為 stable。`extension-beta`／`extension-stable` Environment 可覆寫同名 `CWS_WORKLOAD_IDENTITY_PROVIDER` Variable，選擇各自 provider。

監看使用獨立 provider，條件為：

```text
assertion.repository_id == '1149427625' &&
assertion.repository_owner_id == '59145509' &&
assertion.event_name in ['schedule', 'workflow_dispatch'] &&
assertion.ref == 'refs/heads/master' &&
assertion.workflow_ref == 'kenny1203520/EduLog/.github/workflows/extension-store-status.yml@refs/heads/master' &&
assertion.sub == 'repo:kenny1203520/EduLog:environment:extension-store-monitor'
```

建立 `extension-store-monitor` Environment，deployment branch rule 只允許 `master`；在該環境設監看 provider Variable。IAM binding 限制此 repo 的 principalSet，不把整個 pool 無條件授權。檢查 pool 內所有 provider 都受限，避免其他寬鬆 provider 繞過條件。

這些條件適用 GitHub 預設 OIDC subject 格式；若組織有自訂 subject template，必須先核對實際 claims，調整後測試拒絕條件，不能移除 repo／event／ref／workflow 限制來讓認證通過。

監看要求 readonly scope，但同一 service account 仍擁有 publisher 的發佈權限。可修改監看 workflow 的人可能改變請求 scope，因此預設分支及此環境同樣屬於發佈安全邊界。Google 目前每個 publisher 只支援一個已連結 service account；兩個商店 Item ID 不隔離 publisher 權限。

## 檢查與限制

```powershell
rtk proxy npm --prefix extension run scan-secrets
rtk proxy npm --prefix extension run test:release
rtk proxy npm --prefix extension run verify-package
```

掃描目前擴充功能、發佈工具與 workflow 的常見私鑰／權杖／內嵌憑證樣式；封裝與驗證還會掃描解壓後的實際 runtime。錯誤只顯示檔名、行數及規則，不輸出匹配值。僅精確排除既有負向 URL 測試的一個已知合成值，不整檔略過測試資料。

此掃描不涵蓋完整 Git 歷史、舊日誌、遠端 artifact、任意編碼或拆開組合的密鑰，也不取代 GitHub secret scanning／push protection（依方案提供）或專門的歷史掃描工具。版本來源、逐檔雜湊及 receipt 能協助核對，不能抵抗已有 repo 寫入／管理權限的惡意操作者。API readiness 驗證能力，不證明部署 commit 或完整 migration ledger。

## 疑似外洩處理

1. 先撤銷 EduLog 配對，或撤銷 WIF／service account 發佈存取，停止受影響工作；確認商店沒有陌生送審或上線版本。
2. 產生替代憑證並更新 Secret。若是長效私鑰外洩，停用／刪除舊 key；僅新增另一個 Secret 不會撤銷舊憑證。
3. 檢查 GitHub Actions、Release、測試下載位置及 Google Cloud Audit Logs。刪除含敏感值的日誌／產物；若涉及 Git 歷史，另行規劃清理與協作者同步。
4. 以更高版本交付修復，保留不含祕密的事件紀錄。公鑰或 extension ID 被公開本身不需要輪替；原始憑證洩漏才需要撤銷。

來源：[Chrome manifest 公鑰](https://developer.chrome.com/docs/extensions/reference/manifest/key)、[Chrome Web Store service accounts](https://developer.chrome.com/docs/webstore/service-accounts)、[Google WIF](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)、[GitHub Actions 安全](https://docs.github.com/en/actions/reference/security/secure-use)、[Google auth action](https://github.com/google-github-actions/auth)。
