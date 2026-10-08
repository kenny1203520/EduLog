import { readHistoryWork } from './history-reader.js'
import './field-mapping-ui.js'
import { createMappingController } from './mapping-controller.js'
import { mappedReport, attachImportFields } from './import-field-mappings.js'
import { historyIdentity, planHistory, teachingFields, bindingStillMatches } from './history-sync.js'
import { createHistoryWorkbench } from './history-workbench.js'
import { admissionIdentity, mergeRecords } from './mapping-core.js'
import { labels, splitBatches, validateBatches, workspaceErrorMessage, plainText, suggestedValue, retryHistoryWork } from './workspace-model.js'
import { workflowState, combineWorkRecords, workCategory } from './workflow-state.js'
import {comparison,decisionResult,semanticValue,outcomeMetrics} from './review-ui.js'
import { initWorkspaceI18n } from './workspace-i18n.js'
const bridge = globalThis.edulogRuntime, $ = id => document.getElementById(id)
initWorkspaceI18n()
let fieldRules=[]
const syncFields=[['lesson_id','教材'],['is_completed','完成狀況'],['progress_letter','章節進度'],['attendance_status','出席狀態'],['absence_reason','不出席原因'],['class_participation','課程參與'],['classroom_behavior','課堂秩序'],['content','學習報告'],['contact_notes','聯絡欄'],['class_notes','內部紀錄'],['external_link','報告連結']]
let syncPreferences={fields:{},revision:null},syncDraftOverrides={}
let frontendSettingsUrl = null
let integrationCapabilities = {}
let binding, context, tabs = [], work, form, reports = [], report, reportCursor = '', reportCourseCursor = '', classroomCursor = '', mappingCourseCursor = '', activeCourseRoom = '', studentCursors = {}, studentCandidates = {}, studentSearchTimers = {}, reportSearchTimer, mappingSearchTimer, busy = false, paused = false, cancelRequested = false, selectedPath = '', sourceContext = null, classSourceReady = false, reportSourceReady = false, generation = 0, previewResults = [], batchBytes = 180000, unsaved = false, editTimer, activeReadId = '', activeReadGeneration = 0, readFinished = Promise.resolve(), finishRead = () => {}
let activeFlow = 'import', continuation = null
const activeWorks = {import:null,prefill:null}, activeStages = {import:1,prefill:1}
function currentWorkflow(view) { const identity=work?.type==='import'&&work.snapshot?work.snapshot.records.filter(row=>row.kind==='enrollment'&&!row.sourceSkipped&&!mappingController.validateRow(row,true)).length:0;return workflowState(view,{work:work?.type===view?work:activeWorks[view],form,report,previewCount:previewResults.length,unresolved:identity+historyPlan.filter(item=>item.category==='needs').length}) }
function taskStatus() {
  const ui=globalThis.edulogUi;ui?.text($('draft-status'),unsaved?'work.unsaved':work?'work.saved':'work.ready')
  $('task-title').textContent=work?.title||sourceContext?.title||''
  $('task-status').textContent=work ? ({collected:'已讀取，待核對',collecting:'正在讀取',reviewing:'正在核對',previewed:'摘要待確認',applying:'正在寫入',paused:'已暫停',failed:'需要處理',outcome_unknown:'寫入結果待核對',partial_complete:'部分完成',complete:'已核驗完成',pending_confirmation:'待人工送出',cancelled:'已取消剩餘工作'})[work.status]||'草稿' : ''
  if(work&&ui&&ui.t('work.state.'+work.status)!=='work.state.'+work.status)ui.text($('task-status'),'work.state.'+work.status)
  else ui?.text($('task-status'),'diff.value',{value:work?.status||''})
}
const params = new URLSearchParams(location.search)
const fieldLabels = { report_date: '上課日期', source_fields: '允許的教學原文', source_evidence: '來源位置', identity_status: '來源身份', source_key: '來源紀錄識別', name: '名稱', subject: '科目', stage: '階段', display_name: '課程名稱', external_link: '原站連結', classroom_id: '教室', course_ids: '班級可上課程', student_id: '學生', course_id: '課程', class_session_id: '班級', enrollment_id: '報名', class_occurrence_id: '課次', start_date: '開始日期', day_of_week: '星期', start_time: '開始時間', end_time: '結束時間', original_start_time: '課次開始時間', original_end_time: '課次結束時間', occurrence_date: '課次日期', time_zone: '時區', status: '報名狀態', content: '學習表現', is_completed: '課程完成狀況', progress_letter: '章節進度', attendance_status: '出席', absence_reason: '缺席原因', lesson_id: '教材', class_participation: '課程參與', classroom_behavior: '課堂秩序', contact_notes: '聯絡欄', class_notes: '內部紀錄' }
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n }
function notice(message = '', error = false) { $('notice').textContent = message; $('notice').dataset.error = String(error) }
async function send(message) {
  const response = await bridge.send({ ...message, binding })
  if (response?.error) { const e = new Error(workspaceErrorMessage(response.error)); e.code = response.error.code; e.requestId = response.error.requestId; e.retryAfter = response.error.retryAfter; e.fields = response.error.fields; e.rawMessage = response.error.message; throw e }
  return response?.data
}
const api = (operation, body, extra = {}) => send({ type: 'workspace-api', operation, body, ...(['context','catalog','resolve','field-resolve','sync-preferences-get','reports','work','reconcile','import-info'].includes(operation) && activeReadId ? { requestId: activeReadId } : {}), ...extra })
const source = (action, extra = {}) => send({ type: 'workspace-source', action, tabId: Number($('source-tab').value), sourcePath: selectedPath, requestId: activeReadId || undefined, ...extra })
async function save() {
  const current = work
  if(!current)return
  unsaved=true;taskStatus()
  current.interfaceState={...(current.interfaceState||{}),stage:activeStages[current.type]||1}
  current.revision = (current.revision || 0) + 1
  const revision = current.revision
  const stored = await send({ type: 'workspace-store', action: 'put', work: current })
  if (work === current && work.revision === revision) {
    if($('source-picker').dataset.workId!==work.id){$('source-picker').open=false;$('source-picker').dataset.workId=work.id}
    for (const key of Object.keys(current)) if (!Object.hasOwn(stored, key)) delete current[key]
    Object.assign(current, stored); unsaved = false;taskStatus()
  }
}
function captureMappingChoices() {
  work.uiState = [...$('mapping').querySelectorAll('input,select,textarea')].filter(e => e.id).map(e => ({ id: e.id, value: e.value, checked: e.checked }))
}
function show(id) { $(id).hidden = false }
function stage(view, primary) {
  const step = view === 'import' ? ({ collect: 1, preview: 2, repreview: 3, apply: 3, pause: 4, resume: 4, 'cancel-work': 4 }[primary] || 1) : ({ 'read-form': 1, compare: 2, prefill: 3, 'return-source': 4 }[primary] || 1)
  activeStages[view]=step
  if(work?.type===view)work.interfaceState={...(work.interfaceState||{}),stage:step}
  const state=currentWorkflow(view)
  document.querySelectorAll(`[data-wizard-step^="${view}-"]`).forEach(item=>{
    const index=Number(item.dataset.wizardStep.split('-').at(-1))-1
    item.dataset.state=index===step-1?'current':state.attention[index]?'attention':state.complete[index]?'complete':'pending'
    const nav=item.querySelector('[data-stage-nav]');if(nav)nav.disabled=!state.available[index]
    if(index===step-1)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current')
  })
  if(view==='import')for(const [index,id] of ['import-scope','mapping','preview-section','import-progress'].entries())$(id).hidden=index+1!==step
  if(view==='prefill')for(const [index,id] of ['prefill-target-step','report-picker','field-review','prefill-result'].entries())$(id).hidden=index+1!==step
  taskStatus()
}
function restoreStage(view) {
  const own=work?.type===view?work:activeWorks[view],state=currentWorkflow(view)
  let step=own?.interfaceState?.stage||activeStages[view]||1
  if(!state.available[step-1])step=state.available.findLastIndex(Boolean)+1
  if(own&&['applying','failed','outcome_unknown','complete','partial_complete','paused','cancelled'].includes(own.status))step=4
  stage(view,(view==='import'?['collect','preview','apply','resume']:['read-form','compare','prefill','return-source'])[step-1])
}
document.querySelectorAll('[data-stage-nav]').forEach(button=>button.addEventListener('click',()=>{
  if(busy)return
  const [view,raw]=button.dataset.stageNav.split(':'),step=Number(raw)
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
  $('source-picker').hidden=value==='work'&&Boolean($('source-tab').value)
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
  return run(action, { readOnly: true, ...options })
}
async function run(action, { label = '正在處理工作', readOnly = false } = {}) {
  if (busy) return
  busy = true; $('workspace').setAttribute('aria-busy', 'true'); const sourceDisabled=$('source-tab').disabled; if(!readOnly)$('source-tab').disabled=true
  const trigger = document.activeElement, previousDisabled = trigger instanceof HTMLButtonElement ? trigger.disabled : false
  if (trigger instanceof HTMLButtonElement) trigger.disabled = true
  activeReadId = readOnly ? crypto.randomUUID() : ''; const readGeneration = activeReadGeneration
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
  try {
    if (unsaved && work?.type === 'import' && !$('mapping').hidden) { clearTimeout(editTimer); captureMappingChoices(); await save() }
    const result = await action()
    if (readGeneration !== activeReadGeneration && readOnly) return
    $('operation-status').hidden=true; $('operation-status').dataset.state = 'complete'; $('cancel-read').hidden = true
    return result
  }
  catch (error) {
    $('operation-status').dataset.state = 'error'
    if (!readOnly && work?.status === 'outcome_unknown') { $('operation-title').textContent = '寫入結果尚未確認'; $('operation-detail').textContent = '未收到這批的確認回應。檢查點已保留；續傳會先用原冪等鍵核對結果，不會建立新的匯入工作。'; notice('寫入結果尚未確認。請使用「檢查並續傳」核對批次狀態。', true) }
    else if (error.code === 'API_TIMEOUT') { $('operation-title').textContent = '連線逾時'; $('operation-detail').textContent = '唯讀查詢超過 30 秒，沒有自動重試。請確認連線後手動重試。' }
    else if (error.code === 'RATE_LIMITED') { $('operation-title').textContent = '伺服器暫時限制查詢'; $('operation-detail').textContent = error.retryAfter ? `請於 ${error.retryAfter} 秒後手動重試。` : '請稍後手動重試。' }
    else { $('operation-title').textContent = '操作未完成'; $('operation-detail').textContent = error.message || '請檢查連線後重試。' }
    notice(error.code === 'PREVIEW_STALE' ? '來源或 EduLog 資料已變更，請重新產生差異。' : '目前輸入與對應仍保留，請依上方說明處理後重試。', true)
    $('diagnostic').textContent = [error.code || 'WORK_FAILED', error.rawMessage, ...Object.entries(error.fields || {}).flatMap(([key, messages]) => messages.map(message => `${key}：${message}`)), error.requestId ? `請求編號：${error.requestId}` : ''].filter(Boolean).join('\n'); show('diagnostics')
  } finally { clearInterval(waitTimer); busy = false; activeReadId = ''; $('source-tab').disabled=sourceDisabled; $('workspace').removeAttribute('aria-busy'); $('operation-status').removeAttribute('aria-busy'); taskStatus(); if (trigger?.isConnected && trigger instanceof HTMLButtonElement) trigger.disabled = previousDisabled; $('cancel-read').hidden = true; $('apply').disabled = !previewResults.length || work?.previewDirty === true; finishRead() }
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
  loadedLessonCourses.clear(); lessonCatalogLoads.clear()
  context = { classrooms: [], courses: [], class_sessions: [], students: [], enrollments: [], occurrences: [], report_targets: [], lessons: [], source_links: [], permissions: {} }
  if ($('source-tab').value) await changeSource()
  else { $('source-label').textContent = '尚未選擇來源；請先開啟支援網站的班級頁或報告表單，再選取分頁。'; $('collect').disabled = true; $('read-form').disabled = true; notice('連線已驗證。尚未選取來源分頁；匯入與預填入口暫不可用。') }
  try { await loadSyncPreferences() } catch (error) { $('sync-preferences-status').textContent=`同步偏好讀取失敗；使用本機預設，可重試保存。 ${error.message}` }
  if(!integrationCapabilities.sync_field_preferences){$('sync-preferences-status').textContent='目前連線不支援跨裝置同步偏好；本次工作仍可調整欄位。';$('save-sync-preferences').disabled=true} renderSyncFields()
  flow(params.get('flow') || ($('source-tab').value?'import':'work'))
}
async function changeSource() {
  const current = ++generation; $('source-picker').open=true;delete $('source-picker').dataset.workId; form = null; report = null; previewResults = []; work = null;activeWorks.import=null;activeWorks.prefill=null;activeStages.import=1;activeStages.prefill=1;continuation=null;$('continue-work').hidden=true
  const tab = tabs.find(t => t.id === Number($('source-tab').value)); selectedPath = tab?.path || ''
  sourceContext = null; classSourceReady = false; reportSourceReady = false
  if (!tab) { $('source-label').textContent = '尚未選擇來源分頁'; $('collect').disabled = true; $('read-form').disabled = true; return }
  const c = await source('context'); if (current !== generation) return
  sourceContext = c; classSourceReady = Boolean(c?.classId); reportSourceReady = Boolean(c?.reportOpen)
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
function historyOptions(){return {dateFrom:work?.dateFrom,dateTo:work?.dateTo,includeInternal:$('include-internal-notes').checked,lessons:context?.lessons||[],syncFields:effectiveSyncFields()}}
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
function historyWorkChanged(){if(!work)return;work.previewDirty=true;updateHistoryPlanLocal();void save().catch(e=>notice(e.message,true))}
function historyUiChanged(){if(work)void save().catch(e=>notice(e.message,true))}
const historyView=createHistoryWorkbench({work:()=>work,labels:fieldLabels,changed:historyWorkChanged,uiChanged:historyUiChanged,recheck:()=>void runLatest(async()=>{const state=historyView.capture();await refreshHistoryPlan();historyView.refreshEditor(historyPlan,state)},{label:'正在逐日核對有效課次'}),defaults:effectiveSyncFields,fieldLabel:key=>fieldLabels[key]||key,diffValue:displayValue,fields:(host,item)=>attachImportFields(host,item.record,{work:()=>work,courseId:()=>item.target?.courseId,courseName:courseId=>context.courses.find(c=>c.id===courseId)?.display_name,resolve:(record,courseId)=>mappingController.resolveReportFieldRules(record,courseId),catalog,lessons:()=>context.lessons,ingestLessons:rows=>{context.lessons=[...new Map([...context.lessons,...rows].map(r=>[r.id,r])).values()]},api,capable:()=>integrationCapabilities.field_mapping_memory,shareRule:(rules,change)=>{if(!change)return;for(const target of work.snapshot.records.filter(r=>r.kind==='report'&&(change.fieldKey!=='lesson_id'||historyTargets().get(r.enrollment_source_id)?.courseId===item.target?.courseId))){const field=target.sourceFields?.find(candidate=>candidate.key===change.fieldKey&&(candidate.value??candidate.text)===change.sourceValue);if(!field||globalThis.edulogFieldMappings.signature(field)!==change.optionsSignature)continue;target.fieldRules||=[];target.fieldRules=target.fieldRules.filter(rule=>!(rule.field_key===change.fieldKey&&rule.source_value===change.sourceValue&&rule.options_signature===change.optionsSignature));if(change.action==='confirm'){const rule=rules.find(candidate=>candidate.field_key===change.fieldKey&&candidate.source_value===change.sourceValue&&candidate.options_signature===change.optionsSignature);if(rule)target.fieldRules.push(rule)}}},changed:historyWorkChanged})})
function historyTargets() {
  const targets=new Map()
  for(const r of work.snapshot.records.filter(r=>r.kind==='enrollment')) {
    const choice=$(`enrollment-${r.source_id}`)?.value,courseId=$(`enrollment-course-${r.source_id}`)?.value||mappingController.courseFor(r)
    if(!courseId)continue
    targets.set(r.source_id,{id:choice&&choice!=='new'?choice:choice==='new'?idFor('enrollment',r.source_id):null,isNew:choice==='new',eligible:mappingController.validateRow(r,true),courseId,name:r.sourceStudentName,courseName:context.courses.find(c=>c.id===courseId)?.display_name||r.sourceCourseLabel})
  }
  return targets
}
async function refreshHistoryPlan() {
  if(!work?.snapshot)return
  const owner=work,epoch=generation,sequence=++historyCheckSequence,targets=historyTargets(),archives=new Map(),routes=new Map()
  const current=()=>owner===work&&epoch===generation&&sequence===historyCheckSequence
  $('history-sync-summary').textContent='正在核對歷史與有效名單；既有選擇保留…'
  const lessonCourses=new Set(owner.snapshot.records.filter(r=>r.kind==='report'&&(r.sourceFields||[]).some(f=>f.key==='lesson_id'&&f.type==='stage')).map(r=>targets.get(r.enrollment_source_id)?.courseId).filter(id=>id&&id!=='new'))
  for(const courseId of lessonCourses){await ensureLessonCatalog(courseId);if(!current())return}
  if(integrationCapabilities.enrollment_history_reports) {
    for(const [admission,target] of targets) {
      if(!target.id||target.isNew)continue
      let cursor,rows=[],seenCursors=new Set()
      do{const page=await api('history-list',undefined,{query:{enrollment_id:target.id,source_admission_id:admission,limit:50,cursor}});if(!current())return;rows.push(...page.items||[]);cursor=page.next_cursor||undefined;if(cursor&&seenCursors.has(cursor))throw new Error('歷史清單分頁未前進，請重新核對。');if(cursor)seenCursors.add(cursor)}while(cursor)
      archives.set(target.id,[...(archives.get(target.id)||[]),...rows])
      const dates=[...new Set(owner.snapshot.records.filter(r=>r.kind==='report'&&r.enrollment_source_id===admission&&r.date&&r.date>=owner.dateFrom&&r.date<=owner.dateTo).map(r=>r.date))],occurrences=[]
      for(let i=0;i<dates.length;i+=50){cursor=undefined;seenCursors=new Set();do{const page=await api('history-route',{enrollment_id:target.id,dates:dates.slice(i,i+50),limit:50,...(cursor?{cursor}:{})});if(!current())return;occurrences.push(...page.items||[]);cursor=page.next_cursor||undefined;if(cursor&&seenCursors.has(cursor))throw new Error('課次分頁未前進，請重新核對。');if(cursor)seenCursors.add(cursor)}while(cursor)}
      routes.set(target.id,occurrences)
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
  work = { id: crypto.randomUUID(), type: 'import', status: 'collected', sourceTab: Number($('source-tab').value), sourcePath: selectedPath, title: snapshot.title, snapshot, ids: {}, dateFrom: $('all-history').checked?'1900-01-01':$('date-from').value, dateTo: $('all-history').checked?'9999-12-31':$('date-to').value, includeInternalNotes: $('include-internal-notes').checked, syncFieldPreferences:{...(syncPreferences.fields||{})},syncPreferencesSnapshot:{...effectiveSyncFields()},syncFieldOverrides:{...syncDraftOverrides}, done: 0 }
  if ($('read-history').checked) work.history = { paths: snapshot.admissionPaths, next: 0 }
  activeWorks.import=work;await save(); if (work.history) await collectHistory()
  await mappingView();renderHistoryIssues(); notice(`已擷取 ${work.snapshot.records.length} 筆可辨識資料。缺少欄位仍需確認。${work.status === 'paused-extraction' ? '擷取中斷，可從工作紀錄繼續。' : ''}`)
}
async function collectHistory(retryPath) {
  paused=false
  const owner=work, epoch=activeReadGeneration, sourceEpoch=generation
  await readHistoryWork(owner,{current:()=>owner===work&&epoch===activeReadGeneration&&sourceEpoch===generation,paused:()=>paused,save,source,merge:mergeRecords,progress:message=>{$('operation-detail').textContent=message;notice(message)}},retryPath)
  if(owner===work)renderHistoryIssues()
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
    if(!item.listFailed){url=labelledInput(card,'原站報告編輯連結','url',`history-link-${item.evidenceKey}`,item.data?.external_link||'');date=labelledInput(card,'完整上課日期（缺少年份時請確認）','date',`history-date-${item.evidenceKey}`,item.date||'');url.autocomplete=date.autocomplete='off'}
    const status=node('p',item.skipped?'已略過；不會建立此報告。':'尚未完成擷取','hint');status.setAttribute('aria-live','polite');card.append(status)
    const retry=node('button',item.listFailed?'重試此生歷史紀錄':'補足並重新讀取'),skip=node('button',item.skipped?'取消略過':'略過此筆');retry.type=skip.type='button';card.append(retry,skip)
    skip.addEventListener('click',()=>void run(async()=>{item.skipped=!item.skipped;const record=work.snapshot.records.find(r=>r.kind==='report'&&r.source_id&&r.source_id===item.source_id);if(record)record.sourceSkipped=item.skipped;await save();skip.textContent=item.skipped?'取消略過':'略過此筆';status.textContent=item.skipped?'已略過；其他資料可繼續匯入。':'待處理，請補足或重試。'},{label:'正在保存略過選擇'}))
    retry.addEventListener('click',async()=>{
      if(retry.disabled)return;const owner=work, epoch=generation;retry.disabled=skip.disabled=true;if(url)url.disabled=date.disabled=true;status.textContent='正在讀取並核對來源…'
      try{
        if(item.listFailed){await collectHistory(item.admissionPath);if(owner!==work||epoch!==generation)return;mappingController.appendReports()}
        else{const updated=await source('history-report',{workId:work.id,historyPath:`/dt_admissions/${item.enrollment_source_id}`,input:{reportId:item.source_id,evidenceKey:item.evidenceKey,editUrl:url.value,confirmedDate:date.value||undefined}});if(owner!==work||epoch!==generation)return;if(!updated.date)throw new Error('請確認完整日期後再重新讀取。');const index=work.snapshot.records.findIndex(r=>r.kind==='report'&&r.source_id===updated.source_id);if(index>=0)Object.assign(work.snapshot.records[index],updated);else work.snapshot.records.push(updated);work.history.issues=work.history.issues.filter(r=>r!==item);await save();mappingController.appendReports();status.textContent='已讀取並驗證報告；請核對教材與欄位映射。';url.disabled=date.disabled=retry.disabled=skip.disabled=true;card.dataset.complete='true'}
      }catch(e){if(owner===work)status.textContent=`讀取未完成：${e.message} 目前選擇保留。`}
      finally{if(retry.isConnected&&!card.dataset.complete){retry.disabled=skip.disabled=false;if(url)url.disabled=date.disabled=false}}
    })
  }
}
function prepareRows() {
  work.includeInternalNotes = $('include-internal-notes').checked
  const eligible = new Set(work.snapshot.records.filter(r=>r.kind==='enrollment'&&mappingController.validateRow(r,true)).map(r=>r.source_id))
  if (!eligible.size) throw new Error('目前沒有可匯入的報名。請查看各筆核對提示，完成既有報名查詢與對應後再產生差異。')
  const courseIds = [...new Set(work.snapshot.records.filter(r=>eligible.has(r.source_id)&&r.kind==='enrollment').map(r=>$(`enrollment-course-${r.source_id}`).value))], courseId = courseIds[0]
  const sessionId = $('class-session').value === 'new' ? idFor('class_session', work.snapshot.classId) : $('class-session').value
  if (!$('classroom').value || !courseId || !sessionId) throw new Error('請選擇目標教室、班級及各筆報名的課程。')
  const rows = [], needs = []
  for(const issue of work.history?.issues||[])if(issue.listFailed&&!issue.skipped)needs.push(`報名 ${issue.admissionPath} 的歷史索引未讀取；請重試或略過。`)
  if (work.history && work.history.next < work.history.paths.length) needs.push(`尚有 ${work.history.paths.length - work.history.next} 份來源紀錄未完成擷取。`)
  const add = (kind, sourceId, targetId, data) => rows.push({ source_id: sourceId, target_id: targetId, overwrite: [], record: { kind, data } })
  rows.push(...mappingController.courseRows().filter(r=>courseIds.includes(r.target_id)))
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
  work.historyBindings=[]
  for(const item of historyPlan) {
    if(item.category==='skipped'||item.category==='linked')continue
    if(item.category==='needs'){needs.push(`${item.target?.name||'來源報名 #'+item.record.enrollment_source_id} · ${item.record.date||item.record.dateRaw||'日期待確認'}：${item.reason}`);continue}
    if(!enrollments.has(item.record.enrollment_source_id)){needs.push(`歷史 ${item.key} 的報名尚未確認。`);continue}
    const targetId=item.existing?.id||idFor('history_report',item.key)
    add('history_report',item.key,targetId,item.data)
    if(item.record.historyDuplicateConfirmed)rows.at(-1).reviewed_duplicate=true
    if(item.category==='bind')work.historyBindings.push({historyId:targetId,itemKey:item.key,expectedFields:Object.fromEntries(teachingFields.filter(f=>Object.hasOwn(item.data,f)).map(f=>[f,item.data[f]])),occurrence:item.occurrence,body:{key:crypto.randomUUID(),class_occurrence_id:item.occurrence.id,overwrite:item.record.historyOverwrite||[],include_internal:work.includeInternalNotes,include_fields:item.includedFields||[]},status:'pending'})
  }
  work.destination = { classroom_id: $('classroom').value, course_ids: courseIds, class_session_id: sessionId, report_session_ids: [...new Set([sessionId,...(work.historyBindings||[]).map(b=>b.occurrence.class_session_id)])] }; work.needs = needs
  return rows
}
async function preview(reuse = false) {
  if (!work || work.type !== 'import') throw new Error('請先擷取目前班級。')
  if (!reuse) {
    if (work.jobId && (work.done > 0 || ['applying','outcome_unknown','failed'].includes(work.status))) throw new Error('此工作已有寫入或待確認檢查點。請使用「檢查並續傳」核對原批次，不能重新建立工作。')
    if (batchBytes < 4096) throw new Error('API 請求大小設定過小，請調整 API_BODY_LIMIT。')
    await mappingController.resolveFieldRules()
    if(!integrationCapabilities.enrollment_history_reports)throw Object.assign(new Error('目前連線未提供歷史保存功能。請重新檢查連線；已讀取資料與檢查點會保留。'),{code:'CAPABILITY_UNAVAILABLE'})
    await refreshHistoryPlan()
    const batches = splitBatches(prepareRows(), batchBytes)
    if (!batches.length) {renderNoopSummary();return}
    work.previewDirty = true; previewResults = []; $('apply').disabled = true
    if (work.jobId) await api('job-status', { status: 'cancelled' }, { jobId: work.jobId })
    const job = await api('job', { source_origin: work.snapshot.sourceOrigin, source_class_id: work.snapshot.classId, date_from: work.dateFrom, date_to: work.dateTo, ...work.destination })
    work.batches = batches; work.done = 0; work.jobId = job.id; work.batchCount = batches.length; work.previewDirty = true
    await save()
  }
  validateBatches(work.batches)
  previewResults = []
  for (let i = work.done || 0; i < work.batches.length; i++) {
    const result = await api('preview', work.batches[i], { jobId: work.jobId })
    if (result.applied != null) { work.done = i + 1; work.appliedBatchKeys = [...new Set([...(work.appliedBatchKeys || []), work.batches[i].key])]; await save() }
    else previewResults.push({ ...result, batchIndex: i })
  }
  work.status = 'previewed'; work.previewDirty = false; work.mappingDirty = false; work.batchCount = work.batches.length; await save(); renderDifferences(); notice('差異已更新，請檢查後確認匯入。')
}
function renderNoopSummary() {
  work.previewEvaluated=true;work.previewDirty=true;previewResults=[];$('apply').disabled=true;show('preview-section');stage('import','repreview')
  $('counts').textContent=`沒有新的可寫入資料 · 已綁定 ${historyPlan.filter(i=>i.category==='linked').length} 份 · 需處理 ${work.needs?.length||0} 項`
  $('diff-list').replaceChildren(node('p','本次核對不需要建立新工作。既有報告與檢查點保留；待處理項目可返回「處理例外」核對。'))
  notice('核對完成：沒有新的可寫入資料，不會重送已同步報告。')
}
function renderDifferences() {
  $('diff-list').replaceChildren(); const totals = { added: 0, updated: 0, unchanged: 0, conflict: 0 }
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
  $('counts').textContent = [...Object.entries(totals).map(([k, v]) => `${labels[k]} ${v}`), `需處理 ${work.needs.length}`].join(' · ')
  const summary=node('section');summary.append(node('h3',`確認本次同步：保存 ${work.batches.flatMap(b=>b.rows).filter(r=>r.record.kind==='history_report').length} 份歷史 · 綁定 ${(work.historyBindings||[]).length} 堂課`),node('p','確認同步後，先保存歷史，再依已核對日期與有效名單綁定課次。未選取覆寫的非空內容保留 EduLog；報名關係不變。'))
  for(const plan of work.historyBindings||[])summary.append(node('p',`${plan.occurrence.class_name} · ${plan.occurrence.occurrence_date} · ${plan.itemKey} · 覆寫 ${plan.body.overwrite.length} 個欄位`))
  $('diff-list').prepend(summary)
  if (work.needs.length) { const d = node('details'); d.append(node('summary', `查看 ${work.needs.length} 項需處理資料`)); work.needs.forEach(text => d.append(node('p', text))); $('diff-list').append(d) }
  show('preview-section'); stage('import', 'apply'); $('apply').disabled = false
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
function renderImportOutcome() {
  const host = $('import-outcome'); host.replaceChildren(); host.hidden = false
  const title = node('h3', work.status === 'complete' ? '匯入批次已核驗完成' : '部分完成：已寫入資料保留，另有待處理或略過資料')
  host.append(title)
  const totals = {}
  for (const key of work.appliedBatchKeys || []) mergeImportSummary(totals, work.batchSummaries?.[key])
  const counts=Object.values(totals),bound=(work.historyBindings||[]).filter(binding=>binding.status==='done').length
  outcomeMetrics(host,{saved:work.historySummary?.saved||0,bound,kept:counts.reduce((n,row)=>n+(row.conflict||0),0),skipped:(work.history?.issues||[]).filter(issue=>issue.skipped).length,failed:counts.reduce((n,row)=>n+(row.failed||0),0),pending:work.needs?.length||0})
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
  if(archived)host.append(node('p',`已保存歷史 ${archived} 份，其中 ${bindings.filter(b=>b.status==='done').length} 份已綁定課次；未綁定歷史不列入出席統計。`))
  if (work.needs?.length) host.append(node('p', `另有 ${work.needs.length} 項未匯入或需處理；批次完成不代表來源資料已全部同步。`, 'hint'))
  const skippedHistory=(work.history?.issues||[]).filter(r=>r.skipped).length
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
  if(work.status==='partial_complete') {
    const repair=node('button','處理未完成項目');repair.type='button'
    repair.addEventListener('click',()=>flow('work'));host.append(repair)
  }
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
  show('import-progress'); $('progress').max = work.batchCount || 1; $('progress').value = work.done || 0
  $('progress-label').textContent = `已完成 ${work.done || 0} / ${work.batchCount || 0} 批。${work.needs?.length || 0} 項仍需處理。`
  $('resume').hidden = !['paused','failed','outcome_unknown'].includes(work.status)
  $('pause').hidden = work.status !== 'applying'; $('cancel-work').hidden = ['complete','cancelled','partial_complete'].includes(work.status)
  stage('import','resume');$('operation-status').hidden = work.status!=='applying'
  $('operation-status').dataset.state = work.status === 'applying' ? 'loading' : ['failed','outcome_unknown'].includes(work.status) ? 'error' : 'complete'
  $('operation-title').textContent = ({ applying:'正在寫入匯入批次', paused:'匯入已暫停', failed:'匯入部分失敗', outcome_unknown:'寫入結果尚未確認', complete:'匯入批次已完成', partial_complete:'部分完成，尚有待處理項目', cancelled:'已取消剩餘批次' })[work.status] || '匯入進度'
  $('operation-detail').textContent = `已核對 ${work.done || 0} / ${work.batchCount || 0} 批；${work.needs?.length || 0} 筆需處理。取消不會撤回已完成批次。`
  $('operation-progress').hidden = !work.batchCount; $('operation-progress').max = work.batchCount || 1; $('operation-progress').value = work.done || 0
  if (work.status === 'complete' || work.status === 'partial_complete') renderImportOutcome()
}
function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}-${parts.find(p=>p.type==='day').value}`
}
async function finalizeImport() {
  await applyHistoryBindings()
  work.historySummary={saved:work.batches.flatMap(b=>b.rows).filter(r=>r.record.kind==='history_report').length,linked:(work.historyBindings||[]).filter(b=>b.status==='done').length,skipped:work.snapshot?.records.filter(r=>r.kind==='report'&&r.sourceSkipped).length||0}
  const keys = work.batches.map(batch => batch.key)
  const completed = await api('complete', { expected_batch_keys: keys }, { jobId: work.jobId })
  work.status = completed.verified === true && !work.needs?.length && !work.historySummary.skipped && !(work.history?.issues||[]).some(i=>i.skipped||i.listFailed||!work.snapshot.records.some(r=>r.kind==='report'&&historyIdentity(r)===historyIdentity(i)&&r.date&&r.sourceReadStatus!=='failed')) ? 'complete' : 'partial_complete'
  work.appliedBatchKeys = keys
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
  await save(); progress()
}
async function applyHistoryBindings() {
  const owner=work,epoch=generation
  const check=()=>{if(owner!==work||epoch!==generation){const error=new Error('工作情境已變更；請用原檢查點核對保存結果。');error.code='API_RESPONSE_INVALID';throw error}}
  for(const plan of owner.historyBindings||[]) {
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
  if (work.previewDirty || !work.jobId) throw new Error('請先更新差異。')
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
      await api('apply', work.batches[i], { jobId: work.jobId })
      const previewBatch = previewResults.find(result => result.batchIndex === i)
      if (previewBatch) {
        const summary = {}
        for (const row of previewBatch.rows || []) { summary[row.kind] ||= {}; summary[row.kind][row.status] = (summary[row.kind][row.status] || 0) + 1 }
        work.batchSummaries ||= {}; work.batchSummaries[work.batches[i].key] = summary
      }
      work.done = i + 1; await save(); progress()
    }
    const finished = work.done === work.batches.length
    work.status = finished ? 'applying' : cancelRequested ? 'cancelled' : 'paused'
    if (finished) await finalizeImport()
    else { await api('job-status', { status: work.status }, { jobId: work.jobId }); await save(); progress() }
    if (finished || cancelRequested) { previewResults = []; $('mapping').hidden = true; $('preview-section').hidden = true; $('pause').hidden = true; $('cancel-work').hidden = true; stage('import', 'cancel-work') }
    notice(finished ? `已核對 ${work.batchCount} 個匯入批次；${work.needs.length} 項仍需處理，請查看名單核對結果。` : cancelRequested ? '已取消剩餘工作，成功寫入的資料保留。' : '工作已暫停，成功批次保留。')
  } catch (error) { work.status = ['API_TIMEOUT','API_NETWORK_ERROR','API_RESPONSE_INVALID'].includes(error.code) || /^HTTP_5/.test(error.code || '') ? 'outcome_unknown' : 'failed'; await save(); progress(); throw error }
}
async function resumeImport() {
  if (!work?.jobId) throw new Error('找不到可續傳的匯入工作。')
  if (work.status === 'outcome_unknown' || work.status === 'applying' || work.status === 'failed') {
    await preview(true)
    if ((work.done || 0) >= (work.batchCount || work.batches?.length || 0)) {
      await finalizeImport(); notice('伺服器檢查點確認所有批次均已提交；名單核對結果已更新。'); return
    }
    notice('已使用原冪等鍵檢查未確認批次。檢視差異後，再按「確認並分批匯入」。')
    return
  }
  await apply()
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
let workHistory={local:null,remote:null}
async function loadWork() {
  const [localResult, remoteResult] = await Promise.allSettled([send({ type: 'workspace-store', action: 'list' }), api('work')])
  const local = localResult.status === 'fulfilled' ? localResult.value : null
  const remote = remoteResult.status === 'fulfilled' ? remoteResult.value : null
  workHistory={local,remote};renderWorkRecords()
}
function renderWorkRecords() {
  const {local,remote}=workHistory,combined=combineWorkRecords(local||[],remote||{}),filter=$('work-filter').value||'all',visible=combined.filter(row=>filter==='all'||row.category===filter)
  globalThis.edulogUi?.text($('work-count'),'work.count',{visible:visible.length,total:combined.length})
  $('work-list').replaceChildren()
  if (!local) {
    const card = node('article', undefined, 'card'); card.append(node('h2', '本機工作暫時無法讀取'), node('p', '工作資料庫連線已中斷。請重新整理以重新開啟連線；已儲存的工作資料不會因這次讀取失敗而刪除。', 'hint'))
    const retry = node('button', '重試讀取本機工作'); retry.addEventListener('click', () => void runLatest(loadWork, { label: '正在重新開啟本機工作資料庫' })); card.append(retry); $('work-list').append(card)
  }
  for (const combinedRow of visible.filter(row=>row.local).sort((a,b)=>b.local.updatedAt-a.local.updatedAt)) {
    const row=combinedRow.local
    const card = node('article', undefined, 'card'); const statusText = ({ applying:'寫入中', paused:'已暫停', failed:'部分失敗', outcome_unknown:'結果尚未確認', complete:'已完成', partial_complete:'部分完成，尚有待處理項目', cancelled:'已取消剩餘批次', collected:'已擷取，待確認對應', collecting:'擷取中', 'paused-extraction':'擷取已暫停', reviewing:'待檢查欄位', pending_confirmation:'待人工送出／待確認' })[row.status] || '狀態需確認'; card.append(node('h2', row.title || row.id), node('p', `${row.type === 'import' ? '教學資料匯入' : '報告預填'} · ${statusText} · ${new Date(row.updatedAt).toLocaleString(globalThis.edulogUi?.locale||'zh-TW')}`))
    const origin=node('p',undefined,'record-origin');globalThis.edulogUi?.text(origin,combinedRow.remote?'work.merged':'work.local');card.append(origin)
    if(combinedRow.remote)appendRemoteWork(card,combinedRow.remote,row)
    if(row.type==='import'&&row.status==='partial_complete'&&row.snapshot) {
      const repair=node('button','處理未完成項目 · 重新讀取與核對');repair.type='button'
      repair.addEventListener('click',()=>void run(async()=>{
        const chosen=Number($('source-tab').value)||row.sourceTab
        $('source-tab').value=String(chosen);selectedPath=tabs.find(t=>t.id===chosen)?.path||row.sourcePath
        const current=await source('context');if(current.classId!==row.snapshot.classId)throw new Error('請開啟相同來源班級頁，再處理未完成項目。')
        work=retryHistoryWork(row);work.sourceTab=chosen;work.sourcePath=selectedPath;$('include-internal-notes').checked=work.includeInternalNotes===true
        await save();flow('import');if(work.history)await collectHistory();await mappingView();renderHistoryIssues();notice('已重新核對歷史；原工作與已提交批次保留，已綁定資料不重複新增。')
      }));card.append(repair)
    }
    if (row.type === 'import' && row.batches && !['complete','cancelled','partial_complete'].includes(row.status)) {
      const resume = node('button', '檢查並續傳'); resume.addEventListener('click', () => void run(async () => {
        work = row; $('source-tab').value = String(row.sourceTab); selectedPath = row.sourcePath; flow('import')
        if (row.done === row.batches.length) { await finalizeImport(); notice('已恢復完成檢查點；伺服器批次與名單核對已更新。'); return }
        if (row.status === 'outcome_unknown' || row.status === 'applying' || row.status === 'failed') { await resumeImport(); return }
        if (row.status === 'paused') await api('job-status', { status: 'applying' }, { jobId: row.jobId }); await preview(true); progress(); notice('檢查剩餘批次後，按確認匯入或續傳。')
      })); card.append(resume)
    }
    if (row.type === 'import' && row.snapshot && (!row.batches || !row.done && ['collected','previewed'].includes(row.status))) {
      const resume = node('button', row.history?.next < row.history?.paths.length ? '繼續擷取／確認對應' : '繼續確認對應')
      resume.addEventListener('click', () => void run(async () => {
        const chosen = Number($('source-tab').value) || row.sourceTab
        $('source-tab').value = String(chosen); selectedPath = tabs.find(t => t.id === chosen)?.path || row.sourcePath
        $('include-internal-notes').checked = row.includeInternalNotes === true
        const c = await source('context'); if (c.classId !== row.snapshot.classId) throw new Error('請先選擇同一來源班級的分頁。')
        work = { ...row, sourceTab: chosen, sourcePath: selectedPath }; await save()
        flow('import'); if (row.history) await collectHistory(); await mappingView();renderHistoryIssues(); notice('已恢復來源資料，請確認對應。')
      })); card.append(resume)
    }
    if (row.type === 'prefill' && row.push && !row.pushRecorded) {
      const retry = node('button', '重試回寫待確認紀錄'); retry.addEventListener('click', () => void run(async () => { await api('push', row.push); await send({ type: 'workspace-store', action: 'put', work: { ...row, pushRecorded: true } }); notice('待確認紀錄已回寫；原站表單未再次套用。'); await loadWork() })); card.append(retry)
    }
    if (row.type === 'prefill' && row.status === 'applying') card.append(node('p', '上次套用回應中斷，請到原站確認內容。不會自動重複套用。'))
    $('work-list').append(card)
  }
  if(local&&remote&&!visible.length){const empty=node('p',undefined,'hint');globalThis.edulogUi?.text(empty,'work.filteredEmpty');$('work-list').append(empty)}
  if (!remote) {
    const remoteError = node('article', undefined, 'card'); remoteError.append(node('h2', 'EduLog 工作紀錄暫時無法載入'), node('p', '本機續傳資料仍可查看。請確認連線後重試伺服器紀錄。', 'hint'))
    const retryRemote = node('button', '重試載入 EduLog 紀錄'); retryRemote.addEventListener('click', () => void runLatest(loadWork, { label: '正在重新載入 EduLog 工作紀錄' })); remoteError.append(retryRemote); $('work-list').append(remoteError)
    notice('工作紀錄部分載入失敗；本機與伺服器資料分開保留。', true); return
  }
  for(const row of visible.filter(row=>!row.local)) {
    const card=node('article',undefined,'card'),origin=node('p',undefined,'record-origin');globalThis.edulogUi?.text(origin,'work.remote');card.append(origin)
    if(row.remote)appendRemoteWork(card,row.remote)
    else {const push=row.push;card.append(node('h2',`報告 ${String(push.report_id||push.id).slice(0,8)}`),node('p',push.status==='confirmed'?'已確認':'待人工送出／待確認'))}
    $('work-list').append(card)
  }
  notice('工作紀錄已更新。')
}
function appendRemoteWork(item,r,local) {
  const statusText=status=>({queued:'排隊中',collecting:'擷取中',previewed:'待確認差異',applying:'匯入中',paused:'已暫停',failed:'部分失敗',outcome_unknown:'結果尚未確認',partial_complete:'部分完成，尚有待處理項目',complete:'已完成',cancelled:'已取消剩餘批次',pending_confirmation:'待人工確認',confirmed:'已確認'})[status]||'狀態待確認'
  item.append(node('p',`來源班級 ${r.source_class_id||'—'} · ${statusText(r.status)} · 批次內已處理 ${r.counts?.applied||0} 筆`))
  const label=node('label','名單核對日期'),date=node('input');date.type='date';date.value=local?.rosterVerification?.date||local?.rosterChecks?.[0]?.date||taipeiToday();label.append(date);item.append(label)
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
$('work-filter').addEventListener('change',renderWorkRecords)


document.querySelectorAll('[data-flow]').forEach(b => b.addEventListener('click', async () => {if(busy&&!activeReadId)return;if(activeReadId){await cancelRead(false);await readFinished}flow(b.dataset.flow)}))
$('source-tab').addEventListener('change', () => void runLatest(changeSource, { label: '正在讀取來源班級' }))
$('classroom-search').addEventListener('input', () => { clearTimeout(mappingSearchTimer); mappingSearchTimer = setTimeout(() => void runLatest(() => loadClassrooms(true), { label: '正在搜尋目標教室' }), 300) })
$('more-classrooms').addEventListener('click', () => void runLatest(() => loadClassrooms(false), { label: '正在載入更多教室候選' }))
$('mapping-course-search').addEventListener('input', () => { clearTimeout(mappingSearchTimer); mappingSearchTimer = setTimeout(() => void runLatest(() => loadMappingCourses(true), { label: '正在搜尋目標課程' }), 300) })
$('more-mapping-courses').addEventListener('click', () => void runLatest(() => loadMappingCourses(false), { label: '正在載入更多課程候選' }))
$('classroom').addEventListener('change', () => void runLatest(async () => { await updateDestinations(); await loadScopedMappingData(); updateMappingOptions() }, { label: '正在查詢教室與課程候選' }))
$('course').addEventListener('change', () => void runLatest(async () => { await updateDestinations(); await loadScopedMappingData(); updateMappingOptions() }, { label: '正在查詢班級候選' }))
$('class-session').addEventListener('change', () => void runLatest(async () => { $('new-session').hidden = $('class-session').value !== 'new'; await loadScopedMappingData(); updateMappingOptions() }, { label: '正在查詢學生報名與課次' }))
$('course-source-id').addEventListener('change', updateMappingOptions)
$('start-new-work').onclick=()=>{continuation=null;$('continue-work').hidden=true;work=null;activeWorks.import=null;activeStages.import=1;flow('import');$('collect').disabled=!classSourceReady;taskStatus()}
$('resume-source-work').onclick=()=>void runLatest(async()=>{const row=continuation;if(!row)return;work=row.status==='partial_complete'?retryHistoryWork(row):row;activeWorks.import=work;$('continue-work').hidden=true;$('collect').disabled=!classSourceReady;$('include-internal-notes').checked=work.includeInternalNotes===true;flow('import');if(work.batches){await resumeImport();return}if(work.history?.next<work.history?.paths.length)await collectHistory();await mappingView();renderHistoryIssues()},{label:'正在恢復未完成工作'})
for (const [id, action] of Object.entries({ collect, preview: () => preview(), repreview: () => preview(!work.mappingDirty), apply, resume: resumeImport, 'read-form': readForm, compare, prefill, 'refresh-work': loadWork, reconnect: initialize })) $(id).addEventListener('click', () => void run(action, { label: ({ collect:'正在讀取來源班級與學習紀錄', preview:'正在比對 EduLog 目標與匯入差異', repreview:'正在重新檢查資料差異', apply:'正在寫入匯入批次', resume:'正在檢查未完成批次', 'read-form':'正在讀取原站報告目標', compare:'正在查詢報告欄位並核對目標', prefill:'正在套用已確認欄位至原站', 'refresh-work':'正在更新工作紀錄', reconnect:'正在重新驗證連線' })[id] || '正在處理工作', readOnly: ['collect','read-form','compare','refresh-work','reconnect'].includes(id) }))
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
