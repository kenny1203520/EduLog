import { readHistoryWork } from './history-reader.js'
import '../shared/field-mapping-ui.js'
import { createMappingController } from './mapping-controller.js'
import { mappedReport, attachImportFields } from './import-field-mappings.js'
import { historyIdentity, planHistory, teachingFields, bindingStillMatches } from './history-sync.js'
import { createHistoryWorkbench } from './history-workbench.js'
import { createReportSkipController } from './report-skip-controller.js'
import { admissionIdentity, mergeRecords } from './mapping-core.js'
import { labels, splitBatches, validateBatches, importBatchRequest, workspaceErrorMessage, isUnsupportedReportEvidencePathValidation, plainText, suggestedValue } from './workspace-model.js'
import { workflowState, combineWorkRecords, workCategory } from './workflow-state.js'
import {comparison,decisionResult,semanticValue,outcomeMetrics} from './review-ui.js'
import { initWorkspaceI18n } from './workspace-i18n.js'
import { workStore } from '../shared/work-store.js'
import { createReviewSaveCoordinator } from './history-review-save.js'
import { prepareStaleReviewBatchRefresh } from './history-review-batches.js'
import { renderReviewBlockers } from './history-review-issues.js'
import { workspaceInterfaceFailure } from './workspace-operation-errors.js'
import { entries as stepEntries, classEntries, exceptionModel, renderClassList, renderConfirmOverview, hydrateIcons } from './workspace-steps.js'
const bridge = globalThis.edulogRuntime, $ = id => document.getElementById(id)
globalThis.edulogUi?.register(stepEntries)
initWorkspaceI18n()
hydrateIcons(document.body)
let fieldRules=[]
let saveState='saved', lastSavedAt=null, lastSavedRevision=0, lastSavedWorkId='', saveFailure=null, saveFailureWorkId=''
let activeOperationLabel=''
let reviewSaveCoordinator
const syncFields=[['lesson_id','教材'],['is_completed','完成狀況'],['progress_letter','章節進度'],['attendance_status','出席狀態'],['absence_reason','不出席原因'],['class_participation','課程參與'],['classroom_behavior','課堂秩序'],['content','學習報告'],['contact_notes','聯絡欄'],['class_notes','內部紀錄'],['external_link','報告連結']]
let syncPreferences={fields:{},revision:null},syncDraftOverrides={}
let frontendSettingsUrl = null
let integrationCapabilities = {}
let binding, context, tabs = [], work, form, reports = [], report, reportCursor = '', reportCourseCursor = '', classroomCursor = '', mappingCourseCursor = '', activeCourseRoom = '', studentCursors = {}, studentCandidates = {}, studentSearchTimers = {}, reportSearchTimer, mappingSearchTimer, busy = false, paused = false, cancelRequested = false, selectedPath = '', sourceContext = null, classSourceReady = false, reportSourceReady = false, generation = 0, previewResults = [], batchBytes = 180000, unsaved = false, editTimer, activeReadId = '', activeReadGeneration = 0, readFinished = Promise.resolve(), finishRead = () => {}
let activeFlow = 'import', continuation = null, unsavedWorkId = '', workHistory = { local: [], remote: null, metadata: [] }, selectedWorkRecord = null, selectedWorkLoad = 0
const workDetailCache=new Map()
const activeWorks = {import:null,prefill:null}, activeStages = {import:1,prefill:1}
function currentWorkflow(view) { const identity=work?.type==='import'&&work.snapshot?work.snapshot.records.filter(row=>row.kind==='enrollment'&&!row.sourceSkipped&&!mappingController.validateRow(row,true)).length:0;return workflowState(view,{work:work?.type===view?work:activeWorks[view],form,report,previewCount:previewResults.length,unresolved:identity+historyPlan.filter(item=>item.category==='needs').length}) }
function taskStatus() {
  updateApplyAvailability()
  const ui=globalThis.edulogUi
  const currentSaveState=saveFailureWorkId===work?.id?saveState:unsavedWorkId===work?.id?saveState:'saved'
  const savedAt=lastSavedWorkId===work?.id&&lastSavedAt?new Intl.DateTimeFormat(ui?.locale||'zh-TW',{dateStyle:'short',timeStyle:'short'}).format(new Date(lastSavedAt)):work?.updatedAt?new Intl.DateTimeFormat(ui?.locale||'zh-TW',{dateStyle:'short',timeStyle:'short'}).format(new Date(work.updatedAt)):ui?.t('work.savedAtUnknown')||'尚無成功保存版本'
  if(work?.collectionSaveError||currentSaveState==='failed'||currentSaveState==='uncertain'){ui?.text($('draft-status'),currentSaveState==='uncertain'?'work.saveUncertain':'work.saveFailed',{savedAt});$('retry-history-save').hidden=false}
  else {ui?.text($('draft-status'),currentSaveState==='saving'?'work.saving':currentSaveState==='pending'?'work.unsaved':work?'work.saved':'work.ready');$('retry-history-save').hidden=true}
  $('task-title').textContent=work?.title||sourceContext?.title||''
  const reviewRequired=work?.previewError?.code==='STALE_REPORT_REVIEW_REQUIRED'
  if(work?.previewError?.code==='WORKSPACE_UI_ERROR'){ui?.text($('task-status'),'work.interfaceFailed');return}
  const previewFailed=work?.previewError&&work.previewDirty&&!['outcome_unknown','applying','stale'].includes(work.status)&&!reviewRequired
  if(reviewRequired){ui?.text($('task-status'),'work.staleReportReviewRequired');return}
  $('task-status').textContent=previewFailed?(ui?.t('work.previewFailed')||'差異核對失敗，可重試'):work ? ({collected:'已讀取，待核對',collecting:'正在讀取',reviewing:'正在核對',previewed:'摘要待確認',applying:'正在寫入',paused:'已暫停',failed:'需要處理',stale:'同步受阻',outcome_unknown:'寫入結果待核對',partial_complete:'部分完成',complete:'已核驗完成',pending_confirmation:'待人工送出',cancelled:'已取消剩餘工作'})[work.status]||'草稿' : ''
  if(previewFailed)return
  if(work&&ui&&ui.t('work.state.'+work.status)!=='work.state.'+work.status)ui.text($('task-status'),'work.state.'+work.status)
  else ui?.text($('task-status'),'diff.value',{value:work?.status||''})
}
const params = new URLSearchParams(location.search)
const fieldLabels = { report_date: '上課日期', source_fields: '允許的教學原文', source_evidence: '來源位置', identity_status: '來源身份', source_key: '來源紀錄識別', name: '名稱', subject: '科目', stage: '階段', display_name: '課程名稱', external_link: '原站連結', classroom_id: '教室', course_ids: '班級可上課程', student_id: '學生', course_id: '課程', class_session_id: '班級', enrollment_id: '報名', class_occurrence_id: '課次', start_date: '開始日期', day_of_week: '星期', start_time: '開始時間', end_time: '結束時間', original_start_time: '課次開始時間', original_end_time: '課次結束時間', occurrence_date: '課次日期', time_zone: '時區', status: '報名狀態', content: '學習表現', is_completed: '課程完成狀況', progress_letter: '章節進度', attendance_status: '出席', absence_reason: '缺席原因', lesson_id: '教材', class_participation: '課程參與', classroom_behavior: '課堂秩序', contact_notes: '聯絡欄', class_notes: '內部紀錄' }
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n }
function notice(message = '', error = false) { $('notice').textContent = message; $('notice').dataset.error = String(error) }
function localizeBridgeError(error){if(['CONTEXT_INVALIDATED','BRIDGE_MESSAGE_TOO_LARGE','BRIDGE_CHANNEL_CLOSED','BRIDGE_NO_RECEIVER','BRIDGE_UNAVAILABLE'].includes(error?.code)){const message=globalThis.edulogUi?.t(`error.bridge.${error.code}`);if(message)error.message=message}return error}
async function send(message) {
  if(message.type==='workspace-store'){
    let authorized
    try{authorized=await bridge.send({type:'workspace-store-authorize',binding,action:message.action,workId:message.id||message.work?.id,revision:message.work?.revision})}
    catch(error){error.saveTransportStage='authorize';throw localizeBridgeError(error)}
    if(authorized?.error){const error=new Error(workspaceErrorMessage(authorized.error));Object.assign(error,authorized.error);error.saveTransportStage='authorize';throw localizeBridgeError(error)}
    const identity=authorized?.data,owner=identity&&{instance:identity.instance,userId:identity.userId}
    if(!owner?.instance||!owner?.userId){const error=new Error('無法確認此草稿所屬的 EduLog 實例與帳號。');error.code='WORK_OWNER_MISMATCH';throw error}
    try{
      if(message.action==='list')return await workStore.list(owner)
      if(message.action==='get')return await workStore.get(message.id,owner)
      if(message.action==='delete')return await workStore.delete(message.id,owner)
      return await workStore.put(message.work,owner)
    }catch(error){error.saveTransportStage='indexeddb';throw error}
  }
  let response
  try{response=await bridge.send({ ...message, binding })}catch(error){throw localizeBridgeError(error)}
  if (response?.error) { const e = new Error(workspaceErrorMessage(response.error)); e.code = response.error.code; e.requestId = response.error.requestId; e.retryAfter = response.error.retryAfter; e.fields = response.error.fields; e.diagnosticSource=response.error.diagnosticSource; e.rawMessage = response.error.message; throw e }
  return response?.data
}
const api = (operation, body, extra = {}) => send({ type: 'workspace-api', operation, body, ...(['context','catalog','resolve','field-resolve','sync-preferences-get','reports','work','work-records','reconcile','import-info','history-list','history-route'].includes(operation) && activeReadId ? { requestId: activeReadId } : {}), ...extra })
const source = (action, extra = {}) => send({ type: 'workspace-source', action, tabId: Number($('source-tab').value), sourcePath: selectedPath, requestId: activeReadId || undefined, ...extra })
let saveChain=Promise.resolve(),saveRequestSequence=0
function save({projectWork} = {}) {
  const current=work
  if(!current)return Promise.resolve(false)
  const request=++saveRequestSequence
  unsaved=true;unsavedWorkId=current.id;saveState='pending';saveFailureWorkId=current.id;saveFailure=null;taskStatus()
  const pending=saveChain.catch(()=>{}).then(()=>persistWork(current,request,projectWork))
  saveChain=pending
  return pending
}
async function persistWork(current,request,projectWork) {
  saveState='saving';taskStatus()
  current.interfaceState={...(current.interfaceState||{}),stage:activeStages[current.type]||1}
  current.revision = (current.revision || 0) + 1
  const revision = current.revision
  let stored
  try{stored=await send({ type: 'workspace-store', action: 'put', work: projectWork ? projectWork(current) : current })}
  catch(error){if(work===current){saveState=error.saveTransportStage==='indexeddb'&&['BRIDGE_CHANNEL_CLOSED','CONTEXT_INVALIDATED'].includes(error.code)?'uncertain':'failed';saveFailure=error;saveFailureWorkId=current.id;taskStatus()}throw error}
  if (work === current && work.revision === revision && stored?.revision === revision) {
    if($('source-picker').dataset.workId!==work.id){$('source-picker').open=false;$('source-picker').dataset.workId=work.id}
    // `put` crosses the extension messaging boundary and returns a structured
    // clone. Replacing the live snapshot here detaches controls that still
    // reference its report records. Keep the in-memory graph and copy only
    // persistence metadata; terminal cleanup is still reflected locally.
    current.updatedAt = stored.updatedAt
    current.expiresAt = stored.expiresAt
    if(workDetailCache.has(current.id))workDetailCache.set(current.id,current)
    lastSavedAt=stored.updatedAt||Date.now();lastSavedRevision=revision;lastSavedWorkId=current.id;saveState='saved';saveFailure=null;saveFailureWorkId=current.id
    if(current.collectionSaveError){delete current.collectionSaveError;delete current.collectionError}
    if (!stored.snapshot && ['complete','cancelled'].includes(stored.status)) delete current.snapshot
    if(request===saveRequestSequence&&unsavedWorkId===current.id){unsaved = false;unsavedWorkId='';taskStatus()}
    return true
  }
  if(work===current&&current.revision===revision){const error=new Error(globalThis.edulogUi?.t('error.workConflict')||'工作已在其他分頁更新；目前草稿保留，請重新載入後核對。');error.code='WORK_CONFLICT';saveState='failed';saveFailure=error;taskStatus();throw error}
  return false
}
function captureMappingChoices() {
  work.uiState = [...$('mapping').querySelectorAll('input,select,textarea')].filter(e => e.id).map(e => ({ id: e.id, value: e.value, checked: e.checked }))
}
function show(id) { $(id).hidden = false }
function canApplyCurrentPreview() {
  const currentSaveState=saveFailureWorkId===work?.id||unsavedWorkId===work?.id?saveState:'saved'
  return Boolean(work?.type==='import'&&work.jobId&&work.status==='previewed'&&work.batches?.length&&previewResults.length&&!work.previewDirty&&!work.staleReviewPending?.length&&!work.staleReviewIssues?.length&&!reviewSaveCoordinator?.isSaving(work)&&currentSaveState==='saved')
}
function updateApplyAvailability() {
  const button=$('apply');if(button)button.disabled=!canApplyCurrentPreview()
  for(const id of ['preview','repreview']){const control=$(id);if(control)control.disabled=busy||Boolean(reviewSaveCoordinator?.isSaving(work))}
}
function stage(view, primary) {
  const step = view === 'import' ? ({ collect: 1, preview: 2, repreview: 3, apply: 3, pause: 4, resume: 4, 'cancel-work': 4 }[primary] || 1) : ({ 'read-form': 1, compare: 2, prefill: 3, 'return-source': 4 }[primary] || 1)
  activeStages[view]=step
  if(work?.type===view)work.interfaceState={...(work.interfaceState||{}),stage:step}
  // Import keeps four internal stages (saved work stores them) and shows three:
  // 讀取 = collect, 確認 = review + summary, 完成 = progress and result.
  const state=view==='import'?importSteps(currentWorkflow(view)):currentWorkflow(view),shown=view==='import'?importStep(step):step
  document.querySelectorAll(`[data-wizard-step^="${view}-"]`).forEach(item=>{
    const index=Number(item.dataset.wizardStep.split('-').at(-1))-1
    item.dataset.state=index===shown-1?'current':index<shown-1?'complete':state.attention[index]?'attention':state.complete[index]?'complete':'pending'
    const nav=item.querySelector('[data-stage-nav]');if(nav)nav.disabled=!state.available[index]
    if(index===shown-1)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current')
  })
  if(view==='import')for(const [index,id] of ['import-scope','mapping','preview-section','import-progress'].entries())$(id).hidden=index+1!==step
  if(view==='import'&&step===2)renderConfirm()
  if(view==='prefill')for(const [index,id] of ['prefill-target-step','report-picker','field-review','prefill-result'].entries())$(id).hidden=index+1!==step
  taskStatus()
}
function restoreStage(view) {
  const own=work?.type===view?work:activeWorks[view],state=currentWorkflow(view)
  let step=own?.interfaceState?.stage||activeStages[view]||1
  if(!state.available[step-1])step=state.available.findLastIndex(Boolean)+1
  if(own&&['applying','failed','outcome_unknown','complete','partial_complete','paused','cancelled','awaiting-finalization'].includes(own.status))step=4
  stage(view,(view==='import'?['collect','preview','apply','resume']:['read-form','compare','prefill','return-source'])[step-1])
}
function importStep(step){return step>=4?3:step>=2?2:1}
function importSteps(state){
  return {available:[state.available[0],state.available[1],state.available[3]],complete:[state.complete[0],state.complete[1]&&state.complete[2],state.complete[3]],attention:[state.attention[0],state.attention[1]||state.attention[2],state.attention[3]]}
}
// 讀取: "my classes" are open class tabs plus classes synced in this browser.
let classList=[],confirmAutoOpen=false
const confirmPeak=new Map()
function uiText(element,key,values){if(globalThis.edulogUi)globalThis.edulogUi.text(element,key,values);else element.textContent=stepEntries[key]?.[0]||key}
function selectedClass(){const id=sourceContext?.classId?String(sourceContext.classId):'';return classList.find(item=>item.classId===id)||classList.find(item=>item.tabId===Number($('source-tab').value))||null}
function renderClasses(){
  const current=selectedClass(),here=Boolean(current?.current&&sourceContext?.classId)
  renderClassList($('class-list'),classList,{selected:current?.classId,onPick:item=>void runLatest(()=>pickClass(item),{label:'正在讀取來源班級'})})
  uiText($('read-title'),here?'work.readTitle':'work.pickTitle');uiText($('read-help'),here?'work.readHelp':'work.pickHelp')
  const name=current?.title||''
  if(name&&!here)uiText($('collect-label'),'work.readClass',{name});else uiText($('collect-label'),'work.readThis')
}
async function loadClassList(){
  let works=[];try{works=await send({type:'workspace-store',action:'list'})||[]}catch{}
  classList=classEntries({tabs,works,currentTabId:Number(params.get('source'))||null});renderClasses()
}
async function pickClass(item){
  let tab=item.tabId?tabs.find(candidate=>candidate.id===item.tabId):null
  if(!tab){tab=await send({type:'workspace-open-source',sourcePath:item.path});tabs.push(tab);item.tabId=tab.id}
  if(![...$('source-tab').options].some(option=>option.value===String(tab.id)))$('source-tab').add(new Option(`${tab.title||'來源分頁'} · ${tab.path}`,tab.id))
  $('source-tab').value=String(tab.id);await changeSource()
}
// 確認: only exceptions, grouped by kind; automatic matches collapse to one line.
function renderConfirm(){
  const host=$('confirm-overview');if(!host||work?.type!=='import'||!work.snapshot)return
  let enrollments=[];try{enrollments=work.snapshot.records.filter(row=>row.kind==='enrollment'&&!row.sourceSkipped&&!mappingController.validateRow(row,true))}catch{}
  const model=exceptionModel({items:historyPlan,enrollments}),peak=Math.max(confirmPeak.get(work.id)||0,model.total);confirmPeak.set(work.id,peak)
  renderConfirmOverview(host,model,{className:work.sourceTitle||work.title||sourceContext?.title||'',handled:peak-model.total,autoOpen:confirmAutoOpen,onToggleAuto:open=>{confirmAutoOpen=open;renderConfirm()},onResolve:resolveException,autoLabel:item=>item.attendanceEvidence?'work.attendanceOnly':item.category==='history'?'work.historyOnly':'work.matched'})
}
function resolveException(item){
  if(item.kind==='enrollment'){reviewPane('identity');$('identity-review').open=true;mappingController.revealAdmission(item.sourceId)}
  else{reviewPane('reports');historyView.focusReport(item.key)}
}
document.querySelectorAll('[data-stage-nav]').forEach(button=>button.addEventListener('click',()=>{
  if(busy)return
  const [view,raw]=button.dataset.stageNav.split(':'),step=view==='import'?[1,2,4][Number(raw)-1]:Number(raw)
  if(!currentWorkflow(view).available[step-1])return
  stage(view,(view==='import'?['collect','preview','apply','resume']:['read-form','compare','prefill','return-source'])[step-1])
  if(work?.type===view)void save().catch(error=>notice(error.message,true))
}))
function reviewPane(value) {
  $('mapping').dataset.reviewPane=value
  for(const tab of document.querySelectorAll('[data-review-pane]'))tab.setAttribute('aria-pressed',String(tab.dataset.reviewPane===value))
  $('identity-pane').hidden=value!=='identity';$('history-sync').hidden=value!=='reports'
  if(work?.type==='import')work.interfaceState={...(work.interfaceState||{}),reviewPane:value}
}
document.querySelectorAll('[data-review-pane]').forEach(button=>button.addEventListener('click',()=>{reviewPane(button.dataset.reviewPane);if(work)void save().catch(error=>notice(error.message,true))}))
function flow(value) {
  if(!['import','prefill','work'].includes(value))value='import'
  if(work?.type)activeWorks[work.type]=work
  activeFlow=value
  if(value!=='work')work=activeWorks[value]||null
  for(const item of ['import','prefill','work'])$(`${item}-view`).hidden=item!==value
  document.querySelectorAll('[data-flow]').forEach(button=>{if(button.dataset.flow===value)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')})
  $('source-picker').hidden=value!=='prefill'
  if(value==='import'||value==='prefill')restoreStage(value)
  if(value==='work'&&binding)void runLatest(loadWork,{label:'正在更新工作紀錄'})
  taskStatus()
}
async function cancelRead(updateNotice = true) {
  if (!activeReadId) return
  const requestId = activeReadId; activeReadId = ''; activeReadGeneration++
  $('operation-status').dataset.state = 'complete'; $('operation-title').textContent = '已取消唯讀查詢'; $('operation-detail').textContent = '已完成的資料與對應選擇保留。'
  try { await send({ type: 'workspace-cancel-read', requestId }) } catch { /* Stale read responses are ignored below. */ }
  if (updateNotice) notice('已取消目前的唯讀查詢；已完成的輸入與對應仍保留。')
}
async function runLatest(action, options = {}) {
  if (busy && activeReadId) { await cancelRead(false); await readFinished }
  else if(busy){notice('目前有同步或保存作業進行中；完成後再重新核對。');return false}
  return run(action, { readOnly: true, ...options })
}
async function run(action, { label = '正在處理工作', readOnly = false, saveBeforeAction = true } = {}) {
  if (busy){notice('目前有操作進行中；完成或取消後再試。');return false}
  busy = true; $('workspace').setAttribute('aria-busy', 'true'); const sourceDisabled=$('source-tab').disabled; if(!readOnly)$('source-tab').disabled=true
  const trigger = document.activeElement, previousDisabled = trigger instanceof HTMLButtonElement ? trigger.disabled : false
  if (trigger instanceof HTMLButtonElement) trigger.disabled = true
  activeReadId = readOnly ? crypto.randomUUID() : ''; const readGeneration = activeReadGeneration;activeOperationLabel=label
  if (readOnly) readFinished = new Promise(resolve => { finishRead = resolve })
  $('operation-status').hidden = false; $('operation-status').dataset.state = 'loading'; $('operation-status').setAttribute('aria-busy','true'); $('operation-title').textContent = label; $('operation-detail').textContent = '已送出請求，等待 EduLog 回應。'; $('operation-progress').hidden = true; $('cancel-read').hidden = !readOnly
  const startedAt = Date.now(), waitTimer = setInterval(() => {
    if (!busy) return
    const seconds = Math.floor((Date.now() - startedAt) / 1000)
    $('operation-detail').textContent = seconds >= 10
      ? readOnly ? `已等待 ${seconds} 秒；仍在等待回應。可取消這次唯讀查詢後重試。` : `已等待 ${seconds} 秒；目前批次仍在執行，可於批次結束後暫停或取消剩餘工作。`
      : `已等待 ${seconds} 秒。${readOnly ? '可取消此唯讀查詢。' : '目前操作仍在進行。'}`
  }, 1000)
  $('diagnostics').hidden = true
  if($('retry-work-recovery'))$('retry-work-recovery').hidden=true
  try {
    if (saveBeforeAction&&unsaved && work?.type === 'import' && !$('mapping').hidden) { clearTimeout(editTimer); captureMappingChoices(); await save() }
    const result = await action()
    if (readGeneration !== activeReadGeneration && readOnly) return
    $('operation-status').hidden=true; $('operation-status').dataset.state = 'complete'; $('cancel-read').hidden = true
    return result
  }
  catch (error) {
    const currentBatch=work?.type==='import'?work.batches?.[Math.max(0,work.done||0)]:null
    if(isUnsupportedReportEvidencePathValidation(error,currentBatch?.rows||[])){
      error.code='SOURCE_PATH_CONTRACT_UNSUPPORTED';error.message=workspaceErrorMessage(error)
      if(work?.type==='import')work.previewError={code:error.code,message:error.message,batchKey:work.batches?.[Math.max(0,work.done||0)]?.key}
    }
    const interfaceFailure=workspaceInterfaceFailure(error)
    if(interfaceFailure){
      error.code=interfaceFailure.code
      if(work?.type==='import'){work.previewDirty=true;work.previewError={code:interfaceFailure.code,message:error.message};previewResults=[];updateApplyAvailability()}
    }
    $('operation-status').dataset.state = 'error'
    if(error.code==='SOURCE_PATH_CONTRACT_UNSUPPORTED'){globalThis.edulogUi?.text($('operation-title'),'work.serverPathUpgradeTitle');$('operation-detail').textContent=error.message}
    else if (error.code==='READ_CANCELLED'){$('operation-status').dataset.state='complete';$('operation-title').textContent='已取消唯讀查詢';$('operation-detail').textContent='已完成資料與目前選擇保留；可重新核對。';return false}
    else if (!readOnly && work?.status === 'outcome_unknown') { $('operation-title').textContent = '寫入結果尚未確認'; $('operation-detail').textContent = '未收到這批的確認回應。檢查點已保留；續傳會先用原冪等鍵核對結果，不會建立新的匯入工作。'; notice('寫入結果尚未確認。請使用「檢查並續傳」核對批次狀態。', true) }
    else if (error.code === 'API_TIMEOUT') { $('operation-title').textContent = '連線逾時'; $('operation-detail').textContent = '唯讀查詢超過 30 秒，沒有自動重試。請確認連線後手動重試。' }
    else if (error.code === 'PAUSED_PREVIEW_UNSUPPORTED') { $('operation-title').textContent='需要更新 EduLog 伺服器';$('operation-detail').textContent=error.message }
    else if (error.code === 'IMPORT_STATUS_UNKNOWN') { $('operation-title').textContent='伺服器狀態待確認';$('operation-detail').textContent=error.message }
    else if (error.code === 'STALE_REPORT_REVIEW_REQUIRED') { activeOperationLabel=globalThis.edulogUi?.t('work.reviewBeforePreview')||'差異更新前核對';globalThis.edulogUi?.text($('operation-title'),'work.staleReportReviewRequired');globalThis.edulogUi?.text($('operation-detail'),'work.staleReportReviewHelp');renderDifferences();$('preview-section').scrollIntoView?.({block:'start',behavior:'smooth'});document.querySelector('[data-review-blocker-open]')?.focus({preventScroll:true}) }
    else if (error.code === 'REVIEW_SAVE_IN_PROGRESS') {globalThis.edulogUi?.text($('operation-title'),'work.reviewSaveWait');$('operation-detail').textContent=''}
    else if (error.code === 'STALE_REVIEW_REQUIRED') { activeOperationLabel='同步前核對';$('operation-title').textContent=globalThis.edulogUi?.t('work.staleReviewRequired')||'仍有報告欄位待確認';$('operation-detail').textContent=globalThis.edulogUi?.t('work.staleReviewRequiredHelp')||'先完成待確認欄位，再更新差異。教學資料尚未送出。';stage('import','preview');$('preview-section').scrollIntoView?.({block:'start',behavior:'smooth'});document.querySelector('[data-stale-review-start]')?.focus({preventScroll:true}) }
    else if(['failed','uncertain'].includes(saveState)){ $('operation-title').textContent=globalThis.edulogUi?.t(saveState==='uncertain'?'work.saveUncertainTitle':'work.saveFailedTitle')|| (saveState==='uncertain'?'保存結果待確認':'草稿保存失敗');$('operation-detail').textContent=globalThis.edulogUi?.t(saveState==='uncertain'?'work.saveUncertainHelp':'work.saveFailedHelp')||'目前內容仍保留在此畫面；修復保存後可重試。同步已停用。' }
    else if(interfaceFailure){
      globalThis.edulogUi?.text($('operation-title'),'work.interfaceFailed');globalThis.edulogUi?.text($('operation-detail'),'work.interfaceRetry')
      const retry=$('retry-work-recovery'),owner=work
      if(retry&&owner?.type==='import'&&owner.snapshot&&owner.jobId&&owner.batches?.length){retry.hidden=false;retry.onclick=()=>{if(work!==owner)return;void run(()=>restoreImportWork(owner),{label:'正在恢復所選工作'})}}
    }
    else if(work?.status==='stale'){ $('operation-title').textContent='本輪同步受阻';$('operation-detail').textContent='此批次未提交；已知成功批次仍保留。請重新核對未提交資料，確認新差異後再同步。' }
    else if(work?.previewError&&work.previewDirty&&!['outcome_unknown','applying','stale'].includes(work.status)){ $('operation-title').textContent=globalThis.edulogUi?.t('work.previewFailed')||'差異核對失敗';$('operation-detail').textContent=error.message||work.previewError.message||globalThis.edulogUi?.t('work.previewRetry')||'請重新核對未提交資料。' }
    else if (error.code === 'RATE_LIMITED') { $('operation-title').textContent = '伺服器暫時限制查詢'; $('operation-detail').textContent = error.retryAfter ? `請於 ${error.retryAfter} 秒後手動重試。` : '請稍後手動重試。' }
    else { $('operation-title').textContent = '操作未完成'; $('operation-detail').textContent = error.message || '請檢查連線後重試。' }
    if(['WORK_STORAGE_FULL','WORK_SAVE_FAILED','WORK_DATA_INVALID','WORK_DATA_CORRUPT'].includes(error.code)&&work?.type==='import'){work.status='paused-extraction';work.collectionError=error.message;work.collectionSaveError=error.code;$('retry-history-save').hidden=false;taskStatus()}
    const previewFailure=work?.previewError&&work.previewDirty&&!['outcome_unknown','applying'].includes(work.status)
    notice(['STALE_REPORT_REVIEW_REQUIRED','REVIEW_SAVE_IN_PROGRESS','PAUSED_PREVIEW_UNSUPPORTED','IMPORT_STATUS_UNKNOWN','STALE_REVIEW_REQUIRED'].includes(error.code)||work?.status==='stale'?'':previewFailure||['failed','uncertain'].includes(saveState)?'':error.code === 'PREVIEW_STALE' ? '預覽已失效；目前批次未提交。請重新核對未提交資料。' : ['WORK_STORAGE_FULL','WORK_SAVE_FAILED','WORK_DATA_INVALID','WORK_DATA_CORRUPT'].includes(error.code) ? error.message : '目前內容保留在此畫面；請依上方狀態處理後重試。', true)
    let workBytes=0;try{workBytes=new TextEncoder().encode(JSON.stringify(work)).byteLength}catch{}
    const currentLastSavedAt=lastSavedWorkId===work?.id?lastSavedAt:null
    const currentLastSavedRevision=lastSavedWorkId===work?.id?lastSavedRevision:null
    $('diagnostic').textContent = [error.code || 'WORK_FAILED',`操作階段：${activeOperationLabel}`,work?.id?`工作識別：${work.id}`:'',work?.batches?.[Math.max(0,work.done||0)]?.key?`批次識別：${work.batches[Math.max(0,work.done||0)].key}`:'',work?.revision!=null?`工作 revision：${work.revision}`:'',`目前工作大小：約 ${workBytes} bytes`,currentLastSavedAt?`最後成功保存：${new Date(currentLastSavedAt).toISOString()} · revision ${currentLastSavedRevision}`:'尚無本工作成功保存時間',error.saveTransportStage?`保存階段：${error.saveTransportStage}`:'',...Object.entries(error.fields || {}).flatMap(([key, messages]) => messages.map(message => `${key}：${message}`)),error.requestId ? `請求編號：${error.requestId}` : ''].filter(Boolean).join('\n'); show('diagnostics')
    if(interfaceFailure)$('diagnostic').textContent+='\n'+[interfaceFailure.type,interfaceFailure.reason,interfaceFailure.location].filter(Boolean).join(' · ')
  } finally { clearInterval(waitTimer); busy = false; activeReadId = ''; $('source-tab').disabled=sourceDisabled; $('workspace').removeAttribute('aria-busy'); $('operation-status').removeAttribute('aria-busy'); taskStatus(); if (trigger?.isConnected && trigger instanceof HTMLButtonElement) trigger.disabled = previousDisabled; $('cancel-read').hidden = true; updateApplyAvailability(); finishRead() }
}
function options(select, rows, label, placeholder, extra) {
  select.dataset.sourceRawOptions='true'
  select.replaceChildren(new Option(placeholder, ''))
  rows.forEach(row => select.add(new Option(label(row), row.id)))
  if (extra) select.add(new Option(extra, 'new'))
}
async function catalog(resource, filters = {}) {
  return api('catalog', undefined, { query: { resource, limit: 50, ...filters } })
}
async function resolveLinks(records) { return mappingController.resolve(records) }
async function loadClassrooms(reset = false) {
  const previous = $('classroom').value
  if (reset) { classroomCursor = ''; context.classrooms = context.classrooms.filter(row => row.id === previous) }
  const page = await catalog('classrooms', { search: $('classroom-search').value.trim() || undefined, cursor: classroomCursor || undefined })
  context.classrooms = [...new Map([...context.classrooms, ...(page.items || [])].map(row => [row.id,row])).values()]
  classroomCursor = page.next_cursor || ''; $('more-classrooms').hidden = !classroomCursor
  options($('classroom'), context.classrooms, row => row.name, '選擇目標教室'); $('classroom').value = context.classrooms.some(row => row.id === previous) ? previous : ''
}
async function loadMappingCourses(reset = false) {
  const room = $('classroom').value, previous = $('course').value
  if (!room) { context.courses = []; options($('course'), [], row => row.display_name, '先選目標教室'); $('more-mapping-courses').hidden = true; return }
  if (reset || activeCourseRoom !== room) { mappingCourseCursor = ''; context.courses = activeCourseRoom && activeCourseRoom !== room ? [] : context.courses; activeCourseRoom = room }
  const page = await catalog('courses', { classroom_id: room, search: $('mapping-course-search').value.trim() || undefined, cursor: mappingCourseCursor || undefined })
  context.courses = [...new Map([...context.courses, ...(page.items || [])].map(row => [row.id,row])).values()]
  mappingCourseCursor = page.next_cursor || ''; $('more-mapping-courses').hidden = !mappingCourseCursor
  options($('course'), context.courses, row => row.display_name || `${row.subject} ${row.stage}`, '選擇目標課程', context.permissions?.course_create ? '建立新課程…' : null)
  $('course').value = context.courses.some(row => row.id === previous) ? previous : ''
  if (typeof mappingController !== 'undefined') mappingController.refreshCourses()
}
async function initialize() {
  const data = await send({ type: 'workspace-init' }); binding = data.binding; integrationCapabilities = data.status.capabilities || {}; frontendSettingsUrl = data.status.settingsUrl; tabs = data.tabs
  batchBytes = data.status.limits?.batchBytes ?? 180000
  if (!data.status.capabilities?.mapping_memory || !data.status.capabilities?.multi_course_import) {
    $('connect-title').textContent='對應服務尚未就緒'; $('connect-detail').textContent='目前連線未提供工作台所需的對應功能。請重新驗證連線；已保存的工作與檢查點會保留。'; show('connect'); $('workspace').hidden=true; return
  }
  if (!data.status.capabilities?.catalog_v1) {
    $('connect-title').textContent = 'EduLog 目錄服務尚未就緒'; $('connect-detail').textContent = '目前連線未提供目錄功能。請重新驗證連線；已保存的工作會保留。'; show('connect'); $('workspace').hidden = true; return
  }
  if (!data.status.capabilities?.teaching_data_import || !data.status.capabilities?.report_prefill) {
    $('connect-title').textContent = '伺服器整合尚未就緒'; $('connect-detail').textContent = '目前連線未提供教學資料功能。請重新驗證連線或檢查診斷資訊。'; show('connect'); $('workspace').hidden = true; return
  }
  $('instance-label').textContent = binding.instance
  $('connect').hidden = true; show('workspace')
  options($('source-tab'), tabs, t => `${t.title || '支援網站'} · ${t.path}`, '選擇支援網站分頁')
  if (tabs.some(t => t.id === Number(params.get('source')))) $('source-tab').value = params.get('source')
  $('connection-pill').hidden = false; await loadClassList()
  loadedLessonCourses.clear(); lessonCatalogLoads.clear()
  context = { classrooms: [], courses: [], class_sessions: [], students: [], enrollments: [], occurrences: [], report_targets: [], lessons: [], source_links: [], permissions: {} }
  if ($('source-tab').value) await changeSource()
  else { $('source-label').textContent = '尚未選擇來源；請先開啟支援網站的班級頁或報告表單，再選取分頁。'; $('collect').disabled = true; $('read-form').disabled = true; notice('連線已驗證。尚未選取來源分頁；匯入與預填入口暫不可用。') }
  try { await loadSyncPreferences() } catch (error) { $('sync-preferences-status').textContent=`同步偏好讀取失敗；使用本機預設，可重試保存。 ${error.message}` }
  if(!integrationCapabilities.sync_field_preferences){$('sync-preferences-status').textContent='目前連線不支援跨裝置同步偏好；本次工作仍可調整欄位。';$('save-sync-preferences').disabled=true} renderSyncFields()
  flow(params.get('flow') || ($('source-tab').value?'import':'work'))
}
// 完成: result header and a link to the class in EduLog.
function renderDoneHeader() {
  const done=['complete','partial_complete'].includes(work?.status),time=work?.updatedAt?new Intl.DateTimeFormat(globalThis.edulogUi?.locale||'zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(work.updatedAt)):''
  $('done-icon').hidden=!done;uiText($('progress-heading'),work?.status==='complete'?'work.doneTitle':work?.status==='partial_complete'?'work.donePartial':'work.progressTitle')
  $('done-sub').textContent=[work?.sourceTitle||work?.title,time].filter(Boolean).join(' · ')
  let href=''
  try{const session=work?.destination?.class_session_id;if(done&&frontendSettingsUrl&&/^[a-f0-9-]{36}$/i.test(session||''))href=new URL(`/dashboard/classrooms/session/${session}`,frontendSettingsUrl).href}catch{}
  const link=$('view-in-edulog');link.hidden=!href;if(href)link.href=href;else link.removeAttribute('href')
}
async function changeSource() {
  const current = ++generation; $('source-picker').open=true;delete $('source-picker').dataset.workId; form = null; report = null; previewResults = []; work = null;activeWorks.import=null;activeWorks.prefill=null;activeStages.import=1;activeStages.prefill=1;continuation=null;$('continue-work').hidden=true
  const tab = tabs.find(t => t.id === Number($('source-tab').value)); selectedPath = tab?.path || ''
  sourceContext = null; classSourceReady = false; reportSourceReady = false
  if (!tab) { $('source-label').textContent = '尚未選擇來源分頁'; $('collect').disabled = true; $('read-form').disabled = true; renderClasses(); return }
  const c = await source('context'); if (current !== generation) return
  sourceContext = c; classSourceReady = Boolean(c?.classId); reportSourceReady = Boolean(c?.reportOpen); renderClasses()
  $('collect').disabled = !classSourceReady; $('read-form').disabled = !reportSourceReady
  if (!classSourceReady && !reportSourceReady) { $('source-label').textContent = `${tab.title || tab.path} · 來源班級或報告表單尚未辨識；請在來源分頁開啟班級頁或「記錄」表單後重試。`; notice('目前來源沒有可讀取的班級或報告表單；匯入與預填入口暫不可用。'); return }
  $('source-label').textContent = `${c.sourceOrigin} · ${c.title || c.sourcePath || selectedPath} · ${c.sourcePath || selectedPath}`
  notice(classSourceReady ? '已辨識來源班級，可開始擷取。' : '已辨識報告表單，可開始預填。')
  for (const id of ['mapping','preview-section','import-progress','target-summary','report-picker','field-review','prefill-result']) $(id).hidden = true
  restoreStage(activeFlow==='prefill'?'prefill':'import')
  const saved=await send({type:'workspace-store',action:'list'});if(current!==generation)return
  continuation=(saved||[]).find(row=>row.type==='import'&&row.snapshot?.classId===c.classId&&row.sourcePath===(c.sourcePath||selectedPath)&&!['complete','cancelled'].includes(row.status))||null
  $('continue-work').hidden=!continuation;if(continuation){globalThis.edulogUi?.text($('continue-work-copy'),'work.resumeHelp');$('collect').disabled=true}
}
function linked(kind, id) { const row = context.source_links.find(l => l.source_origin === 'https://corp.orangeapple.co' && l.source_kind === kind && l.source_id === id); return row?.valid === false ? undefined : row?.edulog_id || row?.target_id }
function idFor(kind, id) { const key = `${kind}:${id}`; return linked(kind, id) || (work.ids[key] ||= crypto.randomUUID()) }
function labelledInput(parent, title, type, id, value = '') { const label = node('label', title), input = node('input'); input.type = type; input.id = id; input.value = value; label.htmlFor = id; parent.append(label, input); return input }
function markMappingChanged(){
  if(!work)return
  unsaved=true;work.mappingDirty=true;work.previewDirty=true;$('apply').disabled=true
  work.revision=(work.revision||0)+1;scheduleHistoryPlanForCurrentMapping()
  clearTimeout(editTimer);const editingId=work.id
  editTimer=setTimeout(()=>{if(work?.id!==editingId||busy)return;captureMappingChoices();void save().catch(()=>{unsaved=true;notice('對應選擇尚未儲存，請保留此分頁並重試。',true)})},250)
}
const mappingController = createMappingController({ capabilities: () => integrationCapabilities, settingsUrl: () => frontendSettingsUrl, rereadSource: () => source('collect'),state:()=>({work,context}),generation:()=>generation,readGeneration:()=>activeReadGeneration,api,catalog,run:(action,options)=>options?.readOnly?runLatest(action,options):run(action,options),notice,idFor,loadClassrooms,loadMappingCourses,mappingChanged:markMappingChanged})
let historyPlan = [], historyCheckSequence = 0, historyLocalSequence = 0, historyArchives = new Map(), historyRoutes = new Map()
const loadedLessonCourses=new Set(),lessonCatalogLoads=new Map()
// The synced source class maps to the selected EduLog class session; reports
// of other source classes become class exceptions in the planner.
function sourceClassSessions(){const classId=work?.snapshot?.classId,session=$('class-session')?.value;if(!classId||!session)return new Map();return new Map([[String(classId),session==='new'?idFor('class_session',classId):session]])}
function historyOptions(){return {dateFrom:work?.dateFrom,dateTo:work?.dateTo,includeInternal:$('include-internal-notes').checked,lessons:context?.lessons||[],syncFields:effectiveSyncFields(),sourceClassSessions:sourceClassSessions()}}
function effectiveSyncFields(record){const base={lesson_id:true,is_completed:true,progress_letter:true,attendance_status:true,absence_reason:true,class_participation:true,classroom_behavior:true,content:true,contact_notes:true,class_notes:false,external_link:true};Object.assign(base,syncPreferences.fields||{},syncDraftOverrides,work?.syncFieldPreferences||{},work?.syncFieldOverrides||{});if(record)Object.assign(base,record.syncFieldOverrides||{});return base}
function renderSyncFields(){const host=$('sync-field-options');if(!host)return;const current=effectiveSyncFields();for(const [key,label] of syncFields){let wrap=host.querySelector(`[data-sync-choice="${key}"]`),input=wrap?.querySelector('input');if(!wrap){wrap=node('label',undefined,'sync-field-choice');wrap.dataset.syncChoice=key;input=node('input');input.type='checkbox';input.dataset.syncField=key;wrap.append(input,node('span',label));host.append(wrap);input.addEventListener('change',()=>{syncDraftOverrides[key]=input.checked;if(key==='class_notes')$('include-internal-notes').checked=input.checked;if(work){if(key==='class_notes')work.includeInternalNotes=input.checked;work.syncFieldOverrides||={};work.syncFieldOverrides[key]=input.checked;work.syncPreferencesSnapshot={...effectiveSyncFields(),[key]:input.checked};historyWorkChanged();historyView.refreshEditor(historyPlan)}$('sync-preferences-status').textContent=`${work?'本次工作':'目前選擇'}：${label}${input.checked?'會同步':'不同步'}。尚未提交的差異已失效。`})}if(input!==document.activeElement)input.checked=current[key]!==false&&(key!=='class_notes'||$('include-internal-notes').checked)}}
async function loadSyncPreferences(){if(!integrationCapabilities.sync_field_preferences)return;const data=await api('sync-preferences-get',undefined,{query:{source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1'}});syncPreferences={fields:data.fields||{},revision:data.revision||null};renderSyncFields()}
async function saveSyncPreferences(){const fields=syncFields.map(([field_key])=>({field_key,enabled:$('sync-field-options').querySelector(`[data-sync-field="${field_key}"]`).checked}));const result=await api('sync-preferences-save',{source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',expected_revision:syncPreferences.revision,fields});syncPreferences={fields:result.fields||Object.fromEntries(fields.map(x=>[x.field_key,x.enabled])),revision:result.revision};syncDraftOverrides={};if(work){work.syncFieldPreferences={...syncPreferences.fields};work.syncPreferencesSnapshot={...syncPreferences.fields};work.syncFieldOverrides={};historyWorkChanged();historyView.refreshEditor(historyPlan)}$('sync-preferences-status').textContent='已記住同步欄位預設；可在本次工作或單份報告調整。';renderSyncFields()}
function updateHistoryPlanLocal(){if(!work?.snapshot)return;historyPlan=planHistory(work.snapshot.records,historyTargets(),historyArchives,historyRoutes,historyOptions());historyView.updateStatus(historyPlan);stage('import',['collect','preview','apply','resume'][activeStages.import-1])}
function scheduleHistoryPlanForCurrentMapping(){
  if(!work?.snapshot)return
  const owner=work,epoch=generation,sequence=++historyLocalSequence
  const courseIds=[...new Set([...historyTargets().values()].map(target=>target.courseId).filter(id=>id&&id!=='new'))]
  void Promise.all(courseIds.map(id=>ensureLessonCatalog(id))).then(()=>{
    if(owner!==work||epoch!==generation||sequence!==historyLocalSequence)return
    updateHistoryPlanLocal()
  }).catch(error=>{if(owner===work&&epoch===generation&&sequence===historyLocalSequence)notice(`課程教材目錄尚未載入，請重新核對後重試。${error.message}`,true)})
}
function staleFieldsForHistoryItem(item){return (work?.staleReviewPending||[]).filter(pending=>pending.kind==='history_report'&&pending.source_id===item.key).map(pending=>pending.field)}
function prepareReviewSave(owner,record,reportKey,fields,resolved){
  const stagedRecord={...record,staleReviewFields:(record.staleReviewFields||[]).filter(field=>!fields.includes(field)),historyConflictConfirmed:false,historyConflictSignature:''}
  const records=owner.snapshot.records.map(candidate=>candidate===record?stagedRecord:candidate)
  const latest=planHistory(records,historyTargets(),historyArchives,historyRoutes,historyOptions()).find(candidate=>candidate.key===reportKey)
  if(latest?.conflicts?.length){stagedRecord.historyConflictConfirmed=true;stagedRecord.historyConflictSignature=latest.conflictSignature}
  const pending=(owner.staleReviewPending||[]).filter(row=>!resolved.includes(row))
  return {
    project:live=>({...live,previewDirty:true,staleReviewPending:pending,snapshot:{...live.snapshot,records:live.snapshot.records.map(candidate=>candidate===record?stagedRecord:candidate)},historyUI:{...live.historyUI,staleReviewSavedKey:reportKey}}),
    commit:()=>{owner.staleReviewPending=pending;record.staleReviewFields=stagedRecord.staleReviewFields;record.historyConflictConfirmed=stagedRecord.historyConflictConfirmed;record.historyConflictSignature=stagedRecord.historyConflictSignature;owner.previewDirty=true;owner.historyUI||={};owner.historyUI.staleReviewSavedKey=reportKey;historyLocalSequence++}
  }
}
reviewSaveCoordinator=createReviewSaveCoordinator({
  work:()=>work,record:item=>work?.snapshot?.records?.find(r=>r.kind==='report'&&historyIdentity(r)===item.key),
  stamp:()=>`${generation}:${historyCheckSequence}:${historyLocalSequence}`,
  refresh:owner=>reportSkipController?.refreshContext(owner),prepare:prepareReviewSave,save,
  saving:(owner,key,fields)=>{historyView.setQueueSaving(key,fields,owner.id);updateApplyAvailability()},
  saved:()=>{updateHistoryPlanLocal();notice(globalThis.edulogUi?.t('work.conflictSaved')||'核對決定已保存；請更新差異後再確認同步。')},
  failed:error=>notice(globalThis.edulogUi?.t(error.code==='REVIEW_SAVE_SUPERSEDED'?'work.reviewSaveChanged':'work.conflictSaveFailed')||'保存失敗，選擇仍保留；請重試保存。',true)
})
async function confirmStaleHistoryReview(item,fields){return reviewSaveCoordinator.confirm(item,fields)}
async function historyWorkChanged(){if(!work)return false;historyCheckSequence++;historyLocalSequence++;work.previewDirty=true;await reportSkipController?.refreshContext(work);updateHistoryPlanLocal();try{return await save()}catch(e){notice(`核對結果未保存：${e.message}。選擇仍保留，請重試。`,true);return false}}
const reportSkipController=createReportSkipController({getWork:()=>work,targets:historyTargets,routes:()=>historyRoutes,instance:()=>binding?.instance||'',api,capable:()=>integrationCapabilities.report_skip_decisions,identity:historyIdentity,changed:historyWorkChanged,recompute:updateHistoryPlanLocal,save})
function historyUiChanged(){if(work)void save().catch(e=>notice(e.message,true))}
const historyView=createHistoryWorkbench({work:()=>work,record:item=>work?.snapshot?.records?.find(r=>r.kind==='report'&&historyIdentity(r)===item.key)||item.record,item:key=>historyPlan.find(candidate=>candidate.key===key),labels:fieldLabels,changed:historyWorkChanged,staleFields:staleFieldsForHistoryItem,hasStaleReview:item=>work?.staleReviewRows?.some(stale=>stale.source_id===item.key),staleDecision:(item,field)=>work?.staleReviewPending?.find(pending=>pending.kind==='history_report'&&pending.source_id===item.key&&pending.field===field)?.previousDecision,confirmStaleReview:confirmStaleHistoryReview,backToSummary:()=>{stage('import','apply');historyView.restoreListState();renderDifferences();if(work?.staleReviewSummaryUI)restoreStaleSummaryState();else $('preview-section').scrollIntoView({block:'start',behavior:'smooth'})},uiChanged:historyUiChanged,recheck:(key)=>void runLatest(async()=>{const state=historyView.capture(),selected=historyView.selectedKey(),owner=work?.id;await refreshHistoryPlan({admissions:key?[historyPlan.find(i=>i.key===key)?.record.enrollment_source_id].filter(Boolean):undefined});if(owner===work?.id&&selected===historyView.selectedKey())historyView.refreshEditor(historyPlan,state)},{label:key?'正在核對此份紀錄':'正在逐日核對有效課次'}),defaults:effectiveSyncFields,fieldLabel:key=>fieldLabels[key]||key,diffValue:displayValue,fields:(host,item)=>attachImportFields(host,item.record,{record:()=>work?.snapshot?.records?.find(r=>r.kind==='report'&&historyIdentity(r)===item.key)||item.record,work:()=>work,courseId:()=>item.target?.courseId,courseName:courseId=>context.courses.find(c=>c.id===courseId)?.display_name,resolve:(record,courseId)=>mappingController.resolveReportFieldRules(record,courseId),catalog,lessons:()=>context.lessons,ingestLessons:rows=>{context.lessons=[...new Map([...context.lessons,...rows].map(r=>[r.id,r])).values()]},api,capable:()=>integrationCapabilities.field_mapping_memory,shareRule:(rules,change)=>{if(!change)return;for(const target of work.snapshot.records.filter(r=>r.kind==='report'&&(change.fieldKey!=='lesson_id'||historyTargets().get(r.enrollment_source_id)?.courseId===item.target?.courseId))){const field=target.sourceFields?.find(candidate=>candidate.key===change.fieldKey&&(candidate.value??candidate.text)===change.sourceValue);if(!field||globalThis.edulogFieldMappings.signature(field)!==change.optionsSignature)continue;target.fieldRules||=[];target.fieldRules=target.fieldRules.filter(rule=>!(rule.field_key===change.fieldKey&&rule.source_value===change.sourceValue&&rule.options_signature===change.optionsSignature));if(change.action==='confirm'){const rule=rules.find(candidate=>candidate.field_key===change.fieldKey&&candidate.source_value===change.sourceValue&&candidate.options_signature===change.optionsSignature);if(rule)target.fieldRules.push(rule)}}},changed:historyWorkChanged})})
historyView.setSkip((item,active)=>reportSkipController.setSkip(item,active))
historyView.setSkipMany(items=>reportSkipController.continueSkipping(items))
function historyTargets() {
  const targets=new Map()
  for(const r of work.snapshot.records.filter(r=>r.kind==='enrollment')) {
    const choice=$(`enrollment-${r.source_id}`)?.value,courseId=$(`enrollment-course-${r.source_id}`)?.value||mappingController.courseFor(r)
    if(!courseId)continue
    targets.set(r.source_id,{id:choice&&choice!=='new'?choice:choice==='new'?idFor('enrollment',r.source_id):null,isNew:choice==='new'&&!(work.createdAdmissions||[]).includes(r.source_id),eligible:mappingController.validateRow(r,true),courseId,name:r.sourceStudentName,courseName:context.courses.find(c=>c.id===courseId)?.display_name||r.sourceCourseLabel})
  }
  return targets
}
async function refreshHistoryPlan({admissions:admissionFilter}={}) {
  if(!work?.snapshot)return
  const owner=work,epoch=generation,sequence=++historyCheckSequence,targets=historyTargets(),archives=new Map(admissionFilter?historyArchives:[]),routes=new Map(admissionFilter?historyRoutes:[])
  const current=()=>owner===work&&epoch===generation&&sequence===historyCheckSequence
  $('history-sync-summary').textContent='正在核對歷史與有效名單；既有選擇保留…'
  const selectedAdmissions=admissionFilter?new Set(admissionFilter):null
  const lessonCourses=new Set(owner.snapshot.records.filter(r=>r.kind==='report'&&(!selectedAdmissions||selectedAdmissions.has(r.enrollment_source_id))&&(r.sourceFields||[]).some(f=>f.key==='lesson_id'&&f.type==='stage')).map(r=>targets.get(r.enrollment_source_id)?.courseId).filter(id=>id&&id!=='new'))
  for(const courseId of lessonCourses){await ensureLessonCatalog(courseId);if(!current())return}
  if(integrationCapabilities.enrollment_history_reports) {
    for(const [admission,target] of targets) {
      if(!target.id||target.isNew||(selectedAdmissions&&!selectedAdmissions.has(admission)))continue
      let cursor,rows=[],seenCursors=new Set()
      do{const page=await api('history-list',undefined,{query:{enrollment_id:target.id,source_admission_id:admission,limit:50,cursor}});if(!current())return;rows.push(...page.items||[]);cursor=page.next_cursor||undefined;if(cursor&&seenCursors.has(cursor))throw new Error('歷史清單分頁未前進，請重新核對。');if(cursor)seenCursors.add(cursor)}while(cursor)
      const existingArchive=archives.get(target.id)||[]
      archives.set(target.id,[...existingArchive.filter(row=>row.source_admission_id!==admission),...rows])
      const dates=[...new Set(owner.snapshot.records.filter(r=>r.kind==='report'&&r.enrollment_source_id===admission&&r.date&&r.date>=owner.dateFrom&&r.date<=owner.dateTo).map(r=>r.date))],occurrences=[]
      for(let i=0;i<dates.length;i+=50){cursor=undefined;seenCursors=new Set();do{const page=await api('history-route',{enrollment_id:target.id,dates:dates.slice(i,i+50),limit:50,...(cursor?{cursor}:{})});if(!current())return;occurrences.push(...page.items||[]);cursor=page.next_cursor||undefined;if(cursor&&seenCursors.has(cursor))throw new Error('課次分頁未前進，請重新核對。');if(cursor)seenCursors.add(cursor)}while(cursor)}
      const refreshedDates=new Set(dates)
      const byId=new Map([...(routes.get(target.id)||[]).filter(row=>!refreshedDates.has(row.occurrence_date)),...occurrences].map(row=>[row.id,row]))
      routes.set(target.id,[...byId.values()])
    }
  }
  if(!current())return
  historyArchives=archives;historyRoutes=routes
  historyPlan=planHistory(owner.snapshot.records,targets,archives,routes,historyOptions())
  historyView.render(historyPlan)
  stage('import',['collect','preview','apply','resume'][activeStages.import-1])
  if(!integrationCapabilities.enrollment_history_reports)$('history-sync-summary').textContent='目前連線未提供完整歷史保存；可重新檢查連線。已讀取內容與檢查點保留。'
}
async function ensureLessonCatalog(courseId){
  if(loadedLessonCourses.has(courseId))return
  if(lessonCatalogLoads.has(courseId))return lessonCatalogLoads.get(courseId)
  const owner=context,epoch=generation
  const current=()=>context===owner&&generation===epoch
  const pending=(async()=>{let cursor,seen=new Set(),pages=0;do{const page=await catalog('lessons',{course_id:courseId,cursor});if(!current())return;if(page.next_cursor&&seen.has(page.next_cursor))throw new Error('教材目錄分頁未前進，請重新核對。');if(page.next_cursor)seen.add(page.next_cursor);owner.lessons=[...new Map([...owner.lessons,...(page.items||[])].map(row=>[row.id,row])).values()];cursor=page.next_cursor||undefined;if(++pages>100)throw new Error('教材目錄超過安全讀取上限，請縮小範圍後重試。')}while(cursor);loadedLessonCourses.add(courseId)})()
  lessonCatalogLoads.set(courseId,pending)
  try{return await pending}finally{if(lessonCatalogLoads.get(courseId)===pending)lessonCatalogLoads.delete(courseId)}
}
async function mappingView() {
  $('operation-title').textContent='正在解析已確認的對應';
  await mappingController.mount(); show('mapping'); stage('import','preview')
  const needsIdentity=work.snapshot.records.some(r=>r.kind==='enrollment'&&!mappingController.validateRow(r,true));$('identity-review').open=needsIdentity
  reviewPane(work.interfaceState?.reviewPane||(needsIdentity?'identity':'reports'))
  await refreshHistoryPlan()
}
async function loadScopedMappingData(){return mappingController.scoped()}
function updateMappingOptions(){return mappingController.update()}
async function updateDestinations(){return mappingController.destination()}
function canCreate(kind){return ($('class-session').value==='new'?context.permissions.classroom:context.permissions.session)?.[`${kind}_create`]===true}
async function collect() {
  if (!classSourceReady) throw new Error('來源分頁尚未辨識為班級頁，請先切換到班級工作區。')
  if (!$('date-from').value || !$('date-to').value || $('date-from').value > $('date-to').value) throw new Error('請確認有效日期範圍。')
  const snapshot = await source('collect')
  if (!snapshot?.classId || snapshot.sourcePath !== selectedPath) throw new Error('目前來源不是可辨識的班級頁。請切換到班級頁後再擷取。')
  work = { id: crypto.randomUUID(), type: 'import', status: 'collected', sourceTab: Number($('source-tab').value), sourcePath: selectedPath, sourceClassId:String(snapshot.classId),sourceTitle:snapshot.title||'',title: snapshot.title, snapshot, ids: {}, dateFrom: $('all-history').checked?'1900-01-01':$('date-from').value, dateTo: $('all-history').checked?'9999-12-31':$('date-to').value, includeInternalNotes: $('include-internal-notes').checked, syncFieldPreferences:{...(syncPreferences.fields||{})},syncPreferencesSnapshot:{...effectiveSyncFields()},syncFieldOverrides:{...syncDraftOverrides}, done: 0 }
  if ($('read-history').checked) work.history = { paths: snapshot.admissionPaths, next: 0 }
  activeWorks.import=work;await save();try{await saveWorkMetadata(work)}catch(error){work.metadataSyncError=error.message;notice('本機草稿已保存；跨裝置工作整理稍後可重試。',true)} if (work.history) await collectHistory()
  await mappingView();renderHistoryIssues(); notice(`已擷取 ${work.snapshot.records.length} 筆可辨識資料。缺少欄位仍需確認。${work.status === 'paused-extraction' ? '擷取中斷，可從工作紀錄繼續。' : ''}`)
}
async function collectHistory(retryPath) {
  paused=false
  const owner=work, epoch=activeReadGeneration, sourceEpoch=generation
  try{await readHistoryWork(owner,{current:()=>owner===work&&epoch===activeReadGeneration&&sourceEpoch===generation,paused:()=>paused,save,source,merge:mergeRecords,progress:message=>{$('operation-detail').textContent=message;notice(message)},saveFailure:error=>{owner.collectionSaveError=error.code||'WORK_SAVE_FAILED';taskStatus()}},retryPath);await reportSkipController.resolve(owner)}
  finally{if(owner===work)renderHistoryIssues()}
}
function renderHistoryIssues(){
  const box=$('history-issues');box.replaceChildren();const issues=work?.history?.issues||[]
  if(!issues.length)return
  box.append(node('h3',`歷史報告待處理 · ${issues.filter(r=>!r.skipped).length} 筆`),node('p','已取得的資料保留。請補足、重試，或明確略過；略過後結果會標示部分完成。','hint'))
  for(const item of issues){
    const card=node('div',undefined,'history-issue');box.append(card)
    const admission=work.snapshot.records.find(r=>r.kind==='enrollment'&&r.source_id===item.enrollment_source_id)
    card.append(node('strong',`${admission?.sourceStudentName||'來源報名 #'+(item.enrollment_source_id||item.admissionPath?.split('/').pop())} · ${item.date||item.dateRaw||'日期待確認'}${item.source_id?' · 報告 #'+item.source_id:''}`),node('p',item.reason||item.needs?.join('；')||'來源資訊不足'))
    if(item.sourceEvidence){const details=node('details');details.append(node('summary','查看已擷取的教學原文'));for(const evidence of item.sourceEvidence)for(const f of evidence.fields||[])details.append(node('p',`${f.label}：${f.text||'未取得'}`));card.append(details)}
    const original=node('a','查看原站學生完整紀錄 ↗');original.href=`https://corp.orangeapple.co${item.admissionPath||'/dt_admissions/'+item.enrollment_source_id}`;original.target='_blank';original.rel='noopener noreferrer';card.append(original)
    let url,date
    if(!item.listFailed){url=labelledInput(card,'原站報告編輯連結','url',`history-link-${item.evidenceKey||item.source_id}`,item.data?.external_link||'');date=labelledInput(card,'完整上課日期（缺少年份時請確認）','date',`history-date-${item.evidenceKey||item.source_id}`,item.date||'');url.autocomplete=date.autocomplete='off'}
    const status=node('p',item.skipped?'已略過；不會建立此報告。':'尚未完成擷取','hint');status.setAttribute('aria-live','polite');card.append(status)
    const retry=node('button',item.listFailed?'重試此生歷史紀錄':'補足並重新讀取'),skip=node('button',item.skipped?'取消略過':'略過此筆');retry.type=skip.type='button';card.append(retry,skip)
    skip.addEventListener('click',()=>void run(async()=>{item.skipped=!item.skipped;const record=work.snapshot.records.find(r=>r.kind==='report'&&r.source_id&&r.source_id===item.source_id);if(record)record.sourceSkipped=item.skipped;updateHistoryPlanLocal();await save();skip.textContent=item.skipped?'取消略過':'略過此筆';status.textContent=item.skipped?'已略過；其他資料可繼續匯入。':'待處理，請補足或重試。';if(['stale','partial_complete','complete'].includes(work.status))renderImportOutcome()},{label:'正在保存略過選擇'}))
    retry.addEventListener('click',async()=>{
      if(retry.disabled)return;const owner=work, epoch=generation;retry.disabled=skip.disabled=true;if(url)url.disabled=date.disabled=true;status.textContent='正在讀取並核對來源…'
      try{
        if(item.listFailed){await collectHistory(item.admissionPath);if(owner!==work||epoch!==generation)return;mappingController.appendReports()}
        else{const updated=await source('history-report',{workId:work.id,historyPath:item.sourceHistoryPath||item.sourceEvidence?.find(e=>/^\/dt_admissions\/\d+$/.test(e.sourcePath||''))?.sourcePath||`/dt_admissions/${item.enrollment_source_id}`,input:{reportId:item.source_id,evidenceKey:item.evidenceKey,editUrl:url.value,confirmedDate:date.value||undefined}});if(owner!==work||epoch!==generation)return;if(!updated.date)throw new Error('請確認完整日期後再重新讀取。');const index=work.snapshot.records.findIndex(r=>r.kind==='report'&&r.source_id===updated.source_id);if(index>=0)Object.assign(work.snapshot.records[index],updated);else work.snapshot.records.push(updated);work.history.issues=work.history.issues.filter(r=>r!==item);await save();mappingController.appendReports();status.textContent='已讀取並驗證報告；請核對教材與欄位映射。';url.disabled=date.disabled=retry.disabled=skip.disabled=true;card.dataset.complete='true'}
      }catch(e){if(owner===work)status.textContent=`讀取未完成：${e.message} 目前選擇保留。`}
      finally{if(retry.isConnected&&!card.dataset.complete){retry.disabled=skip.disabled=false;if(url)url.disabled=date.disabled=false}}
    })
  }
}
function prepareRows() {
  work.includeInternalNotes = $('include-internal-notes').checked
  const eligible = new Set(work.snapshot.records.filter(r=>r.kind==='enrollment'&&mappingController.validateRow(r,true)).map(r=>r.source_id))
  const unresolved = work.snapshot.records.filter(r=>r.kind==='enrollment'&&!eligible.has(r.source_id)&&!(work.skippedAdmissions||[]).includes(r.source_id))
  if (unresolved.length) {
    mappingController.revealAdmission(unresolved[0].source_id)
    throw new Error(`尚有 ${unresolved.length} 筆報名未完成對應或缺少資料：${unresolved.slice(0,3).map(r=>r.sourceStudentName||`報名 ${r.source_id}`).join('、')}${unresolved.length>3?' 等':''}。請補齊，或選擇「保留 EduLog 並略過此筆」。`)
  }
  if (!eligible.size) throw new Error('目前沒有可匯入的報名。請查看各筆核對提示，完成既有報名查詢與對應後再產生差異。')
  const courseIds = [...new Set(work.snapshot.records.filter(r=>eligible.has(r.source_id)&&r.kind==='enrollment').map(r=>$(`enrollment-course-${r.source_id}`).value))], courseId = courseIds[0]
  const sessionId = $('class-session').value === 'new' ? idFor('class_session', work.snapshot.classId) : $('class-session').value
  if (!$('classroom').value || !courseId || !sessionId) throw new Error('請選擇目標教室、班級及各筆報名的課程。')
  const rows = [], needs = []
  for(const issue of work.history?.issues||[])if(issue.listFailed&&!issue.skipped)needs.push(`報名 ${issue.admissionPath} 的歷史索引未讀取；請重試或略過。`)
  if (work.history && work.history.next < work.history.paths.length) needs.push(`尚有 ${work.history.paths.length - work.history.next} 份來源紀錄未完成擷取。`)
  const completedRows=new Set((work.completedSourceKeys||[]).map(value=>String(value)))
  const add = (kind, sourceId, targetId, data) => {
    if(work.continuationMode&&completedRows.has(`${kind}:${sourceId}`))return null
    const row={ source_id: sourceId, target_id: targetId, overwrite: [], record: { kind, data } };rows.push(row);return row
  }
  rows.push(...mappingController.courseRows().filter(r=>courseIds.includes(r.target_id)&&!(work.continuationMode&&completedRows.has(`course:${r.source_id}`))))
  const session = context.class_sessions.find(s => s.id === sessionId)
  let schedule
  if ($('class-session').value === 'new') {
    if (!$('session-name').value.trim() || !$('session-start').value || $('session-day').value === '' || !$('session-from').value || !$('session-to').value || $('session-from').value >= $('session-to').value) throw new Error('請補齊班級名稱、開班日期、星期及有效原站時段。')
    schedule = { name: $('session-name').value.trim(), start_date: $('session-start').value, day_of_week: Number($('session-day').value), start_time: $('session-from').value, end_time: $('session-to').value }
  } else {
    if (!session) throw new Error('請重新核對目標班級。')
    schedule = { name: session.name, start_date: session.start_date, day_of_week: session.day_of_week, start_time: session.start_time, end_time: session.end_time }
  }
  if(session&&courseIds.some(id=>!session.course_ids.includes(id))&&!context.permissions.session?.class_update)throw new Error('此班級缺少所選課程，且你沒有修改班級權限。請改選可上課程或請管理員處理。')
  if(!session||courseIds.some(id=>!session.course_ids.includes(id))) {
    if(session&&(!schedule.start_time||!schedule.end_time||schedule.day_of_week==null||!schedule.start_date))throw new Error('此班級使用特殊排程且缺少所選課程，請在 EduLog 追加可上課程後返回核對；保留原排程。')
    add('class_session', work.snapshot.classId, sessionId, { ...schedule, classroom_id: $('classroom').value, course_ids: [...new Set([...(session?.course_ids || []), ...courseIds])], time_zone: 'Asia/Taipei', external_link: `https://corp.orangeapple.co/courses/dt/${work.snapshot.classId}` })
  }
  const enrollments = new Map(), enrollmentCourses = new Map(), addedStudents = new Set()
  work.sourceRosterEntries = []
  for (const r of work.snapshot.records.filter(r=>r.kind==='enrollment')) {
    if(!eligible.has(r.source_id)){needs.push(`報名 ${r.source_id}（${r.sourceStudentName||'姓名未辨識'}）已略過、尚有差異或缺少學生／課程；相關報告未匯入。`);continue}
    const studentChoice=mappingController.studentSelect(r).value, start=$(`start-${r.source_id}`)?.value,status=$(`status-${r.source_id}`)?.value,choice=$(`enrollment-${r.source_id}`)?.value,chosenCourse=$(`enrollment-course-${r.source_id}`)?.value
    if(!start||!status||!choice){needs.push(`報名 ${r.source_id} 缺少報名對應、日期或狀態。`);continue}
    if(studentChoice==='new'&&!r.student_source_id){needs.push(`報名 ${r.source_id} 缺少可靠學生 ID；不能建立新學生。`);continue}
    const studentId=studentChoice==='new'?idFor('student',r.student_source_id):studentChoice
    if(r.student_source_id&&!addedStudents.has(r.student_source_id)) {
      const sourceStudent=work.snapshot.records.find(s=>s.kind==='student'&&s.source_id===r.student_source_id)
      if(sourceStudent){add('student',r.student_source_id,studentId,sourceStudent.data);addedStudents.add(r.student_source_id)}
    }
    const id=choice==='new'?idFor('enrollment',r.source_id):choice;enrollments.set(r.source_id,id); enrollmentCourses.set(r.source_id,chosenCourse)
    work.sourceRosterEntries.push({ id, name:r.sourceStudentName,course:context.courses.find(c=>c.id===chosenCourse)?.display_name||r.sourceCourseLabel, start_date: start, status })
    const existingEnrollment=studentChoice!=='new'&&choice!=='new'&&context.enrollments.find(e=>e.id===choice)
    // A one-time transfer changes the occurrence roster, not the enrollment's
    // class-session relation. Keep that relation intact and rely on the
    // transfer-aware report validation below.
    if(!existingEnrollment||existingEnrollment.class_session_id===sessionId) {
      add('enrollment',r.source_id,id,{student_id:studentId,course_id:chosenCourse,class_session_id:sessionId,classroom_id:$('classroom').value,status,start_date:start,time_zone:'Asia/Taipei',external_link:r.data.external_link})
      rows.at(-1).source_identity=admissionIdentity(r)
    }
  }
  const historyBindings=[]
  for(const item of historyPlan) {
    if(item.category==='skipped'||item.category==='linked')continue
    if(item.category==='needs'){needs.push(`${item.target?.name||'來源報名 #'+item.record.enrollment_source_id} · ${item.record.date||item.record.dateRaw||'日期待確認'}：${item.reason}`);continue}
    if(['unfilled','other-admission','system-excluded'].includes(item.category))continue
    if(!['history','bind'].includes(item.category)){needs.push(globalThis.edulogUi?.t('work.historyUnknownCategory',{key:item.key||'來源報告',category:item.category||'未提供'})||`歷史 ${item.key||'來源報告'} 的分類「${item.category||'未提供'}」無法識別；請重新核對此報告。`);continue}
    const admissionId=item.record?.enrollment_source_id,preparedEnrollmentId=enrollments.get(admissionId)
    if(!admissionId||!preparedEnrollmentId){needs.push(`歷史 ${item.key||'來源報告'} 的報名尚未確認；此報告未加入同步資料。`);continue}
    if(!item.data||typeof item.data!=='object'||Array.isArray(item.data)||typeof item.data.enrollment_id!=='string'||!item.data.enrollment_id.trim()||item.data.enrollment_id!==preparedEnrollmentId||typeof item.data.report_date!=='string'||!item.data.report_date||!item.includedFields?.some(field=>Object.hasOwn(item.data,field))){needs.push(globalThis.edulogUi?.t('work.historyInvalidReference',{sourceId:item.key||admissionId})||`歷史 ${item.key||'來源報告'} 缺少有效報名、日期或已選取的教學欄位；請重新核對此報告。`);continue}
    if(item.category==='bind'&&(!item.occurrence?.id||!item.occurrence.class_session_id)){needs.push(`歷史 ${item.key} 缺少有效課次資料；已保留報告，請重新核對課次。`);continue}
    const targetId=item.existing?.id||idFor('history_report',item.key)
    const historyRow=add('history_report',item.key,targetId,item.data)
    if(!historyRow)continue
    // An EduLog report untouched since the last sync takes the source values.
    historyRow.overwrite=[...new Set([...(item.record.historyOverwrite||[]),...(item.autoOverwrite||[])])]
    if(item.record.historyDuplicateConfirmed)historyRow.reviewed_duplicate=true
    if(item.category==='bind'){
      const binding={historyId:targetId,itemKey:item.key,expectedFields:Object.fromEntries(teachingFields.filter(f=>Object.hasOwn(item.data,f)).map(f=>[f,item.data[f]])),occurrence:item.occurrence,body:{key:crypto.randomUUID(),class_occurrence_id:item.occurrence.id,overwrite:historyRow.overwrite,include_internal:work.includeInternalNotes,include_fields:item.includedFields||[]},status:'pending',atomic:true}
      historyRow.history_reconciliation={key:binding.body.key,class_occurrence_id:item.occurrence.id,overwrite:binding.body.overwrite,include_internal:work.includeInternalNotes,include_fields:item.includedFields||[]}
      historyBindings.push(binding)
    }
  }
  work.historyBindings=historyBindings
  work.destination = { classroom_id: $('classroom').value, course_ids: courseIds, class_session_id: sessionId, report_session_ids: [...new Set([sessionId,...historyBindings.map(b=>b.occurrence.class_session_id)])] }; work.needs = needs
  return rows
}
function validateHistoryRows(rows) {
  for(const row of rows) if(row?.record?.kind==='history_report') {
    const data=row.record.data
    if(typeof row.source_id!=='string'||!row.source_id.trim()||typeof row.target_id!=='string'||!row.target_id.trim()||!data||typeof data!=='object'||Array.isArray(data)||typeof data.enrollment_id!=='string'||!data.enrollment_id.trim()||typeof data.report_date!=='string'||!data.report_date) {
      const error=new Error(globalThis.edulogUi?.t('work.historyInvalidReference',{sourceId:row.source_id||'來源識別未提供'})||`歷史報告 ${row.source_id||'來源識別未提供'} 缺少有效報名或日期；請返回核對並重新產生摘要。`)
      error.code='HISTORY_REFERENCE_INVALID'
      throw error
    }
  }
}
async function preview(reuse = false) {
  if (!work || work.type !== 'import') throw new Error('請先擷取目前班級。')
  if(reviewSaveCoordinator?.isSaving(work))throw Object.assign(new Error(globalThis.edulogUi?.t('work.reviewSaveWait')||'核對決定正在保存，請等待完成。'),{code:'REVIEW_SAVE_IN_PROGRESS'})
  if (!reuse && work.jobId && work.previewJobPending) reuse = true
  if (!reuse) {
    if (work.jobId && !work.continuationMode && (work.done > 0 || ['applying','outcome_unknown','failed','stale'].includes(work.status))) throw new Error('此工作已有寫入或待確認檢查點。請使用「檢查並續傳」核對原批次，不能重新建立工作。')
    if (batchBytes < 4096) throw new Error('API 請求大小設定過小，請調整 API_BODY_LIMIT。')
  }
  work.previewDirty=true;delete work.previewError;previewResults=[];$('apply').disabled=true;$('preview-section').hidden=true
  try {
  await save()
  if (!reuse) {
    await mappingController.resolveFieldRules()
    if(!integrationCapabilities.enrollment_history_reports)throw Object.assign(new Error('目前連線未提供歷史保存功能。請重新檢查連線；已讀取資料與檢查點會保留。'),{code:'CAPABILITY_UNAVAILABLE'})
    await refreshHistoryPlan()
    const rows=prepareRows();validateHistoryRows(rows)
    const batches = splitBatches(rows, batchBytes)
    const batchWithEnrollment = new Map()
    for (const batch of batches) for (const row of batch.rows) if (row.record?.kind === 'enrollment') batchWithEnrollment.set(row.target_id, batch)
    const dependent = new Map(batches.map(batch => [batch, batch.rows.some(row => row.record?.kind === 'history_report' && batchWithEnrollment.get(row.record.data.enrollment_id) && batchWithEnrollment.get(row.record.data.enrollment_id) !== batch) ? 1 : 0]))
    batches.sort((a,b) => dependent.get(a)-dependent.get(b))
    for (const batch of batches) {
      const dependencies = new Map()
      for (const row of batch.rows) if (row.record?.kind === 'history_report') {
        const parent = batchWithEnrollment.get(row.record.data.enrollment_id)
        if (parent && parent !== batch) dependencies.set(parent.key, parent)
      }
      if (dependencies.size) batch.dependencies = [...dependencies.values()].map(parent => ({ key: parent.key, fingerprint: parent.previewFingerprint || '' }))
    }
    if (!batches.length) {renderNoopSummary();return}
    work.blockedRows = []
    work.previewDirty = true; previewResults = []; $('apply').disabled = true
    const startingNextRound=work.continuationMode&&Boolean(work.jobId)
    if(startingNextRound)rememberSubmissionRound(work)
    else if (work.jobId) await api('job-status', { status: 'cancelled' }, { jobId: work.jobId })
    const job = await api('job', { source_origin: work.snapshot.sourceOrigin, source_class_id: work.snapshot.classId, date_from: work.dateFrom, date_to: work.dateTo, ...work.destination })
    work.submissionRoundNo=startingNextRound?Math.max(Number(work.submissionRoundNo)||1,...(work.submissionRounds||[]).map(round=>round.roundNo||0))+1:(Number(work.submissionRoundNo)||1)
    work.batches = batches; work.done = 0; work.jobId = job.id; work.batchCount = batches.length; work.previewDirty = true; work.previewJobPending=true
    work.appliedBatchKeys=[];work.batchSummaries={};work.continuationMode=false;work.status='previewing'
    delete work.metadataSyncError
    if(startingNextRound&&!integrationCapabilities.work_record_metadata)work.metadataSyncError='此伺服器未提供提交輪次關聯；輪次資料只保存在此裝置。'
    try{await saveWorkMetadata(work,{server_job_id:job.id})}catch(error){work.metadataSyncError=error.message}
    await save()
    if(startingNextRound&&work.metadataSyncError)notice('新一輪已在此裝置保存，但伺服器未能保存跨裝置輪次關聯；請保留此裝置的工作草稿。',true)
  }
  validateBatches(work.batches);validateHistoryRows(work.batches.flatMap(batch=>batch.rows))
  refreshStaleReviewBatchRows()
  validateBatches(work.batches);validateHistoryRows(work.batches.flatMap(batch=>batch.rows))
  previewResults = []
  for (let i = work.done || 0; i < work.batches.length; i++) {
    const batch = work.batches[i]
    try {
      const result = await api('preview', importBatchRequest(batch), { jobId: work.jobId })
      if (result.batch_fingerprint) {
        batch.previewFingerprint = result.batch_fingerprint
        for (const child of work.batches.slice(i + 1)) if (child.dependencies?.some(ref => ref.key === batch.key)) child.dependencies = child.dependencies.map(ref => ref.key === batch.key ? { key: batch.key, fingerprint: result.batch_fingerprint } : ref)
        await save()
      }
      if (result.applied != null) { work.done = i + 1; work.appliedBatchKeys = [...new Set([...(work.appliedBatchKeys || []), batch.key])];work.completedSourceKeys=[...new Set([...(work.completedSourceKeys||[]),...(batch.rows||[]).map(row=>`${row.record.kind}:${row.source_id}`)])]; await save() }
      else previewResults.push({ ...result, batchIndex: i })
    } catch (error) {
      const entry = Object.entries(error.fields || {}).find(([key]) => key.startsWith('rows.'))
      const parts = entry?.[0].split('.') || []
      const kind = parts[1], sourceId = parts.slice(2, -1).join('.'), field = parts.at(-1)
      const rowIndex = kind && sourceId ? batch.rows.findIndex(row => row.record?.kind === kind && row.source_id === sourceId) : -1
      if (rowIndex < 0 || work.done > 0 || ['applying','outcome_unknown','failed'].includes(work.status)) {
        work.previewError={code:error.code||'PREVIEW_FAILED',message:error.message,batchKey:batch.key}
        await save()
        throw error
      }
      batch.rows.splice(rowIndex, 1)
      work.blockedRows ||= []
      work.blockedRows.push({ kind, source_id: sourceId, field, reason: entry[1][0] || 'REFERENCE_CHECK_FAILED' })
      work.previewDirty = true; $('apply').disabled = true
      if (batch.rows.length) {
        const previousKey=batch.key; batch.key = crypto.randomUUID(); delete batch.previewFingerprint
        const retainedEnrollments=new Set(batch.rows.filter(row=>row.record?.kind==='enrollment').map(row=>row.target_id))
        for (const child of work.batches.slice(i + 1)) if (child.dependencies?.some(ref => ref.key === previousKey)) {
          const needsParent=child.rows.some(row=>row.record?.kind==='history_report'&&retainedEnrollments.has(row.record.data.enrollment_id))
          child.dependencies=needsParent?child.dependencies.map(ref=>ref.key===previousKey?{key:batch.key,fingerprint:''}:ref):child.dependencies.filter(ref=>ref.key!==previousKey)
        }
        i--
      }
      else work.batches.splice(i--, 1)
      await save()
      notice(globalThis.edulogUi?.t('work.previewBlockedRow',{kind:labels[kind]||kind,sourceId}) || `${labels[kind]||kind} ${sourceId} 需要處理；其他資料繼續核對。`,true)
    }
  }
  const resolved=[];for(const pending of work.staleReviewPending||[]){const result=previewResults.flatMap(entry=>entry.rows||[]).find(row=>row.kind===pending.kind&&row.source_id===pending.source_id);if(result&&JSON.stringify(result.before?.[pending.field])===JSON.stringify(result.after?.[pending.field]))resolved.push(pending)}if(resolved.length){work.staleReviewPending=work.staleReviewPending.filter(pending=>!resolved.includes(pending));for(const pending of resolved){const record=historyPlan.find(item=>item.key===pending.source_id)?.record;if(record)record.staleReviewFields=(record.staleReviewFields||[]).filter(field=>field!==pending.field)}work.staleReviewRows=(work.staleReviewRows||[]).filter(stale=>(work.staleReviewPending||[]).some(pending=>pending.kind==='history_report'&&pending.source_id===stale.source_id));updateHistoryPlanLocal()}if(!(work.staleReviewPending||[]).length)work.staleReviewRows=[]
  work.status = 'previewed'; delete work.previewError; work.previewDirty = false; work.mappingDirty = false; work.previewJobPending=false; work.batchCount = work.batches.length; await save(); renderDifferences(); updateApplyAvailability(); notice(work.blockedRows?.length ? (globalThis.edulogUi?.t('work.previewPartial') || '摘要已準備；部分資料待處理。') : work.staleReviewPending?.length?'差異已更新；仍有報告需要回原核對區確認。':'差異已更新，請檢查後確認匯入。')
  } catch(error) {
    const interfaceFailure=workspaceInterfaceFailure(error)
    if(interfaceFailure)error.code=interfaceFailure.code
    const alreadyRecorded=work.previewError
    work.previewDirty=true
    if(!alreadyRecorded)work.previewError={code:error.code||'PREVIEW_FAILED',message:error.message||'Preview failed'}
    previewResults=[]
    $('apply').disabled=true;$('preview-section').hidden=error.code!=='STALE_REPORT_REVIEW_REQUIRED'
    taskStatus()
    if(error.code==='STALE_REPORT_REVIEW_REQUIRED')renderDifferences()
    else notice(globalThis.edulogUi?.t('work.previewFailed')||'差異核對失敗，請檢查後重試。',true)
    if(!alreadyRecorded&&!['failed','uncertain'].includes(saveState)&&!['WORK_STORAGE_FULL','WORK_SAVE_FAILED','BRIDGE_MESSAGE_TOO_LARGE','BRIDGE_CHANNEL_CLOSED','BRIDGE_UNAVAILABLE','BRIDGE_NO_RECEIVER','CONTEXT_INVALIDATED'].includes(error.code))try{await save()}catch{}
    throw error
  }
}
function renderNoopSummary() {
  work.previewEvaluated=true;work.previewDirty=true;previewResults=[];$('apply').disabled=true;show('preview-section');stage('import','repreview')
  const issueCounts=currentImportIssueCounts()
  $('counts').textContent=`沒有新的可寫入資料 · 已綁定 ${historyPlan.filter(i=>i.category==='linked').length} 份 · 需處理 ${issueCounts.pending} 項`
  $('diff-list').replaceChildren(node('p','本次核對不需要建立新工作。既有報告與檢查點保留；待處理項目可返回「處理例外」核對。'))
  if(issueCounts.pending||issueCounts.skipped){work.status='partial_complete';renderImportOutcome()}
  notice('核對完成：沒有新的可寫入資料，不會重送已同步報告。')
}
function staleReasonLabel(diagnostics) {
  const t=key=>globalThis.edulogUi?.t(key)
  if(work?.staleDiagnosticSource!=='version_check')return t('work.staleCauseUnknown')||'預覽已失效，原因尚未確認。請重新核對未提交資料。'
  const reasons=Object.values(diagnostics||{}).flat().filter(Boolean)
  if(reasons.includes('REQUEST_FINGERPRINT_CHANGED'))return t('work.staleReasonFingerprint')||'提交內容指紋與預覽不一致。'
  if(reasons.includes('TARGET_VERSION_CHANGED'))return t('work.staleReasonTargetChanged')||'已確認的 EduLog 目標資料版本改變。'
  if(reasons.includes('OCCURRENCE_REPORT_VERSION_CHANGED'))return t('work.staleReasonOccurrenceChanged')||'已確認的課次報告版本改變。'
  if(reasons.includes('PREVIEW_NOT_FOUND'))return t('work.staleReasonPreviewMissing')||'找不到這個批次的預覽。'
  return t('work.staleCauseUnknown')||'預覽已失效，原因尚未確認。請重新核對未提交資料。'
}
function captureStaleSummaryState(){
  if(!work)return
  const list=$('diff-list'),active=document.activeElement,card=active?.closest?.('[data-stale-review-key]')
  work.staleReviewSummaryUI={scrollY:window.scrollY,open:[...list.querySelectorAll('details[open][data-stale-review-detail]')].map(detail=>detail.dataset.staleReviewDetail),focusKey:card?.dataset.staleReviewKey||''}
}
function restoreStaleSummaryState(){
  const saved=work?.staleReviewSummaryUI;if(!saved)return
  const list=$('diff-list');for(const detail of list.querySelectorAll('details[data-stale-review-detail]'))detail.open=saved.open?.includes(detail.dataset.staleReviewDetail)||false
  const max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);window.scrollTo({top:Math.min(Math.max(0,Number(saved.scrollY)||0),max),behavior:'instant'})
  if(saved.focusKey){const card=[...list.querySelectorAll('[data-stale-review-key]')].find(item=>item.dataset.staleReviewKey===saved.focusKey);card?.querySelector('button[data-stale-review-open]')?.focus({preventScroll:true})}
}
function openStaleReport(item,field) {
  if(!item)return false
  if(!work?.staleReviewSummaryUI)captureStaleSummaryState()
  stage('import','preview')
  reviewPane('reports')
  const opened=historyView.focusReport(item.key,field)
  if(!opened)return false
  $('history-sync').scrollIntoView?.({block:'start',behavior:'smooth'})
  return true
}
function openStalePending(pending) {
  if(pending?.kind==='history_report'){
    const item=historyPlan.find(candidate=>candidate.key===pending.source_id)
    return item?openStaleReport(item,pending.field):false
  }
  if(!['admission','student'].includes(pending?.kind))return false
  if(!work?.staleReviewSummaryUI)captureStaleSummaryState()
  const owner=work,admissionId=pending.kind==='admission'?pending.source_id:work.snapshot?.records?.find(row=>row.kind==='enrollment'&&row.student_source_id===pending.source_id)?.source_id
  if(!admissionId)return false
  stage('import','preview')
  void (async()=>{
    try{
      await mappingView()
      if(work!==owner)return
      reviewPane('identity')
      if(!mappingController.revealAdmission(admissionId))throw new Error(globalThis.edulogUi?.t('work.staleMappingMissing')||'找不到對應的來源報名。')
      $('mapping-editor-pane').scrollIntoView?.({block:'start',behavior:'smooth'})
    }catch(error){if(work===owner)notice((globalThis.edulogUi?.t('work.staleMappingFailed')||'無法開啟對應核對區，請重試。')+' '+error.message,true)}
  })()
  return true
}
function staleTargetNames(record,pending){
  const links=context?.source_links||[],link=(kind,key)=>links.find(item=>item.source_kind===kind&&item.source_id===key&&item.valid!==false)
  let studentId=link('student',pending?.kind==='student'?pending.source_id:record?.student_source_id)?.target_id
  const admissionId=link('admission',pending?.kind==='admission'?pending.source_id:record?.source_id)?.target_id
  const enrollment=context?.enrollments?.find(item=>item.id===admissionId)
  studentId||=enrollment?.student_id
  const courseId=link('course',record?.source_course_id)?.target_id||enrollment?.course_id
  const student=context?.students?.find(item=>item.id===studentId),course=context?.courses?.find(item=>item.id===courseId)
  return {student:student?.name||student?.display_name||'',course:course?.display_name||course?.name||''}
}
function groupStaleReviewPending(pendingRows=[]){
  const grouped=new Map()
  for(const pending of pendingRows){const key=`${pending.kind}:${pending.source_id}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(pending)}
  return grouped
}
function renderDifferences() {
  $('diff-list').replaceChildren(); const totals = { added: 0, updated: 0, unchanged: 0, conflict: 0 }
  renderReviewBlockers($('diff-list'),work.staleReviewIssues,historyPlan,{
    record:key=>work.snapshot?.records?.find(record=>record.kind==='report'&&historyIdentity(record)===key),
    open:(key,field)=>{const item=historyPlan.find(candidate=>candidate.key===key);if(item)openStaleReport(item,field)},
    recheck:(key,admission)=>void runLatest(async()=>{const owner=work;await refreshHistoryPlan({admissions:admission?[admission]:undefined});if(work===owner){renderDifferences();notice(globalThis.edulogUi?.t('work.reviewRechecked')||'資料已重新核對，請處理問題後更新差異。')}},{label:globalThis.edulogUi?.t('work.reviewRecheckReport')||'重新核對此份報告'})
  })
  if(work.staleReviewPending?.length) {
    const section=node('section',undefined,'notice warning');section.setAttribute('role','region');section.setAttribute('aria-live','polite');section.setAttribute('aria-label','預覽失效後需要重新確認的報告')
    const grouped=groupStaleReviewPending(work.staleReviewPending),reportGroups=[...grouped].filter(([,fields])=>fields[0]?.kind==='history_report'),otherGroups=[...grouped].filter(([,fields])=>fields[0]?.kind!=='history_report'),t=(key,params)=>globalThis.edulogUi?.t(key,params),progress=node('p');progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');if(globalThis.edulogUi)globalThis.edulogUi.text(progress,'work.staleSummaryProgress',{reports:reportGroups.length,fields:reportGroups.reduce((sum,[,fields])=>sum+fields.length,0),other:otherGroups.length});else progress.textContent=`本輪有 ${reportGroups.length} 份報告、${reportGroups.reduce((sum,[,fields])=>sum+fields.length,0)} 個欄位待確認；另有 ${otherGroups.length} 筆身份／報名對應待處理。`;section.append(progress)
    const startReview=node('button');startReview.dataset.staleReviewStart='true';globalThis.edulogUi?.text(startReview,'work.staleStartReview');if(!globalThis.edulogUi)startReview.textContent='開始核對';startReview.type='button';startReview.disabled=!reportGroups.length;startReview.addEventListener('click',()=>{const first=reportGroups[0]?.[1]?.[0];if(first&&openStalePending(first))return;if(!first&&otherGroups[0]?.[1]?.[0]&&openStalePending(otherGroups[0][1][0]))return;notice('目前沒有可定位的待確認報告；請檢查來源與對應資料後重試。',true)});section.append(startReview)
    if(otherGroups.length){const other=node('section',undefined,'stale-review-other'),title=node('h4');if(globalThis.edulogUi)globalThis.edulogUi.text(title,'work.staleOtherItems',{count:otherGroups.length});else title.textContent=`另有 ${otherGroups.length} 筆身份／報名對應待處理`;const openOther=node('button');if(globalThis.edulogUi)globalThis.edulogUi.text(openOther,'work.staleOpenOther');else openOther.textContent='前往對應核對';openOther.type='button';openOther.addEventListener('click',()=>{if(!openStalePending(otherGroups[0][1][0]))notice('找不到可用的身份或報名對應資料，請重新讀取來源後再試。',true)});other.append(title,openOther);section.append(other)}
    for(const [key,fields] of reportGroups){const pending=fields[0],item=historyPlan.find(candidate=>candidate.key===pending.source_id),record=item?.record||work.snapshot?.records?.find(candidate=>candidate.kind==='report'&&historyIdentity(candidate)===pending.source_id),identityTarget=staleTargetNames(record,pending),row=node('article',undefined,'stale-review-choice');row.dataset.staleReviewKey=key;const sourceStudent=record?.sourceStudentName,targetStudent=item?.target?.name||identityTarget.student,student=targetStudent||sourceStudent||t('work.staleStudentMissing')||'學生姓名未提供',sourceCourse=record?.sourceCourseLabel,targetCourse=item?.target?.courseName||identityTarget.course,course=targetCourse||sourceCourse||t('work.staleCourseMissing')||'課程未提供',date=record?.date||record?.dateRaw||t('work.staleDateMissing')||'日期未提供',destination=item?.occurrence?`${item.occurrence.class_name||'課次'} · ${item.occurrence.occurrence_date||date}`:record?.historyOnly?'僅保存歷史':'課次待確認';row.append(node('h4',student),node('p',`${course} · ${date}`),node('p',t('work.staleDestination',{destination})||`同步目的地：${destination}`),node('p',t('work.staleFields',{fields:fields.map(entry=>fieldLabels[entry.field]||entry.field).join('、')})||`待確認欄位：${fields.map(entry=>fieldLabels[entry.field]||entry.field).join('、')}`));if(sourceStudent&&targetStudent&&sourceStudent!==targetStudent)row.append(node('p',t('work.staleSourceStudent',{name:sourceStudent})||`來源學生：${sourceStudent}`),node('p',t('work.staleTargetStudent',{name:targetStudent})||`EduLog 學生：${targetStudent}`));if(sourceCourse&&targetCourse&&sourceCourse!==targetCourse)row.append(node('p',t('work.staleSourceCourse',{name:sourceCourse})||`來源課程：${sourceCourse}`),node('p',t('work.staleTargetCourse',{name:targetCourse})||`EduLog 課程：${targetCourse}`));const comparisons=node('details'),comparisonsSummary=node('summary');comparisons.className='stale-review-comparisons';comparisons.dataset.staleReviewDetail=key+':values';comparisonsSummary.textContent='查看欄位差異';comparisons.append(comparisonsSummary);for(const entry of fields){const fieldDetails=node('section',undefined,'stale-review-field'),fieldLabel=fieldLabels[entry.field]||entry.field,decision=entry.previousDecision==='source'?(t('diff.sourceDecision')||'採用來源'):entry.previousDecision==='keep'?(t('diff.keep')||'保留 EduLog'):entry.previousDecision==='mixed'?(t('work.merge')||'混合'):entry.previousDecision==='skip'?(t('diff.skip')||'不同步'):(t('work.staleOldChoiceMissing')||'舊草稿未保留原選擇'),source=displayValue(entry.field,item?.sourceData?.[entry.field]??record?.data?.[entry.field]),target=displayValue(entry.field,item?.comparisonReport?.[entry.field]??item?.occurrence?.report?.[entry.field]);fieldDetails.append(node('h5',`${fieldLabel} · ${decision}`),node('p',t('work.staleSourceValue',{value:source})||`來源：${source}`),node('p',t('work.staleTargetValue',{value:target})||`EduLog 現值：${target}`));comparisons.append(fieldDetails)}row.append(comparisons);const reason=node('p',staleReasonLabel(work.staleDiagnostics));reason.className='hint';row.append(reason);const go=node('button');go.dataset.staleReviewOpen='true';if(globalThis.edulogUi)globalThis.edulogUi.text(go,'work.staleOpen');else go.textContent='前往核對';go.type='button';go.addEventListener('click',()=>{if(openStalePending(fields[0]))return;notice('這筆項目缺少可定位的報告資料；請先查看來源與對應核對區。',true)});row.append(go);const evidence=node('details'),evidenceSummary=node('summary');evidence.dataset.staleReviewDetail=key+':evidence';if(globalThis.edulogUi)globalThis.edulogUi.text(evidenceSummary,'work.staleEvidence');else evidenceSummary.textContent='診斷與來源證據';evidence.append(evidenceSummary,node('p',`來源識別：${pending.source_id} · 報名：${record?.enrollment_source_id||'未提供'} · 批次：${pending.batchKey||'未提供'} · 類型：${pending.kind||'未提供'}`));row.append(evidence);section.append(row)}
    $('diff-list').append(section)
  }
  if(work.staleDiagnostics&&!work.staleReviewPending?.length) {
    $('diff-list').append(node('p',`上次同步未提交：${staleReasonLabel(work.staleDiagnostics)}。已重新核對本輪差異，請檢查受影響報告後再確認同步。`,'notice warning'))
  }
  previewResults.forEach(result => result.rows.forEach((row, rowIndex) => {
    const batchIndex = result.batchIndex
    totals[row.status]++; const details = node('details'), summary = node('summary', `${labels[row.kind]} · ${row.source_id} · ${labels[row.status]}`); details.append(summary)
    if (row.kind === 'class_session' && row.status !== 'added' && JSON.stringify(row.before.course_ids) !== JSON.stringify(row.after.course_ids)) { details.open = true; summary.textContent = '加入班級可上課程 · 需要明確確認'; details.append(node('p','只追加本次確認的課程，保留班級原有課程與排程。','hint')) }
    for (const key of Object.keys(row.after)) {
      const diff=comparison(document,{label:fieldLabels[key]||key,source:row.after[key],target:row.before[key],sourceDisplay:()=>displayValue(key,row.after[key]),targetDisplay:()=>displayValue(key,row.before[key]),text:['content','contact_notes','class_notes'].includes(key)})
      details.append(diff)
      if (!['report_date','source_origin','source_admission_id','source_report_id','source_key','identity_status'].includes(key) && row.status !== 'added' && JSON.stringify(row.before[key]) !== JSON.stringify(row.after[key]) && (!['student_id','course_id','classroom_id','class_session_id','course_ids','enrollment_id','class_occurrence_id','start_date','day_of_week','start_time','end_time','time_zone','occurrence_date','original_start_time','original_end_time'].includes(key) || row.kind === 'class_session' && key === 'course_ids' && context.permissions.session?.class_update)) {
        const label = node('label', undefined, 'check'), check = node('input'); check.type = 'checkbox'; check.checked = work.batches[batchIndex].rows[rowIndex].overwrite.includes(key)
        label.append(check, node('span', key === 'course_ids' ? '我確認追加選定課程到班級可上課程（保留原有課程與排程）' : `明確改用來源「${fieldLabels[key] || key}」`));diff.append(label);decisionResult(diff,()=>displayValue(key,check.checked?row.after[key]:row.before[key]),check.checked?'source':'keep')
        check.addEventListener('change', () => { const target = work.batches[batchIndex].rows[rowIndex]; target.overwrite = check.checked ? [...new Set([...target.overwrite, key])] : target.overwrite.filter(k => k !== key); work.previewDirty = true; $('apply').disabled = true;decisionResult(diff,()=>displayValue(key,check.checked?row.after[key]:row.before[key]),check.checked?'source':'keep'); notice('欄位選擇已變更，請按「更新差異」。') })
      }
    }
    $('diff-list').append(details)
  }))
  work.batchSummaries ||= {}
  for (const result of previewResults) work.batchSummaries[work.batches[result.batchIndex].key] = summarizeImportRows(result.rows || [])
  const issueCounts=currentImportIssueCounts()
  $('counts').textContent = [...Object.entries(totals).map(([k, v]) => `${labels[k]} ${v}`), `需處理 ${issueCounts.pending}`, `已略過 ${issueCounts.skipped}`].join(' · ')
  const summary=node('section');summary.append(node('h3',`確認本次同步：保存 ${work.batches.flatMap(b=>b.rows).filter(r=>r.record.kind==='history_report').length} 份歷史 · 綁定 ${(work.historyBindings||[]).length} 堂課`),node('p','確認同步後，先保存歷史，再依已核對日期與有效名單綁定課次。未選取覆寫的非空內容保留 EduLog；報名關係不變。'))
  const bindings=work.historyBindings||[];if(bindings.length){const detail=node('details'),head=node('summary');if(globalThis.edulogUi)globalThis.edulogUi.text(head,'work.staleBindingDetails',{count:bindings.length});else head.textContent=`課次綁定明細 · ${bindings.length} 堂`;detail.append(head);for(const plan of bindings){const row=node('section',undefined,'history-binding-summary');row.append(node('p',`${plan.occurrence.class_name} · ${plan.occurrence.occurrence_date} · 覆寫 ${plan.body.overwrite.length} 個欄位`));const evidence=node('details'),label=node('summary');if(globalThis.edulogUi)globalThis.edulogUi.text(label,'work.staleBindingEvidence');else label.textContent='診斷與來源識別';evidence.append(label,node('p',`來源識別：${plan.itemKey}`));row.append(evidence);detail.append(row)}summary.append(detail)}
  if (work.blockedRows?.length) {
    const blocked = node('section', undefined, 'notice warning')
    blocked.setAttribute('role','status'); blocked.setAttribute('aria-live','polite')
    blocked.append(node('h3',globalThis.edulogUi?.t('work.blockedCount',{count:work.blockedRows.length}) || `待處理來源資料：${work.blockedRows.length} 筆`))
    blocked.append(node('p',globalThis.edulogUi?.t('work.blockedSummary',{count:work.blockedRows.length}) || '確認後僅同步已核對資料；被阻擋資料會保留。'))
    for (const issue of work.blockedRows) blocked.append(node('p',`${labels[issue.kind]||issue.kind} · ${issue.source_id} · ${issue.field} · ${issue.reason}`))
    summary.append(blocked)
    const applyButton=$('apply'); if(applyButton) globalThis.edulogUi?.text(applyButton,'work.applyEligible')
  } else {
    const applyButton=$('apply'); if(applyButton) globalThis.edulogUi?.text(applyButton,'work.applyBatches')
  }
  if(work.staleReviewIssues?.length||work.staleReviewPending?.length)$('diff-list').append(summary);else $('diff-list').prepend(summary)
  if (issueCounts.pending) { const d = node('details'); d.append(node('summary', `查看 ${issueCounts.pending} 項需處理資料`)); work.needs.forEach(text => d.append(node('p', text))); $('diff-list').append(d) }
  show('preview-section'); stage('import', 'apply'); updateApplyAvailability()
}

function refreshStaleReviewBatchRows(){
  if(!work?.staleReviewRows?.length)return
  try{prepareStaleReviewBatchRefresh(work,historyPlan,historyRoutes)()}
  catch(error){if(error.reviewIssues){work.staleReviewIssues=error.reviewIssues;historyView.updateStatus(historyPlan)}throw error}
}
function summarizeImportRows(rows) {
  const result = {}
  for (const row of rows) {
    result[row.kind] ||= {}
    result[row.kind][row.status] = (result[row.kind][row.status] || 0) + 1
  }
  return result
}
function mergeImportSummary(target, next) {
  for (const [kind, states] of Object.entries(next || {})) for (const [state, count] of Object.entries(states || {})) {
    target[kind] ||= {}; target[kind][state] = (target[kind][state] || 0) + count
  }
  return target
}
function currentImportIssueCounts(row=work) {
  if(!row)return {pending:0,skipped:0,excluded:0,unfilled:0}
  const keyFor=item=>{const record=item?.record||item;if(record?.enrollment_source_id)return historyIdentity(record);return item?.key||item?.source_id||(record?`${record.enrollment_source_id||''}:${record.date||record.dateRaw||''}`:null)}
  const skipped=new Set()
  for(const item of historyPlan||[])if(item.category==='skipped')skipped.add(keyFor(item))
  for(const issue of row.history?.issues||[])if(issue.skipped)skipped.add(keyFor(issue))
  for(const record of row.snapshot?.records||[])if(record.kind==='report'&&record.sourceSkipped)skipped.add(keyFor({source_id:record.source_id,record:{enrollment_source_id:record.enrollment_source_id,source_id:record.source_id,date:record.date}}))
  skipped.delete(null)
  const pending=new Set()
  for(const item of historyPlan||[])if(item.category==='needs')pending.add(keyFor(item))
  for(const item of row.staleReviewPending||[])pending.add(keyFor(item))
  for(const issue of row.history?.issues||[])if(issue.listFailed&&!issue.skipped)pending.add(keyFor(issue))
  for(const key of skipped)pending.delete(key)
  const knownPendingStrings=new Set()
  for(const item of historyPlan||[])if(item.category==='needs')for(const part of [item.key,item.record?.source_id,item.record?.enrollment_source_id,item.record?.date])if(part)knownPendingStrings.add(String(part))
  const otherPending=(row.needs||[]).filter(message=>![...skipped].some(key=>key&&String(message).includes(key)))
    .filter(message=>![...knownPendingStrings].some(key=>String(message).includes(key)))
  const unique=(items)=>new Set(items.map(keyFor).filter(Boolean)).size
  return {pending:pending.size+otherPending.length,skipped:skipped.size,excluded:unique((historyPlan||[]).filter(item=>item.category==='system-excluded')),unfilled:unique((historyPlan||[]).filter(item=>item.category==='unfilled'))}
}
function confirmedHistoryReportIds(row=work) {
  const ids=new Set()
  for(const round of row?.submissionRounds||[])for(const id of round.historySummary?.reportIds||[])ids.add(id)
  const applied=new Set(row?.appliedBatchKeys||[])
  for(const batch of row?.batches||[])if(applied.has(batch.key))for(const item of batch.rows||[])if(item.record?.kind==='history_report'&&item.target_id)ids.add(item.target_id)
  return [...ids]
}
function refreshConfirmedHistorySummary(row=work) {
  const reportIds=confirmedHistoryReportIds(row)
  const currentRoundNo=Number(row.submissionRoundNo)||1
  const priorRounds=(row.submissionRounds||[]).filter(round=>round.roundNo!==currentRoundNo)
  const unknownLegacy=priorRounds.filter(round=>round.historySummary?.saved!=null&&!Array.isArray(round.historySummary?.reportIds)).reduce((sum,round)=>sum+Number(round.historySummary.saved||0),0)
  const currentLegacy=Number(row.historySummary?.legacySaved??(!Array.isArray(row.historySummary?.reportIds)?row.historySummary?.saved:0)??0)
  row.historySummary={...(row.historySummary||{}),reportIds,legacySaved:currentLegacy,saved:reportIds.length+unknownLegacy+currentLegacy,unknownSaved:unknownLegacy>0||currentLegacy>0}
  return row.historySummary
}
function roundImportSummary(round) {
  if(round?.appliedBatchKeys?.length&&round.batchSummaries)return round.appliedBatchKeys.reduce((sum,key)=>mergeImportSummary(sum,round.batchSummaries[key]),{})
  const batches=round?.serverImportSummary?.batches||[]
  return batches.filter(batch=>batch.status==='applied').reduce((sum,batch)=>mergeImportSummary(sum,batch.classifications||batch.counts||{}),{})
}
function rememberSubmissionRound(row=work) {
  if(!row?.jobId)return
  row.submissionRounds ||= []
  const roundNo=Number(row.submissionRoundNo)||1
  const snapshot={roundNo,jobId:row.jobId,status:row.status,done:row.done||0,batchCount:row.batchCount||row.batches?.length||0,appliedBatchKeys:[...(row.appliedBatchKeys||[])],batchSummaries:{...(row.batchSummaries||{})},historySummary:row.historySummary||null,bindingSummary:{done:(row.historyBindings||[]).filter(binding=>binding.status==='done').length,total:(row.historyBindings||[]).length},serverImportSummary:row.serverImportSummary||null}
  row.submissionRounds=row.submissionRounds.filter(round=>round.roundNo!==roundNo)
  row.submissionRounds.push(snapshot);row.submissionRounds.sort((a,b)=>a.roundNo-b.roundNo)
}
function allSubmissionRounds(row=work) {
  const rounds=[...(row?.submissionRounds||[])]
  if(row?.jobId){const roundNo=Number(row.submissionRoundNo)||1;const current={roundNo,jobId:row.jobId,status:row.status,done:row.done||0,batchCount:row.batchCount||row.batches?.length||0,appliedBatchKeys:row.appliedBatchKeys||[],batchSummaries:row.batchSummaries||{},historySummary:row.historySummary||null,serverImportSummary:row.serverImportSummary||null};const index=rounds.findIndex(round=>round.roundNo===roundNo);if(index<0)rounds.push(current);else rounds[index]={...rounds[index],...current,serverImportSummary:row.serverImportSummary||rounds[index].serverImportSummary||null}}
  return rounds.sort((a,b)=>a.roundNo-b.roundNo)
}
function renderImportOutcome() {
  const host = $('import-outcome'); host.replaceChildren(); host.hidden = false
  renderDoneHeader()
  const title = node('h3', work.status==='complete'?'同步工作已完成':work.status==='stale'?'同步受阻，請重新核對未提交資料':work.status==='outcome_unknown'?'結果待確認':work.status==='cancelled'?'已取消剩餘工作':work.status==='awaiting-finalization'?'批次已保存，等待確認完成':'本輪同步完成，仍有待處理項目')
  host.append(title)
  const totals = {}
  const rounds=allSubmissionRounds()
  for(const round of rounds)mergeImportSummary(totals,roundImportSummary(round))
  const counts=Object.values(totals),bound=rounds.reduce((count,round)=>count+(round.bindingSummary?.done||0),0)||(work.historyBindings||[]).filter(binding=>binding.status==='done').length
  const issueCounts=currentImportIssueCounts()
  refreshConfirmedHistorySummary()
  outcomeMetrics(host,{saved:work.historySummary?.saved||0,bound,kept:counts.reduce((n,row)=>n+(row.conflict||0),0),skipped:issueCounts.skipped,failed:counts.reduce((n,row)=>n+(row.failed||0),0),pending:issueCounts.pending})
  for (const kind of ['student','enrollment','occurrence','report','history_report']) {
    const states = totals[kind]
    if (!states) continue
    const text = [`新增 ${states.added || 0}`,`更新 ${states.updated || 0}`,`無變更 ${states.unchanged || 0}`,`保留 EduLog ${states.conflict || 0}`].join(' · ')
    host.append(node('p', `${labels[kind]}：${text}`))
  }
  if (!Object.keys(totals).length && work.done) host.append(node('p','此工作由舊版擴充套件建立，沒有保留逐類結果；可查詢伺服器批次與有效名單。','hint'))
  const bindings=work.historyBindings||[]
  if(bindings.length)host.append(node('p',`課次報告：新增 ${bindings.filter(b=>b.result?.classification==='added').length} · 更新 ${bindings.filter(b=>b.result?.classification==='updated').length} · 無變更 ${bindings.filter(b=>b.result?.classification==='unchanged').length} · 綁定完成 ${bindings.filter(b=>b.status==='done').length}／${bindings.length}`))
  const archived=work.historySummary?.saved||0
  if(archived)host.append(node('p',`已確認保存歷史 ${archived}${work.historySummary?.unknownSaved?' 份以上，部分舊工作成果待伺服器核對':' 份'}；其中 ${bindings.filter(b=>b.status==='done').length} 份已綁定課次。`))
  if(issueCounts.pending)host.append(node('p', `另有 ${issueCounts.pending} 項未匯入或需處理；批次完成不代表來源資料已全部同步。`, 'hint'))
  if(work.metadataSyncError)host.append(node('p',`跨裝置輪次關聯尚未保存：${work.metadataSyncError}。此裝置的工作草稿仍可使用。`,'notice warning'))
  const skippedHistory=issueCounts.skipped
  if(skippedHistory)host.append(node('p',`歷史報告明確略過 ${skippedHistory} 筆；未建立這些報告。`,'hint'))
  for(const check of work.rosterChecks||[]) {
    host.append(node('p',`${check.name} · ${check.date} 有效名單 ${check.actual} 人；已綁定來源紀錄 ${check.observed} 人。來源日期名單不足，尚無法完整核對整班；不推定其他學生應被移除。`,'hint'))
    for(const missing of check.missing)host.append(node('p',`需要核對：${missing.name} · ${missing.course||'課程'} 未出現在該堂有效名單。`,'hint'))
  }
  if (work.rosterVerification) {
    const v = work.rosterVerification
    host.append(node('p', `${v.date} 有效名單核對：EduLog ${v.actual} 人；來源應有 ${v.expected} 人；缺少 ${v.missing.length} 人；其他 ${v.extra.length} 人。`))
    if (v.missing.length || v.extra.length) host.append(node('p', `名單有差異：${[...v.missing.map(id=>`缺少 ${id.slice(0,8)}`),...v.extra.map(id=>`EduLog 另有 ${id.slice(0,8)}`)].join('、')}`, 'hint'))
  } else if (work.rosterCheckError) host.append(node('p',`有效名單核對暫時失敗：${work.rosterCheckError}。可在工作紀錄重新查詢。`,'hint'))
  if(rounds.length)host.append(node('p',`提交輪次：${rounds.map(round=>`第 ${round.roundNo} 輪 ${round.appliedBatchKeys?.length||round.serverImportSummary?.batches?.filter(batch=>batch.status==='applied').length||0}/${round.batchCount||round.serverImportSummary?.batches?.length||0} 批`).join(' · ')}`,'hint'))
  if(work.status==='stale') {
    const reason=node('p',`目前批次尚未提交。原因：${staleReasonLabel(work.staleDiagnostics)}。已成功批次仍保留。`,'notice warning');reason.setAttribute('role','status');reason.setAttribute('aria-live','polite');host.append(reason)
    const retry=node('button','重新核對未提交資料');retry.type='button';retry.onclick=()=>void run(resumeImport,{label:'正在重新核對未提交資料'});host.append(retry)
    const results=node('button','查看已保存結果');results.type='button';results.onclick=()=>void run(loadSubmissionRoundResults,{label:'正在查詢已保存結果',readOnly:true});host.append(results)
    if(currentImportIssueCounts().pending){const pending=node('button','處理待確認報告');pending.type='button';pending.onclick=()=>void run(async()=>{work.continuationMode=true;flow('import');activeStages.import=2;await mappingView();renderHistoryIssues();notice('請處理待確認項目並更新差異；新一輪只會包含尚未保存的資料。')},{label:'正在開啟原工作待處理清單'});host.append(pending)}
  }
  if(work.status==='partial_complete') {
    const repair=node('button','處理待確認報告');repair.type='button'
    repair.addEventListener('click',()=>void run(async()=>{work.continuationMode=true;flow('import');activeStages.import=2;await mappingView();renderHistoryIssues();notice('請處理待確認項目並更新差異；新一輪只會包含尚未保存的資料。')},{label:'正在開啟原工作待處理清單'}));host.append(repair)
  }
  if(work.status==='cancelled'&&currentImportIssueCounts().pending) {
    const repair=node('button','處理待確認報告');repair.type='button'
    repair.addEventListener('click',()=>void run(async()=>{work.continuationMode=true;flow('import');activeStages.import=2;await mappingView();renderHistoryIssues();notice('請處理剩餘項目；新一輪只會包含尚未保存且已核對的資料。')},{label:'正在開啟原工作待處理清單'}));host.append(repair)
  }
  if(work.status==='awaiting-finalization') {
    const finish=node('button','確認完成本輪並更新課次');finish.type='button'
    finish.addEventListener('click',()=>void run(async()=>{await finalizeImport();notice(work.status==='complete'?'本輪同步及課次更新已確認完成。':'本輪批次已保存；仍有待處理項目，請查看結果。')},{label:'正在確認本輪完成'}));host.append(finish)
  }
}
async function loadSubmissionRoundResults() {
  const rounds=allSubmissionRounds()
  if(!rounds.length)throw new Error('目前工作沒有可查詢的伺服器提交輪次。')
  const owner=work?.id
  const results=await Promise.all(rounds.map(async round=>({round,info:await api('import-info',{}, {jobId:round.jobId})})))
  if(work?.id!==owner)return
  for(const {round,info} of results)round.serverImportSummary=info
  await save()
  renderImportOutcome()
  notice('已更新伺服器批次檢查點；草稿狀態與教學資料同步結果分開顯示。')
}
function displayValue(key, value) {
  if(['is_completed','attendance_status','class_participation','classroom_behavior'].includes(key))return semanticValue(key,value)
  if (value == null) return '—'
  if(key==='source_fields')return value.map(f=>`${f.label}：${f.text}`).join('\n')||'未提供原文'
  if(key==='source_evidence')return value.map(e=>`${e.source_path} · ${e.table} · 第 ${e.row} 列`).join('\n')||'未提供位置'
  if(key==='attendance_status')return ({present:'出席',absent:'不出席',pending:'待確認'})[value]||'待確認選項'
  if(key==='identity_status')return value==='verified'?'已驗證報告 ID／編輯連結':'來源身份不足，依教學內容保存歷史'
  if (key === 'is_completed') return value ? '課程已完成' : '課程未完成'
  if (key === 'status') return ({ regular: '正式', trial: '試讀', completed: '完課', dropped: '退班' })[value] || String(value)
  const resource = { classroom_id: 'classrooms', course_id: 'courses', course_ids: 'courses', student_id: 'students', class_session_id: 'class_sessions', lesson_id: 'lessons' }[key]
  if (resource) return (Array.isArray(value) ? value : [value]).map(id => { const item = context[resource].find(r => r.id === id); if(key==='lesson_id'&&item)return globalThis.edulogFieldMappings.lessonLabel(item);return item?.name || item?.display_name || item?.title || (item?.subject ? `${item.subject} ${item.stage}` : `待建立／對應 ${String(id).slice(0, 8)}`) }).join('、')
  return String(value)
}
function progress() {
  const issueCounts=currentImportIssueCounts()
  show('import-progress'); $('progress').max = work.batchCount || 1; $('progress').value = work.done || 0
  $('progress-label').textContent = `已完成 ${work.done || 0} / ${work.batchCount || 0} 批。${issueCounts.pending} 項仍需處理。`
  $('resume').hidden = !['paused','failed','outcome_unknown','stale'].includes(work.status)
  $('pause').hidden = work.status !== 'applying'; $('cancel-work').hidden = ['complete','cancelled','partial_complete','awaiting-finalization'].includes(work.status)
  stage('import','resume');$('operation-status').hidden = !['applying','stale','outcome_unknown','partial_complete','complete','failed','cancelled','awaiting-finalization'].includes(work.status)
  $('operation-status').dataset.state = work.status === 'applying' ? 'loading' : ['failed','stale','outcome_unknown'].includes(work.status) ? 'error' : 'complete'
  $('operation-title').textContent = ({ applying:'正在寫入匯入批次', paused:'匯入已暫停', failed:'匯入部分失敗', stale:'同步受阻，預覽已失效', outcome_unknown:'寫入結果尚未確認', complete:'同步工作已完成', partial_complete:'本輪完成，仍有待處理項目', cancelled:'已取消剩餘批次','awaiting-finalization':'批次已保存，等待確認完成' })[work.status] || '匯入進度'
  $('operation-detail').textContent = work.status==='stale'?`目前批次尚未提交；已知成功批次保留。原因：${staleReasonLabel(work.staleDiagnostics)}。工作資料列數不等於報告數。`:`已核對 ${work.done || 0} / ${work.batchCount || 0} 批；${issueCounts.pending} 份報告仍需處理。取消不會撤回已完成批次。`
  $('operation-progress').hidden = !work.batchCount; $('operation-progress').max = work.batchCount || 1; $('operation-progress').value = work.done || 0
  if (work.status === 'complete' || work.status === 'partial_complete' || work.status === 'stale' || work.status==='outcome_unknown' || work.status==='cancelled' || work.status==='awaiting-finalization') renderImportOutcome()
}
function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}-${parts.find(p=>p.type==='day').value}`
}
// Source rows without a reportId are saved only as attendance evidence for
// enrollments that now exist. Failures never undo the applied import.
async function recordAttendanceEvidence() {
  if(!integrationCapabilities.attendance_evidence||work.attendanceEvidenceRecorded)return
  const targets=historyTargets(),items=[]
  for(const record of work.snapshot?.records||[]){
    if(record.kind!=='attendance'||!record.date||record.date<work.dateFrom||record.date>work.dateTo)continue
    const target=targets.get(record.enrollment_source_id)
    if(!target?.id||!(record.attendance_count>0))continue
    items.push({enrollment_id:target.id,source_admission_id:record.enrollment_source_id,...(record.sourceClassId?{source_class_id:String(record.sourceClassId)}:{}),evidence_date:record.date,attendance_count:Math.min(20,record.attendance_count),present_count:Math.min(20,record.present_count||0),absent_count:Math.min(20,record.absent_count||0)})
  }
  try{for(let i=0;i<items.length;i+=50)await api('attendance-evidence',{source_origin:'https://corp.orangeapple.co',items:items.slice(i,i+50)});work.attendanceEvidenceRecorded=true}
  catch(error){work.needs.push(`出席證據未保存：${error.message}；匯入的報告不受影響。`)}
}
// Reports of enrollments created by this sync can only be routed once the enrollment exists,
// so they are planned again here and bound in the same finishing step.
async function bindCreatedEnrollments() {
  if(!integrationCapabilities.enrollment_history_reports)return
  const created=[...historyTargets()].filter(([,target])=>target.isNew&&target.id).map(([admission])=>admission)
  if(!created.length)return
  work.createdAdmissions=[...new Set([...(work.createdAdmissions||[]),...created])]
  await refreshHistoryPlan({admissions:created})
  work.historyBindings||=[]
  for(const item of historyPlan) {
    if(item.category!=='bind'||!created.includes(item.record?.enrollment_source_id)||!item.occurrence?.id||!item.existing?.id)continue
    if(work.historyBindings.some(binding=>binding.itemKey===item.key))continue
    work.historyBindings.push({historyId:item.existing.id,itemKey:item.key,expectedFields:Object.fromEntries(teachingFields.filter(f=>Object.hasOwn(item.data||{},f)).map(f=>[f,item.data[f]])),occurrence:item.occurrence,body:{key:crypto.randomUUID(),class_occurrence_id:item.occurrence.id,overwrite:[],include_internal:work.includeInternalNotes,include_fields:item.includedFields||[]},status:'pending',atomic:false})
  }
  await save()
}
async function finalizeImport() {
  await bindCreatedEnrollments()
  await applyHistoryBindings()
  const issueCounts=currentImportIssueCounts()
  refreshConfirmedHistorySummary()
  work.historySummary.linked=(work.historyBindings||[]).filter(b=>b.status==='done').length
  work.historySummary.skipped=issueCounts.skipped
  const keys = work.batches.map(batch => batch.key)
  const completed = await api('complete', { expected_batch_keys: keys }, { jobId: work.jobId })
  work.status = completed.verified === true && !work.blockedRows?.length && !issueCounts.pending && !issueCounts.skipped ? 'complete' : 'partial_complete'
  work.appliedBatchKeys = [...new Set([...(work.appliedBatchKeys||[]),...keys])]
  try {
    const checks=[...new Map((work.historyBindings||[]).filter(b=>b.status==='done').map(b=>[`${b.occurrence.class_session_id}:${b.occurrence.occurrence_date}`,{session:b.occurrence.class_session_id,date:b.occurrence.occurrence_date,name:b.occurrence.class_name}])).values()]
    work.rosterChecks=[]
    let info
    for(const check of checks) {
      info=await api('import-info',undefined,{jobId:work.jobId,query:{roster_date:check.date,class_session_id:check.session}})
      const roster=info.roster?.enrollments||[],actual=new Set(roster.map(r=>r.id))
      const observed=(work.historyBindings||[]).filter(b=>b.status==='done'&&b.occurrence.class_session_id===check.session&&b.occurrence.occurrence_date===check.date).map(b=>historyPlan.find(i=>i.key===b.itemKey)?.target?.id||work.batches.flatMap(batch=>batch.rows).find(r=>r.target_id===b.historyId)?.record.data.enrollment_id)
      const expected=[...new Set(observed.filter(Boolean))]
      work.rosterChecks.push({...check,actual:roster.length,observed:expected.length,completeSource:false,missing:expected.filter(id=>!actual.has(id)).map(id=>work.sourceRosterEntries?.find(r=>r.id===id)||{id,name:'學生名稱尚未取得'})})
    }
    info ||= await api('import-info',undefined,{jobId:work.jobId})
    work.rosterVerification=null
    work.serverImportSummary = {
      status: info.job?.status,
      batchCount: info.batches?.length || 0,
      appliedRows: (info.batches || []).reduce((sum, batch) => sum + (batch.applied || 0), 0),
      kinds: (info.batches || []).reduce((sum, batch) => mergeImportSummary(sum, batch.classifications || {}), {}),
    }
  } catch (error) {
    work.rosterVerification = null
    work.rosterCheckError = error.message
  }
  delete work.sourceRosterEntries
  rememberSubmissionRound(work)
  await save(); progress()
}
async function applyHistoryBindings() {
  const owner=work,epoch=generation
  const check=()=>{if(owner!==work||epoch!==generation){const error=new Error('工作情境已變更；請用原檢查點核對保存結果。');error.code='API_RESPONSE_INVALID';throw error}}
  for(const plan of owner.historyBindings||[]) {
    if(plan.atomic)continue
    if(['done','blocked'].includes(plan.status))continue
    try {
      if(plan.status!=='previewed') {
        const archive=await api('history-detail',undefined,{historyId:plan.historyId})
        check()
        if(Object.entries(plan.expectedFields).some(([f,v])=>JSON.stringify(archive[f])!==JSON.stringify(v)))throw new Error('歷史內容已變更或保留了既有值，請在主站重新核對綁定。')
        plan.body.history_version=archive.version
        const checked=await api('history-bind-preview',plan.body,{historyId:plan.historyId})
        check()
        if(!bindingStillMatches(plan,checked))throw new Error('課次報告版本已變更，請重新查看差異；本次只保存歷史。')
        plan.status='previewed';await save()
      }
      const result=await api('history-bind-apply',plan.body,{historyId:plan.historyId});check();plan.result=result;plan.status='done';await save()
    } catch(error) {
      if(['API_TIMEOUT','API_NETWORK_ERROR','API_RESPONSE_INVALID'].includes(error.code)||/^HTTP_5/.test(error.code||''))throw error
      plan.status='blocked';plan.error=error.message;work.needs.push(`課次綁定 ${plan.itemKey}：${error.message} 歷史已保存，可在 EduLog 處理。`);await save()
    }
  }
}
async function apply() {
  if(typeof reviewSaveCoordinator!=='undefined'&&reviewSaveCoordinator?.isSaving(work))throw Object.assign(new Error(globalThis.edulogUi?.t('work.reviewSaveWait')||'核對決定正在保存，請等待完成。'),{code:'REVIEW_SAVE_IN_PROGRESS'})
  if(work.staleReviewIssues?.length)throw Object.assign(new Error('Reports still need review'),{code:'STALE_REPORT_REVIEW_REQUIRED'})
  if (work.previewDirty || !work.jobId) throw new Error('請先更新差異。')
  if(work.staleReviewPending?.length){const error=new Error(`仍有 ${new Set(work.staleReviewPending.map(row=>`${row.kind}:${row.source_id}`)).size} 份報告需要重新確認。`);error.code='STALE_REVIEW_REQUIRED';throw error}
  if (work.blockedRows?.length && !window.confirm(globalThis.edulogUi?.t('work.confirmEligible',{count:work.blockedRows.length}) || `仍有 ${work.blockedRows.length} 筆來源資料被阻擋。只同步可處理資料並保留待處理項目？`)) return
  for (const result of previewResults) for (const row of result.rows || []) if (row.kind === 'class_session' && row.status !== 'added' && JSON.stringify(row.before.course_ids) !== JSON.stringify(row.after.course_ids)) {
    const batchRow = work.batches[result.batchIndex].rows.find(r => r.record.kind === row.kind && r.source_id === row.source_id)
    if (!batchRow?.overwrite.includes('course_ids')) throw new Error('請明確確認「加入班級可上課程」，再更新差異後匯入。')
  }
  const expectedGeneration = generation
  paused = false; cancelRequested = false; work.status = 'applying'; await api('job-status', { status: 'applying' }, { jobId: work.jobId }); await save(); progress()
  try {
    for (let i = work.done || 0; i < work.batches.length; i++) {
      if (paused || generation !== expectedGeneration) break
      // Re-read the source context before each write; it must still identify
      // the chosen class. Collected data may resume without a closed source tab.
      const sourceCheck = await send({ type: 'workspace-check-source', tabId: work.sourceTab, sourcePath: work.sourcePath })
      if (sourceCheck.closed && !work.batches?.[i]?.rows?.length) throw new Error('來源分頁已關閉且此批尚未完整擷取。請重新開啟相同班級頁後再續傳。')
      const applied=await api('apply', importBatchRequest(work.batches[i]), { jobId: work.jobId })
      for(const result of applied.history_reconciliations||[]){const plan=work.historyBindings?.find(binding=>binding.atomic&&binding.itemKey===result.source_id);if(plan){plan.result=result;plan.status=result.status==='linked'?'done':result.status==='skipped'?'blocked':'done';if(plan.status==='blocked')work.needs.push(`課次同步 ${plan.itemKey}：${result.reason||'本次沒有可套用欄位'}；歷史已保存。`)}}
      const previewBatch = previewResults.find(result => result.batchIndex === i)
      if (previewBatch) {
        const summary = {}
        for (const row of previewBatch.rows || []) { summary[row.kind] ||= {}; summary[row.kind][row.status] = (summary[row.kind][row.status] || 0) + 1 }
        work.batchSummaries ||= {}; work.batchSummaries[work.batches[i].key] = summary
      }
      const appliedBatch=work.batches[i]
      work.appliedBatchKeys=[...new Set([...(work.appliedBatchKeys||[]),appliedBatch.key])]
      work.completedSourceKeys=[...new Set([...(work.completedSourceKeys||[]),...appliedBatch.rows.map(row=>`${row.record.kind}:${row.source_id}`)])]
      work.done = i + 1
      if(typeof refreshConfirmedHistorySummary==='function')refreshConfirmedHistorySummary()
      if(typeof rememberSubmissionRound==='function')rememberSubmissionRound(work)
      await save(); progress()
    }
    const finished = work.done === work.batches.length
    work.status = finished ? 'applying' : cancelRequested ? 'cancelled' : 'paused'
    if (finished) { if (typeof recordAttendanceEvidence === 'function') await recordAttendanceEvidence(); await finalizeImport() }
    else { await api('job-status', { status: work.status }, { jobId: work.jobId }); await save(); progress() }
    if (finished || cancelRequested) { previewResults = []; $('mapping').hidden = true; $('preview-section').hidden = true; $('pause').hidden = true; $('cancel-work').hidden = true; stage('import', 'cancel-work') }
    notice(finished ? `已核對 ${work.batchCount} 個匯入批次；${currentImportIssueCounts().pending} 項仍需處理，請查看名單核對結果。` : cancelRequested ? '已取消剩餘工作，成功寫入的資料保留。' : '工作已暫停，成功批次保留。')
  } catch (error) {
    if(error.code==='PREVIEW_STALE') {
      work.status='stale';work.previewDirty=true;work.staleBatchKey=work.batches?.[work.done||0]?.key||null
      work.staleDiagnostics=error.fields||null;work.staleDiagnosticSource=error.diagnosticSource||null;work.staleObservedAt=new Date().toISOString();work.previewError={code:'PREVIEW_STALE',message:error.message,batchKey:work.staleBatchKey}
      previewResults=[];$('preview-section').hidden=true;$('apply').disabled=true
      try{await api('job-status',{status:'paused'},{jobId:work.jobId})}catch{}
      rememberSubmissionRound(work);await save();progress()
    } else {work.status = ['API_TIMEOUT','API_NETWORK_ERROR','API_RESPONSE_INVALID'].includes(error.code) || /^HTTP_5/.test(error.code || '') ? 'outcome_unknown' : 'failed'; await save(); progress()}
    throw error
  }
}
async function refreshImportCheckpoint() {
  const owner=work?.id,jobId=work?.jobId
  const info=await api('import-info',undefined,{jobId})
  if(work?.id!==owner||work?.jobId!==jobId)throw Object.assign(new Error('工作已切換；請重新選取工作後再核對。'),{code:'WORK_CHANGED'})
  const serverBatches=Array.isArray(info?.batches)?info.batches:[]
  const byKey=new Map(serverBatches.filter(batch=>typeof batch.key==='string').map(batch=>[batch.key,batch]))
  const localBatches=work.batches||[]
  const localKeys=new Set(localBatches.map(batch=>batch.key))
  if(serverBatches.some(batch=>batch.key&&!localKeys.has(batch.key)))throw Object.assign(new Error('伺服器檢查點包含本機草稿沒有的批次；已停止續傳以避免重複寫入。請查看已保存結果。'),{code:'IMPORT_CHECKPOINT_MISMATCH'})
  let confirmed=0,foundPending=false
  const appliedKeys=[]
  const summaries={...(work.batchSummaries||{})}
  const completedSources=new Set(work.completedSourceKeys||[])
  for(const [index,batch] of localBatches.entries()) {
    const remote=byKey.get(batch.key)
    const applied=remote?.status==='applied'
    if(applied&&foundPending)throw Object.assign(new Error('伺服器批次檢查點順序不一致；已停止續傳，請查看已保存結果。'),{code:'IMPORT_CHECKPOINT_MISMATCH'})
    if(applied) {
      confirmed=index+1;appliedKeys.push(batch.key)
      summaries[batch.key]=remote.classifications||remote.counts||summaries[batch.key]||{}
      for(const row of batch.rows||[])completedSources.add(`${row.record?.kind}:${row.source_id}`)
    } else {
      foundPending=true
      if(index<(work.done||0))throw Object.assign(new Error('本機已保存的完成檢查點與伺服器結果不一致；已停止續傳，請先查看已保存結果。'),{code:'IMPORT_CHECKPOINT_MISMATCH'})
    }
  }
  work.done=confirmed
  work.appliedBatchKeys=[...new Set([...(work.appliedBatchKeys||[]),...appliedKeys])]
  work.batchSummaries=summaries
  work.completedSourceKeys=[...completedSources]
  work.serverCheckpointCheckedAt=new Date().toISOString()
  await save()
  return info
}
async function resumeImport() {
  if (!work?.jobId) throw new Error('找不到可恢復的匯入工作。')
  const info=await refreshImportCheckpoint()
  const serverStatus=info?.job?.status
  if(!serverStatus)throw Object.assign(new Error('伺服器工作狀態未回傳；草稿與檢查點已保留，請重試查詢。'),{code:'IMPORT_STATUS_UNKNOWN'})
  work.serverJobStatus=serverStatus
  const serverSummary={status:serverStatus,batchCount:info.batches?.length||0,appliedRows:(info.batches||[]).reduce((sum,batch)=>sum+(batch.applied||0),0),batches:(info.batches||[]).map(batch=>({key:batch.key,status:batch.status,applied:batch.applied||0,counts:batch.counts||{}}))}
  if(serverStatus==='complete'||serverStatus==='cancelled') {
    work.serverImportSummary=serverSummary
    const issueCounts=currentImportIssueCounts()
    work.status=serverStatus==='complete'?(issueCounts.pending||issueCounts.skipped?'partial_complete':'complete'):'cancelled'
    await save();progress();renderImportOutcome()
    notice(serverStatus==='complete'?'伺服器已確認本工作完成；成果與待處理項目已更新。':'匯入工作已取消；已完成批次保留，未完成項目可查看或建立新輪次。')
    return
  }
  if(work?.status==='stale') {
    const affected=new Set()
    for(const [key,values] of Object.entries(work.staleDiagnosticSource==='version_check'?work.staleDiagnostics||{}:{}))if(values.some(value=>['TARGET_VERSION_CHANGED','OCCURRENCE_REPORT_VERSION_CHANGED'].includes(value))) {
      const parts=key.split('.')
      if(parts[0]==='batches')for(const batch of work.batches||[])if(batch.key===parts[1])for(const row of batch.rows||[])affected.add(row)
      if(parts[0]==='rows'){const sourceId=parts.slice(2,-1).join('.');for(const batch of work.batches||[])for(const row of batch.rows||[])if(row.record?.kind===parts[1]&&row.source_id===sourceId)affected.add(row)}
    }
    work.staleReviewPending ||= []
    work.staleReviewRows ||= []
    for(const row of affected) {
      const batch=(work.batches||[]).find(item=>item.rows?.includes(row))
      if(row.record?.kind==='history_report'&&!work.staleReviewRows.some(item=>item.batchKey===batch?.key&&item.source_id===row.source_id))work.staleReviewRows.push({batchKey:batch?.key,source_id:row.source_id})
      const report=historyPlan.find(item=>item.key===row.source_id),record=report?.record||work.snapshot?.records?.find(candidate=>candidate.kind==='report'&&historyIdentity(candidate)===row.source_id),fields=[...new Set([...(row.overwrite||[]),...(row.record?.kind==='history_report'?record?.historyOverwrite||[]:[])])]
      if(row.record?.kind==='history_report'&&fields.length){record.staleReviewFields=[...new Set([...(record.staleReviewFields||[]),...fields])];record.historyConflictConfirmed=false;record.historyConflictSignature=''}
      for(const field of fields)if(!work.staleReviewPending.some(item=>item.batchKey===batch?.key&&item.kind===row.record?.kind&&item.source_id===row.source_id&&item.field===field)){const previousDecision=record?.historyFieldDecisions?.[field]||((row.overwrite||[]).includes(field)?'source':'keep');work.staleReviewPending.push({batchKey:batch?.key,kind:row.record?.kind,source_id:row.source_id,field,previousDecision});if(row.record?.kind==='history_report'){delete record.historyFieldDecisions?.[field];delete record.syncFieldOverrides?.[field];record.historyOverwrite=(record.historyOverwrite||[]).filter(value=>value!==field)}}
      row.overwrite=[]
      if(row.history_reconciliation)row.history_reconciliation.overwrite=[]
      const binding=work.historyBindings?.find(candidate=>candidate.itemKey===row.source_id);if(binding?.body)binding.body.overwrite=[]
    }
    if(typeof updateHistoryPlanLocal==='function')updateHistoryPlanLocal();work.previewDirty=true;work.status='failed';await save()
  }
  if(!['paused','previewed','pending','applying','failed','outcome_unknown'].includes(serverStatus))throw Object.assign(new Error('伺服器回傳無法辨識的工作狀態；已停止恢復。'),{code:'IMPORT_STATUS_UNKNOWN'})
  if(serverStatus==='applying') {
    await api('job-status',{status:'paused'},{jobId:work.jobId})
    work.serverJobStatus='paused'
  }
  try {
    await preview(true)
  } catch(error) {
    if(error.code!=='JOB_STOPPED')throw error
    let latest
    try{latest=await refreshImportCheckpoint()}catch{throw Object.assign(new Error('重新核對遭伺服器拒絕，且目前無法查明工作狀態。草稿與檢查點已保留，請確認連線後重試。'),{code:'IMPORT_STATUS_UNKNOWN'})}
    const latestStatus=latest?.job?.status
    if(latestStatus==='complete'||latestStatus==='cancelled') {
      work.serverJobStatus=latestStatus
      work.serverImportSummary={status:latestStatus,batchCount:latest.batches?.length||0,appliedRows:(latest.batches||[]).reduce((sum,batch)=>sum+(batch.applied||0),0),batches:(latest.batches||[]).map(batch=>({key:batch.key,status:batch.status,applied:batch.applied||0,counts:batch.counts||{}}))}
      const issueCounts=currentImportIssueCounts()
      work.status=latestStatus==='complete'?(issueCounts.pending||issueCounts.skipped?'partial_complete':'complete'):'cancelled'
      await save();progress();renderImportOutcome()
      notice(latestStatus==='complete'?'伺服器已確認本工作完成；成果與待處理項目已更新。':'匯入工作已取消；已完成批次保留，未完成項目可查看或建立新輪次。')
      return
    }
    if(latestStatus==='paused')throw Object.assign(new Error('伺服器仍拒絕暫停工作的預覽。請更新 EduLog 伺服器後再重新核對；原工作與批次已保留。'),{code:'PAUSED_PREVIEW_UNSUPPORTED'})
    throw error
  }
  if ((work.done || 0) >= (work.batchCount || work.batches?.length || 0)) {
    work.status='awaiting-finalization';work.serverImportSummary=serverSummary;await save();progress();notice('伺服器檢查點確認批次已保存。請檢查結果並明確確認完成與課次更新。');return
  }
  notice('已用原批次與伺服器檢查點重新核對。差異已更新但尚未同步；請檢視後明確確認。')
}
async function readForm() {
  if (!reportSourceReady) throw new Error('來源分頁沒有開啟可辨識的報告表單。請在網站開啟「記錄」表單後重新讀取。')
  form = await source('form')
  const mapped=await api('resolve',{source_refs:[{source_kind:'enrollment',source_id:form.admissionId}],target_refs:[],memory_refs:[{kind:'admission',key:form.admissionId}]}); const memory=(mapped.memories||[]).find(m=>m.valid&&!m.suggestion); const linked=(mapped.source_links||[]).find(m=>m.valid!==false); form.targetEnrollmentId=memory?.target_id||linked?.target_id||null; form.targetStudentId=memory?.student_id; form.targetCourseId=memory?.course_id;
  work = { id: crypto.randomUUID(), type: 'prefill', status: 'reviewing', sourceTab: Number($('source-tab').value), sourcePath: selectedPath, title: form.title || `原站報告 ${form.reportId}`, form }
  activeWorks.prefill=work;await save(); $('target-title').textContent = `${form.targetEnrollmentId ? '已沿用報名對應 · ' : ''}${form.title || '請核對原站學生'} · 報名 ${form.admissionId} · 報告 ${form.reportId}`; $('target-date').value = form.date || ''; $('target-confirm').checked = false
  reports = []; reportCursor = ''; await loadReportCourses(true); await loadReportSummaries(true); show('target-summary'); show('report-picker'); stage('prefill', 'compare'); notice('已讀取表單；尚未變更原站內容。')
}
async function loadReportCourses(reset = false) {
  if (reset) { reportCourseCursor = ''; $('report-course').replaceChildren(new Option(form?.targetCourseId ? '已記住的課程（可改選）' : '所有可讀取課程', '')) }
  const page = await catalog('courses', { limit: 50, cursor: reportCourseCursor || undefined })
  for (const course of page.items || []) $('report-course').add(new Option(course.display_name || `${course.subject} ${course.stage}`, course.id))
  reportCourseCursor = page.next_cursor || ''; $('more-courses').hidden = !reportCourseCursor
}
async function loadReportSummaries(reset = false) {
  const requestGeneration = activeReadGeneration
  if (reset) { reports = []; reportCursor = '' }
  const query = { student_id: form?.targetStudentId || undefined, enrollment_id: form?.targetEnrollmentId || undefined, summary: 'true', limit: 50, search: $('report-search').value.trim() || undefined, course_id: $('report-course').value || form?.targetCourseId || undefined, date_from: $('report-date-from').value || undefined, date_to: $('report-date-to').value || undefined, cursor: reportCursor || undefined }
  const page = await api('reports', undefined, { query })
  if (requestGeneration !== activeReadGeneration) return
  reports.push(...page.reports || []); reportCursor = page.next_cursor || ''
  $('more-reports').hidden = !reportCursor; renderReports()
}
function renderReports() {
  $('reports').replaceChildren(); const query = $('report-search').value.toLowerCase()
  reports.filter(r => `${r.student_name} ${r.course_name} ${r.occurrence_date}`.toLowerCase().includes(query)).forEach(r => {
    const label = node('label', undefined, 'report-choice'), radio = node('input'); radio.type = 'radio'; radio.name = 'report'; radio.value = r.id; radio.checked = report?.id === r.id
    label.append(radio, node('span', ` ${r.student_name} · ${r.occurrence_date} · ${r.course_name || '課程'}`), node('small', `${r.completeness?.isMissing ? '未齊備' : '已齊備'} · 課程${r.is_completed ? '已完成' : '未完成'} · 更新 ${new Date(r.updated_at).toLocaleString()}`))
    radio.addEventListener('change', () => { report = r; $('field-review').hidden = true }); $('reports').append(label)
  })
  if (!$('reports').childElementCount) $('reports').append(node('p', '沒有符合條件的可讀取報告。'))
}
async function compare() {
  if (!report || !$('target-confirm').checked || !$('target-date').value) throw new Error('請確認目標學生與完整日期，並選擇一份報告。')
  if (!report.full) { const full = (await api('reports', undefined, { query: { id: report.id } })).reports[0]; if (!full) throw new Error('找不到所選報告，請重新載入摘要。'); report = { ...full, full: true } }
  if (report.occurrence_date !== $('target-date').value) throw new Error('EduLog 報告日期與原站課次不一致，請重新選擇。')
  const current = await source('form'); if (current.fingerprint !== form.fingerprint) throw new Error('原站內容已变更，請重新讀取表單。')
  fieldRules=[];if(integrationCapabilities.field_mapping_memory&&form.targetCourseId){const result=await api('field-resolve',{source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',items:form.fields.filter(f=>f.type!=='text'&&f.key!=='learning_status').map(f=>({field_key:f.key,...(f.key==='lesson_id'?{course_id:form.targetCourseId}:{}),options_signature:globalThis.edulogFieldMappings.signature(f)}))});fieldRules=result.items||[]}
  $('fields').replaceChildren()
  $('report-completeness').textContent = `${report.student_name} · ${report.occurrence_date} · ${report.completeness?.isMissing ? '未齊備：缺漏欄位請人工補齊' : '已齊備'}；課程${report.is_completed ? '已完成' : '未完成'}。`
  for (const field of form.fields) {
    const card = node('div', undefined, 'field'); card.dataset.key = field.key
    const label = node('label', undefined, 'check'), check = node('input'); check.type = 'checkbox'; check.dataset.include = ''; check.disabled = field.disabled
    const suggested = suggestedValue(field, report,fieldRules),consistent=globalThis.edulogFieldMappings.equal(field,report,fieldRules)
    check.disabled=field.disabled||consistent
    check.checked = !field.internal && !field.value && Boolean(suggested) && !field.disabled; label.append(check, node('span', `套用${field.label}${field.internal ? '（給內部看的）' : ''}`)); card.append(label)
    card.append(node('p', `原站目前：${field.options.find(o => o.value === field.value)?.label || field.value || '空白'}`, 'hint'))
    const lesson = context.lessons.find(l => l.id === report.lesson_id)
    const original=globalThis.edulogFieldMappings.display(field,{...report,lesson_name:report.lesson_name||lesson?.title,lesson_sequence:report.lesson_sequence??lesson?.sequence})
    card.append(node('p', `EduLog：${original}`, 'hint'))
    const input = node(field.type === 'text' ? 'textarea' : 'select'); input.id = `field-${field.key}`; input.dataset.value = ''; input.disabled = field.disabled
    if (field.type !== 'text') { input.append(new Option('請人工確認選項', '')); field.options.filter(o => !o.disabled && o.value).forEach(o => input.append(new Option(o.label || o.value, o.value))) }
    input.value = field.type === 'text' ? plainText(suggested) : suggested
    const valueLabel = node('label', `確認${field.label}值`); valueLabel.htmlFor = input.id; card.append(valueLabel, input)
    if (!suggested && field.type !== 'text') card.append(node('p', '未建立可靠選項對應。請依 EduLog 報告人工選擇原站選項。', 'hint'))
    if(consistent)card.append(node('p','內容一致，保留原站；不需覆寫。','field-mapping-status'))
    if (field.value&&!consistent) { const overwriteLabel = node('label', undefined, 'check'), overwrite = node('input'); overwrite.type = 'checkbox'; overwrite.dataset.overwrite = ''; overwriteLabel.append(overwrite, node('span', '我確認覆寫此欄原站內容')); card.append(overwriteLabel) }
    const selectedReport=report,selectedWork=work;globalThis.edulogFieldMappingUI.attach(card,field,report,fieldRules,{enabled:integrationCapabilities.field_mapping_memory&&Boolean(form.targetCourseId),sourceValue:input.value,lessons:context.lessons,confirm:item=>api('field-confirm',{source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',items:[{...item,...(field.key==='lesson_id'?{course_id:form.targetCourseId}:{})}]}),isCurrent:()=>report===selectedReport&&work===selectedWork,changed:()=>{if(!check.checked)input.value=suggestedValue(field,report,fieldRules)}});
    $('fields').append(card)
  }
  show('field-review'); stage('prefill', 'prefill'); notice('請逐欄核對，未勾選的欄位會保留原站內容。')
}
async function prefill() {
  const latest = (await api('reports', undefined, { query: { id: report.id } })).reports[0]
  if (!latest || latest.version !== report.version) throw new Error('EduLog 報告已變更，請重新選擇報告。')
  const fields = [...$('fields').children].filter(card => card.querySelector('[data-include]').checked).map(card => ({ key: card.dataset.key, value: card.querySelector('[data-value]').value, overwrite: card.querySelector('[data-overwrite]')?.checked === true, includeInternal: card.dataset.key === 'class_notes' }))
  if (!fields.length) throw new Error('請至少選擇一個要套用的已驗證欄位。')
  if (!$('target-confirm').checked || $('target-date').value !== report.occurrence_date) throw new Error('目標確認已變更。')
  work.report = { id: report.id, version: report.version }; work.status = 'applying'; work.prefill = { ...form, fields }; await save()
  const result = await source('apply', { workId: work.id, input: { formId: form.formId, reportId: form.reportId, fingerprint: form.fingerprint, fields } })
  work.status = 'pending_confirmation'; work.push = { report_id: report.id, report_version: report.version, source_origin: 'https://corp.orangeapple.co', source_report_url: form.sourceReportUrl, source_id: form.reportId, target_fingerprint: result.target.fingerprint, idempotency_key: work.id }; await save()
  show('prefill-result'); $('field-review').hidden = true; stage('prefill', 'return-source')
  try { await api('map', { source_origin: 'https://corp.orangeapple.co', source_kind: 'report', source_id: form.reportId, target_id: report.id }); await api('push', work.push); work.pushRecorded = true; await save() }
  catch (error) { notice(`已預填，但待確認紀錄尚未回寫：${error.message}。可在工作紀錄重試；不會重填表單。`, true); return }
  notice(`已套用 ${result.applied} 個欄位，未送出表單。請返回網站檢查。`)
}
async function saveWorkMetadata(row, changes = {}) {
  if (!integrationCapabilities.work_record_metadata || !row?.id) return null
  const path=row.sourcePath||row.form?.sourcePath
  const classId=row.snapshot?.classId||row.sourceClassId||row.form?.admissionId||(/^\/courses\/dt\/(\d+)$/.exec(path||'')?.[1])
  if(!path||!classId)return null
  const prior=workHistory.metadata.find(item=>item.work_id===row.id)
  const base={source_origin:'https://corp.orangeapple.co',source_path:path,source_class_id:String(classId),source_label:row.sourceTitle||row.snapshot?.title||'',target_classroom_id:row.destination?.classroom_id||null,target_class_session_id:row.destination?.class_session_id||null,target_label:row.destination?.targetLabel||[context?.classrooms?.find(item=>item.id===row.destination?.classroom_id)?.name,context?.class_sessions?.find(item=>item.id===row.destination?.class_session_id)?.name].filter(Boolean).join(' · '),title:row.title||'',source_device:'此瀏覽器',...changes,...(changes.server_job_id&&row.submissionRoundNo?{submission_round:row.submissionRoundNo}:{})}
  const result=await api('work-record-save',{expected_revision:prior?.revision||null,changes:base},{workId:row.id})
  const saved=result?.item;if(saved){workHistory.metadata=[...workHistory.metadata.filter(item=>item.work_id!==saved.work_id),saved];renderWorkRecords()}
  return saved
}
async function loadWork() {
  const tasks=[send({type:'workspace-store',action:'list'}),api('work')]
  if(integrationCapabilities.work_record_metadata)tasks.push((async()=>{let cursor,items=[];do{const page=await api('work-records',undefined,{query:{limit:50,cursor}});items.push(...page.items||[]);cursor=page.next_cursor}while(cursor);return items})())
  const [localResult,remoteResult,metadataResult]=await Promise.allSettled(tasks)
  workHistory={local:localResult.status==='fulfilled'?localResult.value:null,remote:remoteResult.status==='fulfilled'?remoteResult.value:null,metadata:metadataResult?.status==='fulfilled'?metadataResult.value:[]}
  workHistory.metadataError=metadataResult&&metadataResult.status==='rejected'?metadataResult.reason:null
  renderWorkRecords()
  const requested=params.get('work')||location.hash.match(/^#work=([a-f0-9-]{36})$/i)?.[1]
  if(requested){const row=combineWorkRecords(workHistory.local||[],workHistory.remote||{},workHistory.metadata).find(item=>item.local?.id===requested||item.metadata?.work_id===requested);if(row)selectWorkRecord(row)}
}
const workStatusText=status=>({applying:'寫入中',paused:'已暫停',failed:'需要處理',outcome_unknown:'結果待核對',complete:'已完成',partial_complete:'部分完成',cancelled:'剩餘工作已取消',collected:'已讀取，待核對',collecting:'正在讀取', 'paused-extraction':'擷取已暫停',reviewing:'待檢查',previewed:'摘要待確認',pending_confirmation:'待確認原站結果',confirmed:'已確認',pending:'待處理'})[status]||'狀態待確認'
function recordLabel(item){return item.metadata?.title||item.local?.title||item.remote?.title||item.remote?.source_class_id&&`來源班級 ${item.remote.source_class_id}`||item.push&&`報告 ${String(item.push.report_id||item.push.id).slice(0,8)}`||item.local?.id||item.remote?.id||item.metadata?.work_id||'工作紀錄'}
function recordClass(item){return item.metadata?.source_label||item.local?.sourceTitle||item.local?.snapshotSummary?.title||item.local?.snapshotSummary?.classId||item.local?.snapshot?.title||item.local?.snapshot?.classId||item.remote?.source_class_id||item.metadata?.source_class_id||''}
const workArchived=item=>Boolean(item.metadata?.archived_at||item.local?.archived_at)
const workPinned=item=>Boolean(item.metadata?.pinned??item.local?.pinned)
function selectWorkRecord(item){
  selectedWorkRecord=item;renderWorkRecords()
  const request=++selectedWorkLoad
  const summary=item?.local
  if(!summary?.__summary)return
  const id=summary.id
  void send({type:'workspace-store',action:'get',id}).then(full=>{
    if(request!==selectedWorkLoad||selectedWorkRecord?.local?.id!==id)return
    if(!full)throw new Error(globalThis.edulogUi?.locale==='en'?'This local draft expired or could not be read. Reread the source to start a new work.':'此本機草稿已到期或無法讀取；可重新讀取來源建立新工作。')
    workDetailCache.set(id,full)
    selectedWorkRecord={...selectedWorkRecord,local:full};renderWorkRecords()
  }).catch(error=>{
    if(request!==selectedWorkLoad||selectedWorkRecord?.local?.id!==id)return
    selectedWorkRecord={...selectedWorkRecord,local:{...summary,__summary:false,loadError:error.message}};renderWorkRecords()
  })
}
function renderWorkRecords() {
  const {local,remote,metadata=[]}=workHistory,combined=combineWorkRecords(local||[],remote||{},metadata),filter=$('work-filter').value||'all',type=$('work-type-filter').value||'all',query=$('work-search').value.trim().toLocaleLowerCase(),classQuery=$('work-class-filter').value.trim().toLocaleLowerCase()
  const selectedId=selectedWorkRecord?.local?.id||selectedWorkRecord?.metadata?.work_id||selectedWorkRecord?.remote?.id||selectedWorkRecord?.push?.id
  if(selectedId){const current=combined.find(item=>(item.local?.id||item.metadata?.work_id||item.remote?.id||item.push?.id)===selectedId);const cached=current?.local?.__summary&&workDetailCache.get(current.local.id);selectedWorkRecord=current&&cached?{...current,local:cached}:current||null}
  const all=combined.filter(item=>{const row=item.local||item.remote||item.push||{},status=item.category,labels=`${recordLabel(item)} ${recordClass(item)} ${row.id||''} ${row.status||''}`.toLocaleLowerCase();return(filter==='all'||status===filter)&&(type==='all'||(item.local?.type||'import')===type)&&(!query||labels.includes(query))&&(!classQuery||String(recordClass(item)).toLocaleLowerCase().includes(classQuery))})
  const active=all.filter(item=>!workArchived(item)).sort((a,b)=>Number(Boolean((b.local?.id||b.metadata?.work_id)===work?.id))-Number(Boolean((a.local?.id||a.metadata?.work_id)===work?.id))||Number(workPinned(b))-Number(workPinned(a))||({attention:0,resumable:1,done:2}[a.category]-{attention:0,resumable:1,done:2}[b.category])||((b.local?.updatedAt||Date.parse(b.metadata?.updated_at)||0)-(a.local?.updatedAt||Date.parse(a.metadata?.updated_at)||0)))
  const completed=active.filter(item=>item.category==='done'),visibleActive=active.filter(item=>item.category!=='done')
  const archived=all.filter(workArchived)
  $('work-count').textContent=`顯示 ${active.length} 筆工作；封存 ${archived.length} 筆。狀態依實際檢查點與交易結果計算。`
  const host=$('work-list');host.replaceChildren()
  if(local===null){const error=node('article',undefined,'card');error.append(node('h2','本機工作暫時無法讀取'),node('p','工作資料庫讀取失敗；目前伺服器紀錄仍保留。','hint'));const retry=node('button','重試讀取本機工作');retry.onclick=()=>void runLatest(loadWork,{label:'正在重試本機工作紀錄'});error.append(retry);host.append(error)}
  const groups=new Map();for(const item of visibleActive){const key=recordClass(item)||'來源班級未命名';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item)}
  for(const [groupLabel,items] of groups){const group=node('section',undefined,'work-group');const groupTitle=node('h2',groupLabel);groupTitle.dataset.sourceRaw='';group.append(groupTitle);for(const item of items){const row=item.local||item.remote||item.push||{},article=node('article',undefined,'work-record');article.dataset.workId=item.local?.id||item.metadata?.work_id||item.remote?.id||item.push?.id||'';if(selectedWorkRecord&&(selectedWorkRecord.local?.id||selectedWorkRecord.metadata?.work_id)===article.dataset.workId)article.setAttribute('aria-current','true');const main=node('div');const title=node('button',recordLabel(item),'work-record-title');title.dataset.sourceRaw='';title.type='button';title.addEventListener('click',()=>selectWorkRecord(item));main.append(title);main.append(node('p',`${item.local?.type==='prefill'?'報告預填':'教學資料同步'} · ${workStatusText(row.status)}`,'work-record-meta'));const time=row.updatedAt||item.metadata?.updated_at;if(time)main.append(node('p',new Date(time).toLocaleString(globalThis.edulogUi?.locale||'zh-TW'),'work-record-meta'));if(item.local?.expiresAt)main.append(node('p','本機草稿期限：'+new Date(item.local.expiresAt).toLocaleDateString(globalThis.edulogUi?.locale||'zh-TW'),'work-record-meta'));if(item.metadata?.source_device)main.append(node('p',`來源裝置：${item.metadata.source_device} · 草稿期限七天`,'work-record-meta'));const actions=node('div',undefined,'work-record-actions');const open=node('button',primaryWorkAction(item));open.type='button';open.onclick=()=>void run(()=>openWorkRecord(item),{label:'正在恢復所選工作'});actions.append(open);article.append(main,actions);group.append(article)}host.append(group)}
  if(!visibleActive.length&&!completed.length){const empty=node('p','沒有符合篩選條件的工作。','hint');host.append(empty)}
  if(completed.length){const details=node('details',undefined,'work-archived');details.open=filter==='done';details.append(node('summary',`已完成 · ${completed.length} 筆`));for(const item of completed){const entry=node('div',undefined,'work-record');const title=node('button',recordLabel(item),'work-record-title');title.dataset.sourceRaw='';title.onclick=()=>selectWorkRecord(item);const restore=node('button',workArchived(item)?'解除封存':'查看結果');restore.onclick=()=>workArchived(item)?void run(()=>updateWorkMetadata(item,{archived_at:null}),{label:'正在解除封存'}):selectWorkRecord(item);entry.append(title,restore);details.append(entry)}host.append(details)}
  if(archived.length){const details=node('details',undefined,'work-archived');details.append(node('summary',`已封存 · ${archived.length} 筆`));for(const item of archived){const entry=node('div',undefined,'work-record');const title=node('button',recordLabel(item),'work-record-title');title.dataset.sourceRaw='';title.onclick=()=>selectWorkRecord(item);const restore=node('button','解除封存');restore.onclick=()=>void run(()=>updateWorkMetadata(item,{archived_at:null}),{label:'正在解除封存'});entry.append(title,restore);details.append(entry)}host.append(details)}
  const remoteError=remote===null?node('article',undefined,'card'):null;if(remoteError){remoteError.append(node('h2','EduLog 工作紀錄暫時無法載入'),node('p','本機續傳資料仍可查看；重新整理伺服器紀錄不會改變已提交資料。','hint'));const retry=node('button','重試載入伺服器紀錄');retry.onclick=()=>void runLatest(loadWork,{label:'正在重試 EduLog 工作紀錄'});remoteError.append(retry);host.append(remoteError)}
  if(workHistory.metadataError){const error=node('p','跨裝置工作整理讀取失敗；已載入的本機與伺服器紀錄仍可使用。','hint');host.append(error)}
  $('work-view').dataset.detailOpen=selectedWorkRecord?'true':'false'
  if(selectedWorkRecord)renderWorkDetail(selectedWorkRecord)
}
function primaryWorkAction(item){const row=item.local||item.remote||{};if(['outcome_unknown','applying'].includes(row.status))return '核對未知結果';if(row.status==='partial_complete')return '處理剩餘項目';if(['complete','confirmed','cancelled'].includes(row.status))return '查看結果';if(item.local?.snapshot||item.local?.batches||item.local?.hasSnapshot||item.local?.hasBatches)return '繼續核對';if(item.local?.type==='prefill')return '查看預填結果';return '查看工作詳情'}
async function updateWorkMetadata(item,changes){
  if(item.local?.__summary){const full=await send({type:'workspace-store',action:'get',id:item.local.id});if(!full)throw new Error('此本機草稿已到期或無法讀取，無法保存工作整理設定。');item.local=full}
  if(!integrationCapabilities.work_record_metadata){
    if(item.local){Object.assign(item.local,changes);await send({type:'workspace-store',action:'put',work:item.local});workDetailCache.set(item.local.id,item.local);notice('跨裝置整理功能目前不可用；設定只保存於本機工作。',true);await loadWork()}
    return
  }
  let meta=item.metadata
  if(!meta&&item.local){meta=await saveWorkMetadata(item.local,changes);if(meta)item.metadata=meta}
  if(!meta){notice('此工作缺少可驗證的來源識別，無法保存整理設定。',true);return}
  const result=await api('work-record-save',{expected_revision:meta.revision,changes},{workId:meta.work_id})
  const saved=result?.item
  if(!saved)return
  workHistory.metadata=workHistory.metadata.map(value=>value.work_id===saved.work_id?saved:value)
  item.metadata=saved
  if(item.local){Object.assign(item.local,changes);await send({type:'workspace-store',action:'put',work:item.local});workDetailCache.set(item.local.id,item.local)}
  renderWorkRecords()
}
async function flushWorkBeforeSwitch(nextId){
  const current=work
  if(!current||current.id===nextId)return
  await saveChain
  if(unsaved&&unsavedWorkId===current.id&&!await save())throw new Error('目前工作草稿尚未保存；已保留畫面，請重試保存後再切換。')
}
async function setSourceForWork(row){
  const expected=row.snapshot?.classId||row.sourceClassId
  let candidate=tabs.find(tab=>tab.id===row.sourceTab&&tab.path===row.sourcePath)
  if(!candidate){const matches=tabs.filter(tab=>tab.path===row.sourcePath);if(matches.length===1)candidate=matches[0];else if(matches.length>1){const verified=[];for(const tab of matches){try{const c=await send({type:'workspace-source',action:'context',tabId:tab.id,sourcePath:tab.path});if(!expected||String(c.classId)===String(expected))verified.push(tab)}catch{}}if(verified.length===1)candidate=verified[0];else throw new Error(verified.length?'找到多個相同班級的來源分頁；請在清單選擇要使用的來源。':'目前開啟的來源頁與原工作班級不符。')}}
  if(!candidate){candidate=await send({type:'workspace-open-source',sourcePath:row.sourcePath});tabs.push(candidate)}
  if(![...$('source-tab').options].some(option=>option.value===String(candidate.id)))$('source-tab').add(new Option((candidate.title||'來源分頁')+' · '+candidate.path,candidate.id))
  const switching=work?.id!==row.id
  if(switching){generation++;historyCheckSequence++;historyLocalSequence++;previewResults=[]}
  $('source-tab').value=String(candidate.id);selectedPath=candidate.path
  const c=await source('context')
  if(expected&&String(c.classId)!==String(expected))throw new Error('來源班級與原工作不符；請檢查新開啟的來源頁面。')
  if(row.type==='import'&&!c.classId)throw new Error('原來源班級目前無法讀取；請重新開啟原班級頁後重試，工作草稿仍已保留。')
  if(switching){historyPlan=[];historyArchives.clear();historyRoutes.clear()}
  sourceContext=c;classSourceReady=Boolean(c.classId);reportSourceReady=Boolean(c.reportOpen)
  $('source-label').textContent=[c.sourceOrigin||'https://corp.orangeapple.co',c.title||candidate.title||candidate.path,c.sourcePath||candidate.path].join(' · ')
  $('collect').disabled=!classSourceReady;$('read-form').disabled=!reportSourceReady
  return candidate
}
async function restoreImportWork(row){
  await flushWorkBeforeSwitch(row.id)
  await setSourceForWork(row)
  work=row;activeWorks.import=work
  const serverRounds=workHistory.metadata.find(item=>item.work_id===work.id)?.submission_rounds||[]
  work.submissionRounds ||= serverRounds.map(round=>({roundNo:round.round_no,jobId:round.job_id,status:round.status,done:round.applied_batches||0,batchCount:round.batch_count||0,appliedBatchKeys:[],batchSummaries:{}}))
  work.submissionRoundNo=Math.max(Number(work.submissionRoundNo)||1,...serverRounds.map(round=>round.round_no||0))
  $('include-internal-notes').checked=work.includeInternalNotes===true
  $('continue-work').hidden=true;flow('import');activeStages.import=2
  if(work.history&&work.history.next<work.history.paths.length)await collectHistory()
  if(!work.batches?.length){work.previewDirty=true;previewResults=[];$('apply').disabled=true;$('preview-section').hidden=true}
  await save();await mappingView();renderHistoryIssues()
  if(work.batches?.length&&work.jobId)await resumeImport()
  else if(work.batches?.length){work.previewDirty=true;work.previewError={code:'MISSING_JOB_CHECKPOINT',message:'批次缺少伺服器工作識別，請更新差異後再核對。'};$('apply').disabled=true;notice('已恢復草稿，但找不到原伺服器檢查點。請更新差異重新核對；不會直接寫入。',true)}
  else if(work.history&&work.history.next>=work.history.paths.length)stage('import','preview')
}
async function openWorkRecord(item){
  let row=item.local
  if(!row){renderWorkDetail(item);return}
  if(row.__summary){row=await send({type:'workspace-store',action:'get',id:row.id});if(!row)throw new Error(globalThis.edulogUi?.locale==='en'?'This local draft expired or could not be read. Reread the source to start a new work.':'此本機草稿已到期或無法讀取；可重新讀取來源建立新工作。')}
  if(row.type==='import'){await restoreImportWork(row);return}
  if(row.type==='prefill'){await flushWorkBeforeSwitch(row.id);await setSourceForWork(row);work=row;activeWorks.prefill=work;flow('prefill');notice('已恢復預填工作。請重新讀取原生表單並核對，不會自動套用。')}
}
async function repeatWork(row){await setSourceForWork(row);$('date-from').value=row.dateFrom||$('date-from').value;$('date-to').value=row.dateTo||$('date-to').value;$('all-history').checked=row.dateFrom==='1900-01-01'&&row.dateTo==='9999-12-31';work=null;activeWorks.import=null;continuation=null;flow('import');await collect();notice('已建立新工作；身份對應與欄位偏好會重新驗證，逐筆覆寫及略過選擇不會沿用。')}
function renderWorkDetail(item){
  const detail=$('work-detail'),row=item.local||item.remote||{},locale=globalThis.edulogUi?.locale||'zh-TW'
  detail.replaceChildren()
  const back=node('button','返回工作清單');back.id='work-detail-back';back.type='button';back.onclick=()=>{selectedWorkLoad++;selectedWorkRecord=null;renderWorkRecords()};detail.append(back)
  const title=node('h2',recordLabel(item));title.dataset.sourceRaw='';detail.append(title)
  const sourceName=node('p',recordClass(item)||'來源班級未命名','hint');sourceName.dataset.sourceRaw='';detail.append(sourceName)
  detail.append(node('p',`${item.local?.type==='prefill'?'報告預填':'教學資料同步'} · 狀態：${workStatusText(row.status||item.category)}`))
  if(row.done!=null)detail.append(node('p',`已完成 ${row.done}/${row.batchCount||row.batches?.length||0} 批`))
  if(item.metadata?.target_label)detail.append(node('p',`目標 EduLog：${item.metadata.target_label}`,'hint'))
  if(row.expiresAt)detail.append(node('p',`本機草稿期限：${new Date(row.expiresAt).toLocaleString(locale)}`,'hint'))
  if(item.local?.__summary)detail.append(node('p',globalThis.edulogUi?.t('work.loadingFullDraft')||'正在載入此工作的完整本機草稿…','hint'))
  if(item.local?.loadError)detail.append(node('p',globalThis.edulogUi?.t('work.fullDraftLoadFailed',{message:item.local.loadError})||`完整草稿讀取失敗：${item.local.loadError}`,'notice error'))
  if(item.local?.metadataSyncError)detail.append(node('p','跨裝置整理尚未保存；可重新整理後再試。','notice warning'))
  if(item.remote)appendRemoteWork(detail,item.remote,item.local)
  if(item.local){
    const local=row,remaining=Math.max(0,(local.history?.paths?.length||0)-(local.history?.next||0)),summary=node('section',undefined,'work-detail-summary')
    summary.append(node('h3','工作進度'))
    if(local.type==='import')summary.append(node('p',`來源資料 ${local.snapshot?.records?.length||0} 列 · 歷史待讀取 ${remaining} 份`))
    if(local.batches?.length){summary.append(node('p',`批次 ${local.done||0}/${local.batches.length} · 已寫入 ${local.applied||local.result?.applied||0} · 略過 ${local.skipped||0} · 失敗 ${local.failed||0}`));const list=node('ul');for(const batch of local.batches)list.append(node('li',`${String(batch.key||batch.id||'批次').slice(0,12)} · ${batch.status||'待處理'} · ${batch.applied||0} 筆`));summary.append(list)}
    const checks=local.rosterChecks||[];if(local.rosterVerification||checks.length){summary.append(node('h3','名單核對'));for(const check of [local.rosterVerification,...checks].filter(Boolean)){const date=check.date||check.roster_date||'日期未提供';summary.append(node('p',`${date} · EduLog ${check.edulog_count??check.target_count??'—'} 人 · 來源 ${check.source_count??'—'} 人${check.missing_count!=null?` · 缺少 ${check.missing_count}`:''}${check.extra_count!=null?` · 其他 ${check.extra_count}`:''}`))}}
    if(remaining)summary.append(node('p',`仍有 ${remaining} 份歷史資料待讀取或處理。`,'notice warning'))
    detail.append(summary)
  }
  if(item.local?.error){const error=node('section',undefined,'notice error');error.append(node('h3','最近一次操作失敗'),node('p',item.local.error.message||'請重試此工作的讀取。'));const retry=node('button','重試此工作讀取');retry.onclick=()=>void run(()=>openWorkRecord(item),{label:'正在重試此工作'});error.append(retry);detail.append(error)}
  const actions=node('div',undefined,'work-detail-actions'),pin=node('button',workPinned(item)?'取消置頂':'置頂');pin.onclick=()=>void run(()=>updateWorkMetadata(item,{pinned:!workPinned(item)}),{label:'正在保存置頂設定'});actions.append(pin)
  const rename=node('button','重新命名');rename.onclick=()=>{const label=node('label','工作名稱'),input=node('input');input.value=recordLabel(item);input.maxLength=100;input.setAttribute('aria-label','工作名稱');const saveName=node('button','保存名稱');saveName.onclick=()=>void run(()=>updateWorkMetadata(item,{title:input.value.trim()}),{label:'正在保存工作名稱'});label.append(input);actions.append(label,saveName);input.focus()};actions.append(rename)
  if(item.metadata||item.local){const archive=node('button',workArchived(item)?'解除封存':'封存工作');archive.onclick=()=>void run(()=>updateWorkMetadata(item,{archived_at:workArchived(item)?null:new Date().toISOString()}),{label:'正在保存封存設定'});actions.append(archive)}
  if(item.local&&['complete','cancelled','partial_complete'].includes(item.local.status)){const again=node('button','再次同步');again.onclick=()=>void run(()=>repeatWork(item.local),{label:'正在建立新的同步工作'});actions.append(again)}
  if(item.local){const remove=node('button','移除此裝置草稿');remove.onclick=()=>{const prompt=node('section',undefined,'notice warning');prompt.append(node('p','只會移除此瀏覽器的草稿。EduLog 已保存結果與其他裝置上的草稿不會刪除。'));const yes=node('button','確認移除本機草稿'),no=node('button','保留草稿');yes.onclick=()=>void run(async()=>{await send({type:'workspace-store',action:'delete',id:item.local.id});if(selectedWorkRecord?.local?.id===item.local.id)selectedWorkRecord=null;await loadWork()},{label:'正在移除本機工作草稿'});no.onclick=()=>prompt.remove();prompt.append(yes,no);detail.append(prompt)};actions.append(remove)}
  detail.append(actions)
}
function appendRemoteWork(item,r,local) {
  const statusText=status=>({queued:'排隊中',collecting:'擷取中',previewed:'待確認差異',applying:'匯入中',paused:'已暫停',failed:'部分失敗',outcome_unknown:'結果尚未確認',partial_complete:'部分完成，尚有待處理項目',complete:'已完成',cancelled:'已取消剩餘批次',pending_confirmation:'待人工確認',confirmed:'已確認'})[status]||'狀態待確認'
  item.append(node('p',`來源班級 ${r.source_class_id||'—'} · ${statusText(r.status)} · 批次內已處理 ${r.counts?.applied||0} 筆`))
  const label=node('label','名單核對日期'),date=node('input');date.type='date';date.value=local?.rosterVerification?.date||local?.rosterChecks?.[0]?.date||'';label.append(date);item.append(label)
  const inspect=node('button','查詢批次與有效名單');inspect.type='button';inspect.addEventListener('click',()=>void runLatest(async()=>{
    if(!date.value||!date.checkValidity())return date.reportValidity()
    const info=await api('import-info',undefined,{jobId:r.id,query:{roster_date:date.value}}),roster=info.roster?.enrollments||[]
    if(!item.isConnected)return
    item.querySelector('[data-work-inspection]')?.remove()
    const panel=node('div',undefined,'hint');panel.dataset.workInspection='';panel.append(node('p',`伺服器狀態：${statusText(info.job?.status)} · ${info.batches?.length||0} 個批次 · 核對日期 ${info.roster_date}`),node('p',`有效名單：${roster.length} 筆。批次筆數是已處理資料列，不代表名單或報告筆數。`))
    for(const batch of info.batches||[])panel.append(node('p',`批次 ${batch.key.slice(0,8)} · ${batch.status==='applied'?'已提交':'尚未提交'} · ${batch.applied} 筆`))
    item.append(panel);notice('已讀取伺服器批次檢查點與目標班級有效名單。')
  },{label:'正在核對伺服器批次與班級名單'}));item.append(inspect)
}
$('archive-completed').addEventListener('click',()=>void run(async()=>{
  const completed=combineWorkRecords(workHistory.local||[],workHistory.remote||{},workHistory.metadata||[]).filter(item=>item.category==='done'&&!workArchived(item))
  const eligible=completed.filter(item=>item.metadata||item.local?.sourcePath)
  if(!eligible.length){notice('目前沒有可封存的已完成工作。',true);return}
  for(const item of eligible)await updateWorkMetadata(item,{archived_at:new Date().toISOString()})
  notice(`已封存 ${eligible.length} 筆已完成工作。`);await loadWork()
},{label:'正在封存已完成工作'}))
$('work-filter').addEventListener('change',renderWorkRecords)
$('work-type-filter').addEventListener('change',renderWorkRecords)
$('work-search').addEventListener('input',renderWorkRecords)
$('work-class-filter').addEventListener('input',renderWorkRecords)


document.querySelectorAll('[data-flow]').forEach(b => b.addEventListener('click', async () => {if(busy&&!activeReadId)return;if(activeReadId){await cancelRead(false);await readFinished}flow(b.dataset.flow)}))
$('source-tab').addEventListener('change', () => void runLatest(changeSource, { label: '正在讀取來源班級' }))
$('back-to-read').addEventListener('click',()=>{if(busy)return;stage('import','collect');if(work)void save().catch(error=>notice(error.message,true))})
$('back-to-review').addEventListener('click',()=>{if(busy)return;stage('import','preview');if(work)void save().catch(error=>notice(error.message,true))})
$('return-source-import').addEventListener('click',()=>void run(async()=>{await send({type:'workspace-return',tabId:work?.sourceTab||Number($('source-tab').value),sourcePath:work?.sourcePath||selectedPath});notice('已開啟來源分頁。')}))
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message?.type!=='workspace-focus')return
  void(async()=>{
    if(message.binding?.instance!==binding?.instance||message.binding?.userId!==binding?.userId)throw new Error('目前工作台連線與要求的帳號不同，請重新開啟工作台。')
    if(busy)throw new Error('目前操作正在進行；完成或取消後再切換工作。')
    if(unsaved&&work)await save()
    if(message.sourceTab){const refreshed=await send({type:'workspace-init'});tabs=refreshed.tabs||[];const sourceTab=tabs.find(tab=>tab.id===message.sourceTab.id&&tab.path===message.sourceTab.path);if(!sourceTab)throw new Error('來源分頁已關閉或網址已變更，請重新開啟來源頁面。');$('source-tab').value=String(sourceTab.id);await changeSource()}
    flow(message.flow==='prefill'?'prefill':message.flow==='work'?'work':'import')
    return{ok:true}
  })().then(respond,error=>respond({ok:false,error:{message:error.message||'無法切換工作台。'}}))
  return true
})
$('classroom-search').addEventListener('input', () => { clearTimeout(mappingSearchTimer); mappingSearchTimer = setTimeout(() => void runLatest(() => loadClassrooms(true), { label: '正在搜尋目標教室' }), 300) })
$('more-classrooms').addEventListener('click', () => void runLatest(() => loadClassrooms(false), { label: '正在載入更多教室候選' }))
$('mapping-course-search').addEventListener('input', () => { clearTimeout(mappingSearchTimer); mappingSearchTimer = setTimeout(() => void runLatest(() => loadMappingCourses(true), { label: '正在搜尋目標課程' }), 300) })
$('more-mapping-courses').addEventListener('click', () => void runLatest(() => loadMappingCourses(false), { label: '正在載入更多課程候選' }))
$('classroom').addEventListener('change', () => void runLatest(async () => { await updateDestinations(); await loadScopedMappingData(); updateMappingOptions() }, { label: '正在查詢教室與課程候選' }))
$('course').addEventListener('change', () => void runLatest(async () => { await updateDestinations(); await loadScopedMappingData(); updateMappingOptions() }, { label: '正在查詢班級候選' }))
$('class-session').addEventListener('change', () => void runLatest(async () => { $('new-session').hidden = $('class-session').value !== 'new'; await loadScopedMappingData(); updateMappingOptions() }, { label: '正在查詢學生報名與課次' }))
$('course-source-id').addEventListener('change', updateMappingOptions)
$('start-new-work').onclick=()=>{continuation=null;$('continue-work').hidden=true;work=null;activeWorks.import=null;activeStages.import=1;flow('import');$('collect').disabled=!classSourceReady;taskStatus()}
$('resume-source-work').onclick=()=>void run(async()=>{const row=continuation;if(!row)return;await restoreImportWork(row)},{label:'正在恢復未完成工作'})
for (const [id, action] of Object.entries({ collect, preview: () => preview(), repreview: () => preview(work.continuationMode?false:!work.mappingDirty), apply, resume: resumeImport, 'read-form': readForm, compare, prefill, 'refresh-work': loadWork, reconnect: initialize })) $(id).addEventListener('click', () => void run(action, { label: ({ collect:'正在讀取來源班級與學習紀錄', preview:'正在比對 EduLog 目標與匯入差異', repreview:'正在重新檢查資料差異', apply:'正在寫入匯入批次', resume:'正在檢查未完成批次', 'read-form':'正在讀取原站報告目標', compare:'正在查詢報告欄位並核對目標', prefill:'正在套用已確認欄位至原站', 'refresh-work':'正在更新工作紀錄', reconnect:'正在重新驗證連線' })[id] || '正在處理工作', readOnly: ['collect','read-form','compare','refresh-work','reconnect'].includes(id) }))
$('retry-history-save').addEventListener('click',()=>void run(async()=>{const owner=work;if(!owner)return;await save();if(owner!==work)return;if(owner.jobId){await preview(true);return}if(owner.history)await collectHistory();await mappingView();renderHistoryIssues()},{label:'正在重試保存草稿並繼續核對',saveBeforeAction:false}))
$('cancel-read').addEventListener('click', () => void cancelRead())
$('pause').addEventListener('click', () => { paused = true; notice('正在完成目前批次，之後暫停。') })
$('cancel-work').addEventListener('click', () => { paused = true; cancelRequested = true; if (busy) { notice('正在完成目前批次，之後取消剩餘工作。'); return } void run(async () => { await api('job-status', { status: 'cancelled' }, { jobId: work.jobId }); work.status = 'cancelled'; await save(); progress(); notice('已取消剩餘工作；成功寫入的資料保留。') }) })
$('return-source').addEventListener('click', () => void run(async () => { await send({ type: 'workspace-return', tabId: Number($('source-tab').value), sourcePath: selectedPath }); notice('已開啟來源分頁。') }))
$('report-search').addEventListener('input', () => { clearTimeout(reportSearchTimer); reportSearchTimer = setTimeout(() => void runLatest(() => loadReportSummaries(true), { label: '正在依關鍵字查詢報告摘要' }), 300) })
$('report-course').addEventListener('change', () => void runLatest(() => loadReportSummaries(true), { label: '正在依課程篩選報告' }))
$('report-date-from').addEventListener('change', () => void runLatest(() => loadReportSummaries(true), { label: '正在依日期範圍查詢報告' }))
$('report-date-to').addEventListener('change', () => void runLatest(() => loadReportSummaries(true), { label: '正在依日期範圍查詢報告' }))
$('more-courses').addEventListener('click', () => void runLatest(() => loadReportCourses(), { label: '正在載入更多課程候選' }))
$('open-connection').addEventListener('click', () => void run(async () => { await bridge.call(() => chrome.action.openPopup()); notice('請在擴充套件視窗完成連線。') }))
$('more-reports').addEventListener('click', () => void runLatest(async () => { const before = reports.length; await loadReportSummaries(); notice(`已載入 ${reports.length - before} 份報告摘要。`) }, { label: '正在載入下一頁報告摘要' }))
const today = new Date(), yearAgo = new Date(today); yearAgo.setFullYear(today.getFullYear() - 1)
$('date-from').value = yearAgo.toISOString().slice(0, 10); $('date-to').value = today.toISOString().slice(0, 10)
$('all-history').addEventListener('change',()=>{for(const id of ['date-from','date-to'])$(id).disabled=$('all-history').checked})
$('include-internal-notes').addEventListener('change',()=>{if(!work)return;work.includeInternalNotes=$('include-internal-notes').checked;historyWorkChanged()})
$('check-history').addEventListener('click',()=>void runLatest(async()=>{const state=historyView.capture();await refreshHistoryPlan();historyView.refreshEditor(historyPlan,state)},{label:'正在重新核對完整歷史'}))
$('save-sync-preferences')?.addEventListener('click',()=>void run(saveSyncPreferences,{label:'正在保存同步欄位預設'}))
bridge.onInvalidated(() => { paused = true; ++generation; notice('擴充套件已更新，請重新開啟工作分頁；已保存檢查點可續傳。', true) })
document.querySelectorAll('input,select,textarea').forEach(input => { if (!input.name) input.name = input.id; input.autocomplete = 'off' })
document.addEventListener('input', event => {
  if (!work || !event.target.closest('#mapping')) return
  if (event.target.closest('#history-workbench')) return
  if (!event.target.closest('.mapping-row,.course-group')) return
  markMappingChanged()
})
document.addEventListener('change', event => {
  if (!work || !event.target.closest('#mapping') || event.target.closest('#history-workbench') || !event.target.closest('.mapping-row,.course-group')) return
  scheduleHistoryPlanForCurrentMapping()
})
window.addEventListener('beforeunload', event => { if (unsaved || busy) { event.preventDefault(); event.returnValue = '' } })
void run(async () => { try { await initialize() } catch (error) { show('connect'); $('workspace').hidden = true; throw error } }, { label: '正在驗證連線與檢查工作台能力', readOnly: true })
