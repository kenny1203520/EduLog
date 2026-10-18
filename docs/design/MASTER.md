# EduLog 設計系統（MASTER）

適用：擴充功能 popup、整合工作台、原站（corp.orangeapple.co）改造頁、報告 modal 助手。
實作來源：`extension/styles/edulog-tokens.css`（`--edulog-*`）與 `extension/styles/ui-tokens.css`（`--ui-*` 別名）。
互動原型：`docs/design/prototype/index.html`。

> 本檔是唯一事實來源。頁面若需偏離，寫在 `docs/design/pages/<page>.md`，並註明理由。

## 1. 定位

- 產品：老師用的教學紀錄管理工具，資料密集、重複操作多（點名、填報告、匯入）。
- 風格：**Data-Dense Dashboard 的克制版**。清單列取代卡片、資訊靠對齊與字重分層，不靠底色塊。
- 只有淺色主題。暗色延後；未來暗色只覆寫同一組 `--edulog-*` 名稱。
- 一個畫面（或一列）**只有一個主操作**，其餘一律次要或收進「更多」。

### 與產生器建議的取捨

| 產生器建議 | 採用？ | 理由 |
|---|---|---|
| Primary `#1E40AF`、Secondary `#3B82F6` | 採用（Secondary 改用 `#2563eb`） | 與既有品牌一致；`#2563eb` 在白底對比 5.2:1，`#3B82F6` 只有 3.7:1 不足以當文字色 |
| CTA 琥珀 `#F59E0B` | **不採用** | 琥珀已是「警告／待處理」語意；CTA 用品牌藍，避免顏色雙重含義 |
| Text `#1E3A8A`（深藍） | 不採用 | 大量中文內文用中性深灰 `#0f172a` 更好讀；藍色保留給可點擊 |
| 字型 Fira Code / Fira Sans | **不採用** | 不含繁中字形，會 fallback 成混排；改用系統字＋Noto Sans TC，數字用 `tabular-nums` 對齊 |
| Hover tooltip、row highlight、filter 動畫 | 採用 | 只做顏色／透明度過渡，不做位移或縮放 |
| Hero > Features > CTA 版型 | 不適用 | 這不是行銷頁 |

## 2. 色彩

所有文字色在 `--edulog-surface`（白）上 ≥ 4.5:1。狀態色**一定搭配文字或 icon**，不可只靠顏色。

### 中性

| Token | 值 | 用途 |
|---|---|---|
| `--edulog-canvas` | `#f4f6fa` | 頁面底色（工作台、原型背景） |
| `--edulog-surface` | `#ffffff` | 清單、面板、modal |
| `--edulog-surface-subtle` | `#f8fafc` | 分組標題、表頭、hover 列 |
| `--edulog-surface-muted` | `#f1f5f9` | chip 底、次要按鈕 hover |
| `--edulog-surface-disabled` | `#e2e8f0` | 停用控制項 |
| `--edulog-text-strong` | `#0f172a` | 標題、姓名 |
| `--edulog-text` | `#172033` | 內文 |
| `--edulog-text-secondary` | `#334155` | 次要內文 |
| `--edulog-text-muted` | `#475569` | 說明、meta（課程·堂次） |
| `--edulog-text-subtle` | `#64748b` | 最弱可讀文字（時間戳）；不可用於主要內容 |
| `--edulog-border-soft` | `#eef2f7` | 列與列之間分隔線 |
| `--edulog-border` | `#dbe3ee` | 面板外框 |
| `--edulog-border-strong` | `#cbd5e1` | 次要按鈕外框 |
| `--edulog-border-input` | `#94a3b8` | 輸入框（3:1 非文字對比） |

### 品牌

| Token | 值 | 用途 |
|---|---|---|
| `--edulog-primary` | `#1e40af` | 主按鈕 hover/active、連結 |
| `--edulog-primary-bright` | `#2563eb` | 主按鈕底色、focus ring、選取中的篩選 |
| `--edulog-primary-soft` | `#eff4ff` | 選取列底、資訊提示底 |
| `--edulog-primary-soft-strong` | `#e0e9ff` | 選取中的 chip |
| `--edulog-primary-border` | `#bfdbfe` | 資訊提示框線 |

### 狀態（四級 + 中性）

| 語意 | 色條 / icon | 淡底 | 文字 | 用在 |
|---|---|---|---|---|
| 完成 ok | `--edulog-status-ok` `#047857` | `#e8f7ef` | `#166534` | 已點名、已填、已同步 |
| 待處理 warn | `--edulog-status-warn` `#d97706` | `#fef3c7` | `#78350f` | 未點名、資料未齊、例外 |
| 注意 notice | `--edulog-status-notice` `#ea580c` | `#fff7ed` | `#9a3412` | 節次不一致、兩邊都改過 |
| 逾期 danger | `--edulog-status-danger` `#b91c1c` | `#fef2f2` | `#991b1b` | 逾期未填、錯誤 |
| 資訊 info | `--edulog-status-info` `#2563eb` | `#eff4ff` | `#1e40af` | 今天、進行中 |
| 不適用 neutral | `--edulog-status-neutral` `#94a3b8` | `#f1f5f9` | `#475569` | 原站未開放、請假、未來 |

**規則**：狀態用「左側 3px 色條」或「小圓點＋文字」呈現；**禁止整列填滿黃色／紅色底**。淡底只用在 chip、tag、提示框。

## 3. 字型與字級

- 字型：`--edulog-font` = `system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "Microsoft JhengHei", sans-serif`。
- 數字（日期、堂次、計數、電話）：`font-variant-numeric: tabular-nums`。
- 行高：內文 1.5；列內單行 1.35。

| Token | 大小 / 字重 | 用途 |
|---|---|---|
| `--edulog-text-xs` | 12px / 500 | tag、chip 計數、時間戳（**最小**，不可再小） |
| `--edulog-text-sm` | 13px / 400 | 列 meta（課程·堂次）、表頭 |
| `--edulog-text-md` | 14px / 400–600 | popup 與原站改造頁內文、列主文字、按鈕 |
| `--edulog-text-base` | 16px / 400 | 工作台內文、行動版輸入框（避免 iOS 縮放） |
| `--edulog-text-lg` | 18px / 600 | 分區標題、modal 標題 |
| `--edulog-text-xl` | 22px / 700 | 工作台頁標題、完成頁數字 |

字重只用 400 / 500 / 600 / 700。

## 4. 間距、尺寸、形狀

- 4px 基準：`--edulog-space-1..8` = 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40。
- 列內左右 padding 12–16px；列高最小 `--edulog-row-min-height` 52px（姓名 + meta 兩行）。
- 控制項：`--edulog-control-height` 36px（桌面密集）；`--edulog-touch-target` 44px（行動版與 popup 主按鈕）。行動寬度下所有可點擊物 ≥ 44px。
- 圓角：`--edulog-radius-xs` 4px（tag）、`-sm` 6px（按鈕、輸入）、`--edulog-radius` 8px（面板）、`-lg` 12px（modal、popup 外框）、`--edulog-radius-pill`（chip）。
- 陰影：只有浮層（popover、modal、sticky bar）有陰影；清單與面板只用 1px 框線。
- z-index：10 raised / 20 sticky / 30 overlay / 1040 toolbar（沿用）。
- 動畫：`--edulog-duration` 160ms，只做 color / background / opacity / transform(旋轉箭頭)。`prefers-reduced-motion` 時為 0。

## 5. Icon

- 統一 **Lucide**（24×24 viewBox、`stroke-width: 2`、`stroke: currentColor`、`fill: none`），內嵌 SVG。
- 尺寸：`--edulog-icon-sm` 16px（列內、按鈕內）、`--edulog-icon` 20px（標題列、齒輪）。
- 純 icon 按鈕必加 `aria-label`，點擊區 ≥ 36px（行動 44px）。
- **禁止 emoji 當 icon**（✅ ⚠️ 📋 ⚙️ 等全面移除）。

常用對照：設定 `settings`、同步 `refresh-cw`、預填 `wand-2`/`file-pen`、工作台 `layout-dashboard`、紀錄 `history`、完成 `check`、警告 `alert-triangle`、逾期 `clock-alert`、電話 `phone`、展開 `chevron-down`、外部連結 `external-link`、連線 `plug`。

## 6. 元件

### 6.1 清單列（List row）——取代卡片

```
┃ 姓名（14/600）                         [狀態指示 × 4]   [主操作]
┃ 課程 · 第 N 堂 · 日期（13 muted）       請假/備註 tag
```
- 結構：`左色條 3px | 主欄（姓名 + meta） | 狀態欄 | 動作欄`。
- 色條顏色 = 該列最嚴重狀態（danger > warn > notice > ok/neutral 不顯示色條）。
- 列間只用 `--edulog-border-soft` 分隔線，hover 換 `--edulog-surface-subtle`，**不做陰影或位移**。
- 行動版（< 640px）：狀態欄換行到主欄下方，動作欄靠右對齊在第一行。
- 班級頁、月未填頁、未填頁、工作台例外清單**共用同一列元件**。

### 6.2 狀態指示（Status indicator）

- 形式：`● 標籤`（8px 圓點 + 12–13px 文字），或緊湊模式只有 16px icon + `title`/`aria-label`。
- 班級頁四項固定順序：**出席／完成狀況／內部紀錄／學習表現**，**過去、今天（含未開課）、未來一律顯示**。
- 值：`已填`(ok) / `未填`(warn) / `逾期`(danger) / `原站未開放`(neutral，無編輯連結時) / `請假`(neutral)。
- 永遠有文字或 aria-label，色盲可辨。

### 6.3 按鈕

| 種類 | 外觀 | 規則 |
|---|---|---|
| 主（Primary） | `--edulog-primary-bright` 底、白字、600；hover `--edulog-primary` | **每畫面 / 每列最多一顆** |
| 次（Secondary） | 白底、`--edulog-border-strong` 框、`--edulog-text` 字 | 取消、返回、次要動作 |
| 文字（Ghost/Link） | 無框、`--edulog-primary` 字 | 「更多」、「展開」、「在 EduLog 檢視」 |
| 危險 | 只在確認對話框內出現，`--edulog-status-danger` 底 | 不放在列上 |

- 非同步時 disable + spinner + 文字改「同步中…」；完成後回饋（toast 或行內）。
- 按鈕文字用動詞：同步本班、預填本報告、開啟工作台、填寫。

### 6.4 分組標題（Group header）

- `--edulog-surface-subtle` 底、13px/600、左側可放狀態圓點、右側計數 chip。
- 可收合（`chevron-down` 旋轉）。sticky 於清單頂端（`--edulog-z-sticky`）。
- 逾期組置頂並使用 danger 色條與「逾期」tag。

### 6.5 三步 Stepper

`① 讀取 → ② 確認 → ③ 完成`
- 水平；目前步驟藍色實心圓 + 粗體，已完成步驟綠色勾，未到步驟灰框。
- 有 `aria-current="step"`；文字永遠可見（不只數字）。
- 行動版縮成「步驟 2 / 3 · 確認」。

### 6.6 空狀態（Empty state）

- 24px icon（muted）＋一句結果＋一句下一步＋（至多）一顆按鈕。
- 例：「這週的報告都填完了」／「沒有需要確認的項目，可以直接完成同步」。
- 不使用插畫或 emoji。

### 6.7 Chip / Tag

- **Filter chip**（可點）：pill、高 32px（行動 36px）、未選白底框線、選中 `--edulog-primary-soft-strong` 底 + `--edulog-primary` 字 + 計數。
- 班級頁常駐四個：待處理／未點名／資料未齊／全部；其餘收進「更多 ▾」。
- **Tag**（不可點）：radius 4px、12px/500、淡底 + 狀態文字色。例：節次不一致、逾期、請假、今天。

### 6.8 連線狀態標籤（Popup 頂部）

- `● 已連線 EduLog` (ok)／`● 未連線` (neutral)／`● 連線異常` (danger)。

### 6.9 報告助手（modal）

- 未連線：**不掛載面板**，標題列只有小型次按鈕「連接 EduLog 以啟用報告助手」。
- 已連線但學生未同步：一行說明 +「同步本班」次按鈕。
- 已連線且已同步：預設展開，記住收合狀態。

## 7. 版面

- Popup：寬 360px，最高 560px；結構＝標題列（logo、連線標籤、齒輪）→ 情境說明一行 → 單一主按鈕（全寬 44px）→ 工作紀錄（N）入口。
- 工作台：最大寬 960px 置中；頂部 stepper；內容區清單；底部 sticky 動作列（左：次要、右：主要）。
- 原站改造頁：沿用原站容器寬度，工具列 sticky；清單列滿版。
- 斷點：375（行動）、768（平板）、1024、1440。不可有水平捲動。

## 8. 文案

- 繁體中文；動詞開頭；數字直接寫出（「3 位學生未對應」）。
- 例外分類固定用詞：**班級不明、配對不到課堂、兩邊都改過、學生未對應**。
- 已自動配對收成一行：「已自動配對 42 筆 · 展開」。

## 9. 反模式（禁止）

1. 整列黃色／紅色底標示狀態（改用色條＋指示）。
2. 一列或一畫面多顆同等強度的藍色按鈕。
3. emoji 當 icon；混用不同 icon 風格或尺寸。
4. 只用顏色表達狀態。
5. 因「本堂未開始」或「未來週次」隱藏報告狀態或填寫入口。
6. 未連線時自動展開大型面板佔版面。
7. 卡片包卡片、每列加陰影、hover 時縮放位移。
8. 把所有選項攤在第一層（主題、語言、伺服器收進齒輪；進階選項收合）。
9. 列出已成功的項目逐筆要人確認（只列例外）。
10. 預設顯示學生電話（點擊才顯示）。
11. 低於 12px 的文字、`#94a3b8` 以下對比的內文。
12. 「下拉選單選來源」當主要入口（改為「我的班級」清單）。

## 10. 交付前檢查

- [ ] 無 emoji icon，icon 皆 Lucide 同尺寸
- [ ] 每畫面只有一顆主按鈕
- [ ] 狀態都有文字/aria-label
- [ ] 文字對比 ≥ 4.5:1；focus ring 可見（`--edulog-focus-ring` 3px）
- [ ] 375 / 768 / 1440 無水平捲動，行動版點擊區 ≥ 44px
- [ ] `prefers-reduced-motion` 生效
- [ ] 過去／今天未開課／未來週次皆顯示四項狀態
