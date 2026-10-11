// Shared extension-owned presentation. Provider content is never registered here.
(() => {
  if (globalThis.edulogUi) return
  const catalog = {
    'ui.language': ['介面語言', 'Interface language'],
    'ui.settings': ['設定', 'Settings'],
    'ui.navigation': ['網站導覽', 'Site navigation'],
    'ui.integration': ['EduLog 功能', 'EduLog tools'],
    'ui.integrationPanel': ['EduLog 連線與整合', 'EduLog connection and tools'],
    'ui.closePanel': ['關閉 EduLog 整合面板', 'Close EduLog tools'],
    'ui.themeOn': ['套用清晰主題', 'Use light theme'],
    'ui.themeOff': ['使用原站主題', 'Use original theme'],
    'ui.work': ['繼續工作／工作紀錄', 'Continue work / work history'],
    'ui.sourceTeaching': ['原站教學 · 工作台同步', 'Teach here · sync in the workspace'],
    'flow.import': ['同步教學資料', 'Sync teaching data'],
    'flow.importHelp': ['讀取完整歷史，集中核對例外與同步摘要。', 'Read full history, review exceptions, and confirm the sync summary.'],
    'flow.prefill': ['預填目前報告', 'Prefill current report'],
    'flow.prefillHelp': ['在原站核對欄位，再由您人工送出。', 'Review fields in the source form, then submit it yourself.'],
    'flow.details': ['操作說明', 'How it works'],
    'flow.ready': ['可開始', 'Ready'],
    'flow.notReady': ['此操作未就緒', 'Operation unavailable'],
    'flow.connect': ['先完成連線', 'Connect first'],
    'flow.unavailable': ['此連線未提供這項操作，請重新檢查連線或查看診斷。', 'This connection does not provide this operation. Recheck it or view diagnostics.'],
    'work.saved': ['草稿已保存在此瀏覽器', 'Draft saved in this browser'],
    'work.unsaved': ['正在保存草稿…', 'Saving draft…'],
    'work.saving': ['正在保存草稿…', 'Saving draft…'],
    'work.saveUncertain': ['尚未確認這次保存結果。上次成功保存：{savedAt}', 'This save is not confirmed. Last successful save: {savedAt}'],
    'work.ready': ['尚未開始工作', 'No work started'],
    'work.saveFailed': ['草稿保存失敗。上次成功保存：{savedAt}', 'Draft save failed. Last saved: {savedAt}'],
    'work.saveFailedTitle': ['草稿保存失敗', 'Draft save failed'],
    'work.saveFailedHelp': ['最新內容尚未確認保存；目前畫面仍保留內容。請重試保存，成功後才能繼續核對。同步目前已停用。', 'The latest changes are not confirmed as saved. Your current screen still holds them. Retry the save before continuing review. Sync is disabled.'],
    'work.saveUncertainTitle': ['保存結果待確認', 'Save result needs confirmation'],
    'work.saveUncertainHelp': ['尚未確認最新保存結果。先檢查本機保存狀態，再重試核對；同步目前已停用。', 'The latest save result is unconfirmed. Check local save status, then retry review. Sync is disabled.'],
    'work.loadingFullDraft': ['正在載入此工作的完整本機草稿…', 'Loading the full local draft…'],
    'work.fullDraftLoadFailed': ['完整草稿讀取失敗：{message}', 'Could not load the full draft: {message}'],
    'work.retrySaveContinue': ['重試保存並繼續讀取', 'Retry saving and continue reading'],
    'work.settings': ['本次同步設定', 'Settings for this sync'],
    'work.settingsHelp': ['共用規則與欄位偏好；逐份報告可另外調整。', 'Shared rules and field preferences; each report can be adjusted separately.'],
    'work.continue': ['繼續未完成工作', 'Continue unfinished work'],
    'work.new': ['建立新工作', 'Start new work'],
    'work.resumeHelp': ['此來源已有未完成草稿，請選擇繼續或建立新工作。', 'There is an unfinished draft for this source. Continue it or start new work.'],
    'work.remaining': ['處理剩餘項目', 'Resolve remaining items'],
    'work.filter': ['工作狀態', 'Work status'],
    'work.all': ['全部工作', 'All work'],
    'work.resumable': ['可繼續', 'Can continue'],
    'work.attention': ['需要處理', 'Needs attention'],
    'work.done': ['已完成', 'Completed'],
    'work.local': ['本機草稿', 'Local draft'],
    'work.remote': ['EduLog 紀錄', 'EduLog record'],
    'work.merged': ['本機草稿＋EduLog 紀錄', 'Local draft + EduLog record'],
    'work.filteredEmpty': ['此篩選沒有工作紀錄。', 'No work matches this filter.'],
    'work.identity':['身份與課程','Identity and courses'],
    'work.reports':['報告例外','Report exceptions'],
    'work.reason':['依問題篩選','Filter by issue'],
    'work.allReasons':['所有原因','All reasons'],
    'work.date':['日期','Date'],
    'work.field':['欄位映射','Field mapping'],
    'work.sourceConflict':['來源矛盾','Source conflicts'],
    'work.occurrence':['課次','Session'],
    'work.overwrite':['覆寫確認','Overwrite review'],
    'work.reviewed':['已核對','Reviewed'],
    'work.reviewNotChecked':['待檢查','Not checked'],
    'work.reviewPendingDecision':['待決定','Decision needed'],
    'work.remainingIssues':['待處理問題 · {count} 項','Issues to resolve · {count}'],
    'work.reviewComplete':['已核對，待同步','Reviewed, ready to sync'],
    'work.actionSummary':['待處理 {reports} 份報告 · {issues} 個問題 · 可同步 {ready} 份','{reports} reports need review · {issues} issues · {ready} ready to sync'],
    'work.historyBind':['可綁定課次','Ready to bind to a session'],
    'work.historyOnly':['先存歷史','Save as history only'],
    'work.historyNeeds':['需要處理','Needs review'],
    'work.historyLinked':['已綁定','Already linked'],
    'work.historySkipped':['已略過','Skipped'],
    'work.historyUnfilled':['尚未填寫','Not yet filled'],
    'work.historyOtherAdmission':['其他報名（未納入）','Other enrollment (not included)'],
    'work.historySystemExcluded':['系統排除','Excluded automatically'],
    'work.historyAutoExcluded':['未列入同步的來源列 · {count} 份','Source rows excluded from sync · {count}'],
    'work.historyAutoExcludedHelp':['這些來源列不會送出，也不需要逐筆確認；來源內容更新後重新讀取即可重新分類。','These source rows will not be submitted and need no individual review. Reread after the source changes to classify them again.'],
    'work.historyExclusionFilter':['{label}: {count} 份','{label}: {count}'],
    'work.historyNoAutoExcluded':['沒有尚未填寫、其他報名或系統排除項目。','No unfilled, other-enrollment, or automatically excluded rows.'],
    'work.historyUnknownCategory':['報告 {key} 的來源分類「{category}」不受支援；來源資料已保留，請重新核對。','Report {key} has an unsupported source classification “{category}”. The source data is preserved; review it again.'],
    'work.historyInvalidReference':['歷史報告 {sourceId} 缺少有效報名或日期；請返回核對並重新產生摘要。','History report {sourceId} is missing a valid enrollment or date. Return to review and generate the summary again.'],
    'work.unfilledNoSync':['原站尚未保存教學內容。這筆不會送出；之後來源填寫完成，再重新讀取即可核對。','No teaching content has been saved at the source. This row will not be submitted. Reread it after the source report is filled.'],
    'work.otherAdmissionNoSync':['這筆列屬於其他報名，系統無法可靠確認學生與課程，因此未納入目前同步。','This row belongs to another enrollment. Its student and course could not be verified, so it is excluded from this sync.'],
    'work.systemExcludedNoSync':['這筆列依目前同步條件由系統排除，不會寫入 EduLog。','This row is excluded under the current sync settings and will not be written to EduLog.'],
    'work.conflictSaving':['已記錄選擇，正在計入摘要並保存草稿…','Choice recorded. Updating the summary and saving the draft…'],
    'work.conflictSaved':['已核對並保存草稿；可於同步摘要再次確認。','Reviewed and saved as a draft. Confirm again in the sync summary.'],
    'work.conflictSaveFailed':['保存失敗，選擇仍保留；請重試保存。','Save failed. Your choice is preserved; retry the save.'],
    'work.conflictConfirmed':['已核對並保存草稿','Reviewed and saved'],
    'work.boundHistoryResume':['核對並更新原綁定課次','Review and update the originally linked lesson'],
    'work.historyOnlyAction':['先存歷史，不變更課次報告','Save history only; leave lesson report unchanged'],
    'work.historyOnlySelected':['已選擇先存歷史','History only selected'],
    'work.conflictRetry':['重試保存核對結果','Retry saving review'],
    'work.merge':['混合','Merge'],
    'work.conflictMode':['處理方式','Handling'],
    'work.historyCurrent':['目前歷史內容','Current saved history'],
    'work.mergeCommon':['兩邊相同','Shared by both'],
    'work.mergeSource':['來源新增','Added by source'],
    'work.mergeTarget':['EduLog 原有','Existing in EduLog'],
    'work.mergeText':['混合後內容','Merged content'],
    'work.mergeBlankLine':['（空白行）','(blank line)'],
    'work.mergeRegenerate':['依勾選重新產生內容','Regenerate from selected lines'],
    'work.mergeRefresh':['重新整理來源與目標差異','Refresh source and target differences'],
    'work.mergeStale':['來源或 EduLog 內容已變更；原混合草稿保留，但需重新整理差異後才能套用。','Source or EduLog content changed. Your merge draft is preserved; refresh the differences before applying it.'],
    'work.mergeRegenerateConfirm':['這會以目前勾選的逐行選擇取代手動編輯內容。要繼續嗎？','This replaces manual edits with the selected lines. Continue?'],
    'work.mergeWillClear':['混合結果為空白；確認後會清除此欄位。','The merged result is empty. Confirm to clear this field.'],
    'work.mergeClearConfirm':['我確認清除此欄位','I confirm clearing this field'],
    'work.mergeClearIssue':['混合後的「{field}」會變成空白；請先確認是否清除此欄位。','The merged “{field}” will be empty. Confirm whether to clear this field.'],
    'work.boundHistoryIssue':['此歷史已綁定原課次；請核對並同步相同整理結果，無法只更新歷史。','This history is linked to its original lesson. Review and sync the same result; history cannot be updated alone.'],
    'work.reportSaved':['已確認並保存草稿。','Confirmed and saved as a draft.'],
    'work.reportSaveFailed':['保存失敗，請重試。','Save failed. Please retry.'],
    'work.batchSaving':['正在保存套用至 {count} 份報告的本次決定…','Saving this decision for {count} reports…'],
    'work.batchSaved':['已套用並保存至 {count} 份報告；僅限本次工作。','Applied and saved for {count} reports in this work only.'],
    'work.saveConflict':['工作已在其他分頁更新；目前草稿保留，請重新載入後核對。','This work changed in another tab. Your draft is preserved; reload and review it.'],
    'work.count':['顯示 {visible}／{total} 份工作紀錄','Showing {visible} of {total} work records'],
    'assistant.apply': ['套用 {count} 個欄位 · 覆寫 {overwrite} 個', 'Apply {count} fields · overwrite {overwrite}'],
    'assistant.target': ['1 · 核對目標', '1 · Review target'],
    'assistant.candidates': ['2 · 選擇報告', '2 · Choose report'],
    'assistant.fields': ['3 · 核對欄位', '3 · Review fields'],
    'assistant.result': ['4 · 套用結果 · 待人工送出', '4 · Applied fields · submit manually'],
    'assistant.refresh': ['重新核對', 'Recheck'],
    'assistant.collapse': ['收合助手', 'Collapse assistant'],
    'assistant.expand': ['展開 EduLog 助手', 'Open EduLog assistant'],
    'assistant.native': ['原站表單', 'Source form'],
    'assistant.tab': ['EduLog 預填', 'EduLog prefill'],
    'assistant.title': ['EduLog 報告助手', 'EduLog report assistant'],
    'work.previewRefresh':['更新差異','Refresh differences'],
    'work.previewFailed':['差異核對失敗，可重試','Difference check failed; retry is available'],
    'work.previewRetry':['草稿與批次識別已保留；請重試核對，成功產生新摘要後再確認同步。','The draft and batch identifiers are preserved. Retry the check, then review the refreshed summary before syncing.'],
    'work.previewRetryNotice':['差異核對失敗，草稿已保留；請重試核對，成功後再確認同步。','The difference check failed and the draft is preserved. Retry the check before syncing.'],
    'work.applyBatches':['確認並分批匯入','Confirm and import batches'],
    'work.previewBlockedRow':['已將無法核對的 {kind} {sourceId} 留在待處理；其他資料繼續檢查。','{kind} {sourceId} could not be verified and remains blocked; checking the other records.'],
    'error.importDependenciesUnavailable':['目前連線的 EduLog 尚不能安全核對跨批次報名關係。請重新檢查連線後重試；待處理資料仍保留。','The connected EduLog cannot safely verify cross-batch enrollment references yet. Recheck the connection and retry; blocked records remain available.'],
    'error.workConflict':['工作已在其他分頁更新；目前草稿保留，請重新載入後核對。','This work changed in another tab. Your draft is preserved; reload and review it.'],
    'error.workDataInvalid':['工作資料格式無效；本機草稿尚未變更。','The work data is invalid. The saved draft was not changed.'],
    'error.workStorageFull':['此瀏覽器的工作儲存空間不足。請移除不需要的本機工作草稿後重試。','This browser is low on storage. Remove unneeded local work drafts and retry.'],
    'error.workDataCorrupt':['本機草稿分段無法完整還原；保留其他工作並重新讀取此班級。','The local draft is incomplete. Other work is preserved; reread this class.'],
    'error.workSaveFailed':['本機草稿保存失敗；先前保存的內容仍保留。請重試。','The local draft could not be saved. The last saved version is preserved; retry.'],
    'error.bridge.CONTEXT_INVALIDATED':['擴充套件已更新，請先保存目前內容，再重新整理分頁。','The extension was updated. Save current content, then reload the page.'],
    'error.bridge.BRIDGE_MESSAGE_TOO_LARGE':['工作資料超過背景通訊容量；目前草稿尚未確認保存。','The work exceeded the background message limit; the latest draft is not confirmed saved.'],
    'error.bridge.BRIDGE_CHANNEL_CLOSED':['背景服務中斷了這次回應；請先確認草稿保存狀態再重試。','The background service closed this response. Check the draft save status before retrying.'],
    'error.bridge.BRIDGE_NO_RECEIVER':['擴充套件背景服務尚未就緒；請稍候後重試。','The extension background service is not ready. Wait briefly, then retry.'],
    'error.bridge.BRIDGE_UNAVAILABLE':['擴充套件背景服務暫時無法使用；請確認草稿保存狀態後重試。','The extension background service is temporarily unavailable. Check the draft save status before retrying.'],
    'error.workOwnerMismatch':['這份工作屬於其他 EduLog 實例或使用者。','This work belongs to another EduLog instance or user.'],
    'work.savedAtUnknown':['尚無成功保存版本','no successful save'],
    'work.previewPartial':['摘要已準備。部分資料待處理；確認後只會同步可處理資料。','Summary ready. Some records need attention; confirming will sync only eligible records.'],
    'work.blockedCount':['被阻擋的來源資料：{count} 筆','Blocked source records: {count}'],
    'work.blockedSummary':['待處理來源資料：{count} 筆。確認後僅同步已核對的資料；被阻擋資料會保留在工作中。','Blocked source records: {count}. Confirming syncs only verified records; blocked records remain in this work.'],
    'work.applyEligible':['僅同步可處理資料','Sync eligible records only'],
    'work.confirmEligible':['仍有 {count} 筆來源資料無法核對。確認後只會寫入可處理批次，待處理資料會保留。要繼續嗎？','{count} source records could not be verified. Only eligible batches will be written, and blocked records will remain. Continue?'],
    'work.sourceChoice':['來源分頁 · 查看／修改','Source tab · view / change'],
    'work.skipSummary':['先前略過：內容／對應變動或待首次確認 {changed} 份、期限已到 {expired} 份、維持略過 {stable} 份','Previously skipped: {changed} changed or awaiting first confirmation, {expired} expired, {stable} remain skipped'],
    'work.skipBatchSelected':['已選取 {count} 份先前略過、需要重新確認的報告。','{count} previously skipped reports selected for confirmation.'],
    'work.skipBatchSelect':['選取先前略過報告以批次確認','Select previously skipped report for batch confirmation'],
    'work.skipBatchConfirm':['繼續略過所選報告','Continue skipping selected reports'],
    'work.skipBatchFailed':['保存失敗，所選項目仍保留；請重試。','Could not save. Your selection is preserved; try again.'],
    'work.skipReport':['略過此份紀錄','Skip this report'],
    'work.continueSkipping':['繼續略過','Continue skipping'],
    'work.cancelSkipping':['取消略過','Undo skip'],
    'work.skipSaved':['已確認略過','Skip confirmed'],
    'work.resumeReview':['恢復核對','Resume review'],
    'work.skipSaveFailed':['保存失敗，重試','Save failed; retry'],
    'work.skipChanged':['此報告先前略過，但來源內容已變動。請恢復核對，或確認繼續略過。','Previously skipped; source content changed. Resume review or confirm skipping again.'],
    'work.skipExpired':['此報告先前略過已滿 30 天。請恢復核對，或重新確認略過。','This skip decision is over 30 days old. Resume review or confirm skipping again.'],
    'work.skipContextChanged':['此報告先前略過時的目標對應已改變。請重新確認。','The target mapping changed since this report was skipped. Please confirm again.'],
    'work.skipLegacy':['舊工作曾略過此報告，但沒有可比對的版本資料。請確認一次。','An older work skipped this report without a comparable version. Please confirm once.'],
    'work.conflictHelp':['衝突預設保留 EduLog。勾選改用來源欄位後，必須重新產生差異。','Conflicts keep EduLog values by default. After selecting source values, refresh the preview.'],
    'work.import1':['1 讀取與核對','1 Read and review'],'work.import2':['2 處理例外','2 Resolve exceptions'],'work.import3':['3 摘要並同步','3 Review and sync'],'work.import4':['4 匯入結果','4 Import results'],
    'work.prefill1':['1 確認目標','1 Confirm target'],'work.prefill2':['2 選擇報告','2 Choose report'],'work.prefill3':['3 檢查欄位','3 Review fields'],'work.prefill4':['4 套用至原站','4 Apply to source'],
    'work.state.collected':['已讀取，待核對','Read; review required'],'work.state.collecting':['正在讀取','Reading…'],'work.state.reviewing':['正在核對','Reviewing…'],'work.state.previewed':['摘要待確認','Summary requires confirmation'],'work.state.applying':['正在寫入','Writing…'],'work.state.paused':['已暫停','Paused'],'work.state.failed':['需要處理','Needs attention'],'work.state.stale':['同步受阻，需重新核對','Sync blocked; recheck required'],'work.state.outcome_unknown':['寫入結果待核對','Write outcome requires verification'],'work.state.partial_complete':['部分完成','Partially complete'],'work.state.complete':['已核驗完成','Verified complete'],'work.state.pending_confirm':['待人工送出／待確認','Manual submission required'],'work.state.cancelled':['已取消剩餘工作','Remaining work cancelled'],
    'flow.importStep1':['讀取每筆報名全部可讀歷史，可自行縮小日期範圍。','Read all accessible enrollment history, or choose a date range.'],
    'flow.importStep2':['沿用有效對應，只處理身份、日期、教材及覆寫例外。','Reuse valid matches and resolve identity, date, lesson, and overwrite exceptions.'],
    'flow.importStep3':['查看摘要後確認同步；寫入中斷可核對並續傳。','Review the summary and confirm sync. Interrupted writes can be checked and resumed.'],
    'flow.prefillStep1':['在原站開啟報告，核對學生及完整上課日期。','Open a source report and verify the student and full session date.'],
    'flow.prefillStep2':['選擇報告並逐欄預覽；非空內容需確認覆寫。','Choose a report and preview each field. Confirm overwrites of existing values.'],
    'flow.prefillStep3':['預填後由老師檢查與人工送出。','After prefilling, the teacher reviews and submits the source form.'],
  }
  let locale = /^en(?:-|$)/i.test(globalThis.navigator?.language || '') ? 'en' : 'zh-TW'
  const bindings = new Map(), listeners = new Set()
  const normalize = value => value === 'en' ? 'en' : 'zh-TW'
  function t(key, params = {}) {
    const entry = catalog[key]
    return String(entry ? entry[locale === 'en' ? 1 : 0] : key).replace(/\{(\w+)\}/g, (_, name) => typeof params[name]==='number' ? new Intl.NumberFormat(locale).format(params[name]) : String(params[name] ?? ''))
  }
  function text(el, key, params = {}, attr) {
    if (!el) return el
    if (!attr) el.dataset.i18n = key
    bindings.set(el, { key, params, attr }); update(el, bindings.get(el)); return el
  }
  function update(el, binding) { const value = t(binding.key, typeof binding.params === 'function' ? binding.params() : binding.params); if (binding.attr) el.setAttribute(binding.attr, value); else el.textContent = value }
  function bind(root) { for (const el of root.querySelectorAll('[data-i18n]')) text(el, el.dataset.i18n, {}, el.dataset.i18nAttr) }
  function setLocale(value) {
    const next = normalize(value), changed = next !== locale; locale = next
    // Capture geometry before translated labels change wrapping. Keep the actual
    // controls, focus and selection; restore scroll after compatibility observers.
    const positions=[],collect=root=>{for(const el of root?.querySelectorAll?.('*')||[]){if(el.scrollTop||el.scrollLeft)positions.push([el,el.scrollTop,el.scrollLeft]);if(el.shadowRoot)collect(el.shadowRoot)}}
    if(changed)collect(globalThis.document)
    const pageY=globalThis.scrollY||0,pageX=globalThis.scrollX||0
    for (const [el, binding] of bindings) { if (!el.isConnected) { bindings.delete(el); continue } update(el, binding) }
    if (changed) for (const listener of listeners) listener(locale)
    if(changed&&globalThis.requestAnimationFrame)requestAnimationFrame(()=>requestAnimationFrame(()=>{if(locale!==next)return;for(const [el,top,left] of positions)if(el.isConnected){el.scrollTop=top;el.scrollLeft=left}globalThis.scrollTo?.({top:pageY,left:pageX,behavior:'instant'})}))
  }
  async function saveLocale(value) {
    setLocale(value)
    // The worker validates both the sender and the bounded language value.
    const result = await globalThis.edulogRuntime?.send({ type: 'set-ui-preferences', language: normalize(value) })
    if (result?.error) throw new Error('PREFERENCES_UNAVAILABLE')
  }
  function languageSelect(doc = document) {
    const select = doc.createElement('select'); text(select, 'ui.language', {}, 'aria-label')
    for (const [value, label] of [['zh-TW', '繁體中文'], ['en', 'English']]) { const option = doc.createElement('option'); option.value = value; option.textContent = label; select.append(option) }
    select.value = locale; select.addEventListener('change', () => void saveLocale(select.value).catch(() => {})); subscribe(value => { select.value = value }); return select
  }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
  const styles = `:host{--ui-primary:#2563eb;--ui-text:#0f172a;--ui-muted:#475569;--ui-border:#cbd5e1;--ui-surface:#fff;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ui-text)}button,input,select,textarea{font:inherit;min-height:44px}small,.hint,.muted,.note{font-size:14px}button,input,select,textarea,a,summary{scroll-margin:80px 0}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #2563eb;outline-offset:3px}[hidden]{display:none!important}`
  globalThis.edulogUi = Object.freeze({ t, text, bind, setLocale, saveLocale, subscribe, languageSelect, styles, get locale() { return locale }, register(entries) { Object.assign(catalog, entries) } })
  globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => { if (area === 'local' && changes.edulogWorkspaceLocale?.newValue) setLocale(changes.edulogWorkspaceLocale.newValue) })
  if (globalThis.chrome?.storage?.local?.get) void globalThis.chrome.storage.local.get('edulogWorkspaceLocale').then(data => { if (data.edulogWorkspaceLocale) setLocale(data.edulogWorkspaceLocale) }).catch(() => {})
})()
