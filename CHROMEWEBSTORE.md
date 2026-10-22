# Chrome Web Store Listing — EduLog Teaching Tools BETA

Last updated: 2026-10-18. Local ZIP channel; no developer account or item created by this change.

## Store listing

**Name:** EduLog Teaching Tools BETA

**Short description:** THIS EXTENSION IS FOR BETA TESTING. Improve teaching system workflows with EduLog.

**Detailed description:**

THIS EXTENSION IS FOR BETA TESTING.

EduLog Teaching Tools 協助老師在支援的教學網站檢視課堂與學生紀錄，並與自行指定的 EduLog 系統核對及同步資料。

改善課堂、學生與報告頁面的閱讀及操作，保留原站表單與人工提交。使用工作台讀取指定教學資料，確認學生、課程與日期對應，預覽差異後明確確認同步。可參照既有報告、預填支援欄位，最後仍由老師檢查。

安裝後可使用頁面輔助。需要同步時，輸入管理者提供的 EduLog 網址、授予該站權限，登入並核准配對。本測試版目前支援 corp.orangeapple.co 的指定教學頁面，使用者須有合法帳號與權限。

資料只為使用者啟動的教學整合操作處理，傳送至指定 EduLog 系統。本機保留工作草稿及偏好；配對可在 EduLog 撤銷。請勿在未獲授權的測試中使用正式學生資料。

**Category:** Productivity

**Single purpose:** 協助老師核對及同步支援教學網站與其指定 EduLog 系統的教學紀錄。

**Primary language:** Traditional Chinese.

## Graphics and assets

| Asset | Dimensions | Status |
|---|---|---|
| Store icon | 128×128 PNG | Required; not prepared for submission |
| Screenshot | 1280×800 or 640×400 | Required; capture current synthetic workspace without student personal data |
| Additional screenshot | 1280×800 or 640×400 | Recommended; show explicit difference review |

Existing test screenshots are verification evidence, not automatically approved listing assets. Runtime currently omits icon references; add real size-matched files before store submission.

## Permissions justification

| Entry | Type | Purpose |
|---|---|---|
| `storage` | permission | Save browser pairing, language, display preferences and recoverable work configuration. |
| `sidePanel` | permission | Show the user's own EduLog report editor in the browser side panel beside a teaching-site report form, opened only when the teacher clicks 「在 EduLog 編輯」 for that tab. The editor can send a saved report id back for the teacher to review and apply on the form. |
| `https://corp.orangeapple.co/*` | host/content scripts | Provide supported teaching-page assistance and read class/student/report pages needed for user-requested review and sync. |
| `https://*/*` | optional host | Users host EduLog at different HTTPS origins. Request only the entered origin to pair and perform chosen teaching operations. The side panel frames that same origin, and this access lets the framed EduLog site use the user's existing EduLog sign-in. No content script runs outside the teaching site. |
| `http://localhost/*` | optional host | Connect to an explicitly selected local development EduLog. |
| `http://127.0.0.1/*` | optional host | Connect to an explicitly selected loopback development instance. |
| `http://[::1]/*` | optional host | Connect to an explicitly selected IPv6 loopback instance. |

## Privacy and data use

The extension handles user data. Do not declare “no user data”.

| Category | Handling | Off-device destination |
|---|---|---|
| Personally identifiable information | Student names/IDs, enrollments, device display metadata | Selected EduLog and existing source site |
| Authentication | Local scoped pairing token and installation UUID | Selected EduLog for authorization; not exposed to content scripts |
| Website content | Selected teaching reports, attendance, course/date evidence, selected internal notes | Selected EduLog for requested previews/sync |
| User activity / source references | Chosen source links, sync checkpoints and operations; no general browsing history | Selected EduLog as required |
| Location evidence | Source classroom/location text in selected records; no geolocation API | Selected EduLog if selected for import |

No advertising/analytics SDK, sale, unrelated use, creditworthiness/lending use or Chrome storage sync. Do not claim all content stays on-device. Local drafts follow existing cleanup rules; confirmed server reports remain durable.

The supported source site's localStorage also holds a cache of theme on/off and per-page original-view preferences for immediate rendering. It contains no credential, installation UUID or teaching content; the source site can read or change this UI cache.

Review the exact current Dashboard disclosure categories before submission. Health/financial/personal communication data are not extension features; free-text reports may contain sensitive information and require the operator's policy.

## Privacy policy

Draft: `docs/deployment/extension-privacy.md`.

**Public privacy URL:** REQUIRED, not configured. Host the reviewed policy publicly with publisher contact information.

## Distribution

Private BETA item limited to a managed tester Google Group / trusted Google accounts. Chrome and Edge use Chrome Web Store. Unlisted is not access control.

**Store item ID / public key:** REQUIRED, not created. Sideload ID is temporary and must not be used as an invented store item ID.

## Developer information

**Publisher / contact email:** REQUIRED; owner must supply.

**Support:** https://github.com/kenny1203520/EduLog/issues (no personal data or tokens).

**Homepage:** https://github.com/kenny1203520/EduLog

The repository is currently private. Homepage and support links above are for authorized collaborators, not publicly verified support endpoints. Before store submission, provide a reachable support/contact channel for all intended testers; do not invent a publisher email from the GitHub username.

## Release security

Manifest/public store keys and extension IDs are public identifiers, not authentication credentials. No private signing key or service-account JSON key is distributed. GitHub Actions uses OIDC for short-lived store access; the CI pairing token is an Environment Secret with a dedicated test account. Fixed IDs do not establish the authenticity of an unpacked ZIP.

Runtime archives and release sources are checked for common embedded credential patterns. Workflow dependencies are pinned to verified commits; ZIP jobs have no OIDC permission. Branch, tag and WIF restrictions must be configured before enabling automatic store publishing. See `docs/deployment/extension-security.md` for operator instructions and remaining external setup.

## Version history

| Version | Date | Changes | Status |
|---|---|---|---|
| 0.1.1.2 / 0.1.1-beta.2 | 2026-10-18 | Latest theme startup runtime; credential checks on source and actual archive; pinned, least-privilege release workflows | Local test package; not submitted |
| 0.1.1.1 / 0.1.1-beta.1 | 2026-10-17 | Reproducible fixed-ID ZIP and dedicated CI/CD; runtime from recorded source commit | Local test package; not submitted |
| 0.1.0 | Earlier development | Teaching workflows, review, import and prefill | Historical local development |

## Review notes

Supply reviewers a working source-site test account and reachable EduLog test instance with permissions and pairing approval, privately in reviewer instructions. Never put credentials in this file or the ZIP.

Remaining first-submission steps: account/2FA, listing assets, public privacy URL, publisher/contact, tester group, item/public key, WIF/service account and real Chrome/Edge installation/upgrade acceptance. See `docs/deployment/extension-release.md`.

No rejection history. Source forms are never automatically submitted. Deploy actual API capabilities instead of changing flags just for review.
