# 原站改版 M5：圖示語意修正與學習帳號彈窗（0.1.0）

## M5a 圖示語意修正（commit 7b78e0f）

教師確認課次格四個圖示（依格內順序）：

| 圖示 | 意義 | 綠 | 黃（假設 `text-warning`） | 紅 | 灰 |
|---|---|---|---|---|---|
| 人像 | 出席 | 出席 | – | 缺席 | 未點名 |
| 筆 | 完成狀況 | 完整完成 | 尚未完成／章節未填（無法區分） | – | 未填 |
| 問號 | 內部紀錄 | 能跟上進度 | – | 跟不上（太難／分心） | 尚未選擇 |
| 對話 | 學習表現（學習紀錄、課堂評量、學習報告） | 已完成 | – | – | 未完成 |

M3／M4 將筆當成「學習紀錄已填」，造成「紀錄未填」與計數錯誤，已修正：

- `readSessionCell` 輸出 `attendanceMark`、`completionMark`、`internalMark`、`performanceMark`、`missing`、`behind`；缺席與下週課次沒有待處理。
- 卡片新增四格狀態列（圖示＋文字＋色；未點名前其他三格為「—」，缺席為「不適用」）。
- 需關注（紅）：缺席、跟不上進度、課程到期；待處理（琥珀）：未點名、資料未齊（完成狀況待確認／未填、內部紀錄未選、學習表現未完成）、剩餘 ≤2 堂。
- 篩選籤：待處理｜需關注｜未點名｜資料未齊｜全部｜非本堂；預設依序選待處理、需關注、全部。

## M5b 學習帳號彈窗

- `#accounts-modal` 經既有 `enhanceDialogs` 流程增強（`orange-apple-accounts.js`）。
- 已設定的平台（有帳號值）各一列：平台名、帳號（可複製；測驗平台網址可開啟）、密碼預設遮罩，並有「顯示」與「複製」（複製後顯示「已複製」2 秒）、「編輯」展開原生表單。
- 未設定平台收進「新增平台帳號」選單；選擇後觸發原站自己的「新增…」按鈕並展開對應原生表單。原站五顆新增按鈕隱藏。
- 原生密碼欄改為 `type=password`，附「顯示密碼」；值與送出流程不變，送出仍是原生表單與原生按鈕。
- 修正原站格式檢查（可還原）：Roblox、麥塊的 Email pattern 缺反斜線（`^w+…`），改為正確 Email 規則；AnyDesk 不再強制 Email（pattern 改為 `.*`，保留屬性位置以確保完整還原）。只修正偵測到的錯誤 pattern，其餘原站 pattern 不動。
- 去識別 fixture：`accounts-basic.html`（僅學苑帳號、各區塊 hidden）、`accounts-exam.html`（學苑＋測驗網址、各區塊已顯示），保留原站重複 id 與錯誤 pattern。

## 已驗證

- 完整擴充功能測試：348/348 通過。新增 `accounts.test.mjs`（平台清單、遮罩不外洩、顯示／複製／編輯、新增選單觸發原生按鈕、pattern 修正、兩種 fixture 還原後 HTML 完全相同）、`site-model.test.mjs` 四圖示（含 `<svg>` class 變體）測試，更新 `session-cards.test.mjs`。
- 新增 `accounts-browser-check.mjs`：兩種 fixture × 360／390／768／1024／1440，無溢出、觸控 ≥44px、密碼遮罩、編輯展開原生表單、還原。修正 360px 下彈窗寬度多出 2px。
- `browser-check.mjs`、`startup`、`unfilled-rating`、`editor-date` 通過。

## 待實站確認

- 完成狀況黃色的實際 class（假設 `text-warning`）。
- 問號、對話圖示在實站為 `fa-circle-question`／`fa-comment-dots`（svg）或 `fa-question-circle`／`fa-commenting`（i），兩者皆支援。
- 原站送出帳號表單後的回應（Turbo 重新渲染彈窗時應自動重新增強）。

## 後續

- M6：課堂記錄彈窗（填寫編輯器）重構。
