import './field-mapping-ui.js'
import { createMappingController } from './mapping-controller.js'
import { mappedReport } from './import-field-mappings.js'
import { admissionIdentity, mergeRecords } from './mapping-core.js'
import { labels, splitBatches, validateBatches, workspaceErrorMessage, plainText, suggestedValue } from './workspace-model.js'
const bridge = globalThis.edulogRuntime, $ = id => document.getElementById(id)
let fieldRules=[]
let frontendSettingsUrl = null
let integrationCapabilities = {}
let binding, context, tabs = [], work, form, reports = [], report, reportCursor = '', reportCourseCursor = '', classroomCursor = '', mappingCourseCursor = '', activeCourseRoom = '', studentCursors = {}, studentCandidates = {}, studentSearchTimers = {}, reportSearchTimer, mappingSearchTimer, busy = false, paused = false, cancelRequested = false, selectedPath = '', sourceContext = null, classSourceReady = false, reportSourceReady = false, generation = 0, previewResults = [], batchBytes = 180000, unsaved = false, editTimer, activeReadId = '', activeReadGeneration = 0, readFinished = Promise.resolve(), finishRead = () => {}
const wizardMax = { import: 1, prefill: 1 }
const params = new URLSearchParams(location.search)
const fieldLabels = { name: '名稱', subject: '科目', stage: '階段', display_name: '課程名稱', external_link: '原站連結', classroom_id: '教室', course_ids: '班級可上課程', student_id: '學生', course_id: '課程', class_session_id: '班級', enrollment_id: '報名', class_occurrence_id: '課次', start_date: '開始日期', day_of_week: '星期', start_time: '開始時間', end_time: '結束時間', original_start_time: '課次開始時間', original_end_time: '課次結束時間', occurrence_date: '課次日期', time_zone: '時區', status: '報名狀態', content: '學習表現', is_completed: '課程完成狀況', progress_letter: '章節進度', attendance_status: '出席', absence_reason: '缺席原因', lesson_id: '教材', class_participation: '課程參與', classroom_behavior: '課堂表現', contact_notes: '聯絡欄', class_notes: '內部紀錄' }
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n }
function notice(message = '', error = false) { $('notice').textContent = message; $('notice').dataset.error = String(error) }
async function send(message) {
  const response = await bridge.send({ ...message, binding })
  if (response?.error) { const e = new Error(workspaceErrorMessage(response.error)); e.code = response.error.code; e.requestId = response.error.requestId; e.retryAfter = response.error.retryAfter; e.fields = response.error.fields; e.rawMessage = response.error.message; throw e }
  return response?.data
}
const api = (operation, body, extra = {}) => send({ type: 'workspace-api', operation, body, ...(['context','catalog','resolve','field-resolve','reports','work','reconcile','import-info'].includes(operation) && activeReadId ? { requestId: activeReadId } : {}), ...extra })
const source = (action, extra = {}) => send({ type: 'workspace-source', action, tabId: Number($('source-tab').value), sourcePath: selectedPath, requestId: activeReadId || undefined, ...extra })
async function save() {
  const current = work
  current.revision = (current.revision || 0) + 1
  const revision = current.revision
  const stored = await send({ type: 'workspace-store', action: 'put', work: current })
  if (work === current && work.revision === revision) {
    for (const key of Object.keys(current)) if (!Object.hasOwn(stored, key)) delete current[key]
    Object.assign(current, stored); unsaved = false
  }
}
function captureMappingChoices() {
  work.uiState = [...$('mapping').querySelectorAll('input,select,textarea')].filter(e => e.id).map(e => ({ id: e.id, value: e.value, checked: e.checked }))
}
function show(id) { $(id).hidden = false }
function stage(view, primary) {
  $(`${view}-view`).querySelectorAll('.primary').forEach(b => { if (!b.closest('.mapping-workbench')) b.classList.remove('primary') }); $(primary)?.classList.add('primary')
  const step = view === 'import' ? ({ collect: 1, preview: 2, repreview: 3, apply: 3, pause: 4, resume: 4, 'cancel-work': 4 }[primary] || 1) : ({ 'read-form': 1, compare: 2, prefill: 3, 'return-source': 4 }[primary] || 1)
  wizardMax[view] = Math.max(wizardMax[view] || 1, step)
  document.querySelectorAll(`[data-wizard-step^="${view}-"]`).forEach(item => {
    const indexStep = Number(item.dataset.wizardStep.split('-').at(-1)); item.dataset.state = indexStep === step ? 'current' : indexStep <= wizardMax[view] ? 'complete' : 'pending'
    const nav = item.querySelector('[data-stage-nav]'); if (nav) nav.disabled = indexStep > wizardMax[view]
    if (indexStep === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current')
  })
  if (view === 'import') for (const [index, id] of ['import-scope','mapping','preview-section','import-progress'].entries()) $(id).hidden = index + 1 !== step
  if (view === 'prefill') for (const [index, id] of ['prefill-target-step','report-picker','field-review','prefill-result'].entries()) $(id).hidden = index + 1 !== step
}
document.querySelectorAll('[data-stage-nav]').forEach(button => button.addEventListener('click', () => {
  const [view, raw] = button.dataset.stageNav.split(':'), step = Number(raw)
  if (step > wizardMax[view]) return
  const primary = view === 'import' ? ({1:'collect',2:'preview',3:'apply',4:'resume'})[step] : ({1:'read-form',2:'compare',3:'prefill',4:'return-source'})[step]
  stage(view, primary)
}))
function flow(value) {
  if (!['import', 'prefill', 'work'].includes(value)) value = 'import'
  if (busy && activeReadId) void cancelRead(false)
  for (const item of ['import', 'prefill', 'work']) $(`${item}-view`).hidden = item !== value
  document.querySelectorAll('[data-flow]').forEach(button => { if (button.dataset.flow === value) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current') })
  $('source-picker').hidden = value === 'work'
  if (value === 'import') stage('import', 'collect')
  if (value === 'prefill') stage('prefill', 'read-form')
  if (value === 'work' && binding) void runLatest(loadWork, { label: '正在更新工作紀錄' })
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
  busy = true; $('workspace').setAttribute('aria-busy', 'true')
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
    if (readOnly) { $('operation-status').dataset.state = 'complete'; $('operation-title').textContent = '查詢完成'; $('operation-detail').textContent = `等待時間 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒。`; $('cancel-read').hidden = true }
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
  } finally { clearInterval(waitTimer); busy = false; activeReadId = ''; $('workspace').removeAttribute('aria-busy'); $('operation-status').removeAttribute('aria-busy'); if (trigger?.isConnected && trigger instanceof HTMLButtonElement) trigger.disabled = previousDisabled; $('cancel-read').hidden = true; $('apply').disabled = !previewResults.length || work?.previewDirty === true; finishRead() }
}
function options(select, rows, label, placeholder, extra) {
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
    $('connect-title').textContent='智慧對應服務尚未就緒'; $('connect-detail').textContent='請更新 EduLog API 並套用 1000120 migration，再重新驗證。舊工作檢查點保留。'; show('connect'); $('workspace').hidden=true; return
  }
  if (!data.status.capabilities?.catalog_v1) {
    $('connect-title').textContent = 'EduLog 目錄服務尚未就緒'; $('connect-detail').textContent = '請在 EduLog API 套用 1000119 migration，再重新驗證。現有工作不會被清除。'; show('connect'); $('workspace').hidden = true; return
  }
  if (!data.status.capabilities?.teaching_data_import || !data.status.capabilities?.report_prefill) {
    $('connect-title').textContent = '伺服器整合尚未就緒'; $('connect-detail').textContent = '請更新 EduLog API 並套用 1000118 migration，再重新驗證。'; show('connect'); $('workspace').hidden = true; return
  }
  $('instance-label').textContent = binding.instance
  $('connect').hidden = true; show('workspace')
  options($('source-tab'), tabs, t => `${t.title || '支援網站'} · ${t.path}`, '選擇支援網站分頁')
  if (tabs.some(t => t.id === Number(params.get('source')))) $('source-tab').value = params.get('source')
  context = { classrooms: [], courses: [], class_sessions: [], students: [], enrollments: [], occurrences: [], report_targets: [], lessons: [], source_links: [], permissions: {} }
  if ($('source-tab').value) await changeSource()
  else { $('source-label').textContent = '尚未選擇來源；請先開啟支援網站的班級頁或報告表單，再選取分頁。'; $('collect').disabled = true; $('read-form').disabled = true; notice('連線已驗證。尚未選取來源分頁；匯入與預填入口暫不可用。') }
  flow(params.get('flow') || 'import')
}
async function changeSource() {
  const current = ++generation; form = null; report = null; previewResults = []; work = null
  const tab = tabs.find(t => t.id === Number($('source-tab').value)); selectedPath = tab?.path || ''
  sourceContext = null; classSourceReady = false; reportSourceReady = false
  if (!tab) { $('source-label').textContent = '尚未選擇來源分頁'; $('collect').disabled = true; $('read-form').disabled = true; return }
  const c = await source('context'); if (current !== generation) return
  sourceContext = c; classSourceReady = Boolean(c?.classId); reportSourceReady = Boolean(c?.reportOpen)
  $('collect').disabled = !classSourceReady; $('read-form').disabled = !reportSourceReady
  if (!classSourceReady && !reportSourceReady) { $('source-label').textContent = `${tab.title || tab.path} · 來源班級或報告表單尚未辨識；請在來源分頁開啟班級頁或「記錄」表單後重試。`; notice('目前來源沒有可讀取的班級或報告表單；匯入與預填入口暫不可用。'); return }
  $('source-label').textContent = `${c.sourceOrigin} · ${c.title || c.sourcePath} · ${c.sourcePath}`
  notice(classSourceReady ? '已辨識來源班級，可開始擷取。' : '已辨識報告表單，可開始預填。')
  for (const id of ['mapping','preview-section','import-progress','target-summary','report-picker','field-review','prefill-result']) $(id).hidden = true
}
function linked(kind, id) { const row = context.source_links.find(l => l.source_origin === 'https://corp.orangeapple.co' && l.source_kind === kind && l.source_id === id); return row?.valid === false ? undefined : row?.edulog_id || row?.target_id }
function idFor(kind, id) { const key = `${kind}:${id}`; return linked(kind, id) || (work.ids[key] ||= crypto.randomUUID()) }
function labelledInput(parent, title, type, id, value = '') { const label = node('label', title), input = node('input'); input.type = type; input.id = id; input.value = value; label.htmlFor = id; parent.append(label, input); return input }
const mappingController = createMappingController({ capabilities: () => integrationCapabilities, settingsUrl: () => frontendSettingsUrl, rereadSource: () => source('collect'),state:()=>({work,context}),generation:()=>generation,readGeneration:()=>activeReadGeneration,api,catalog,run:(action,options)=>options?.readOnly?runLatest(action,options):run(action,options),notice,idFor,loadClassrooms,loadMappingCourses})
async function mappingView() {
  $('operation-title').textContent='正在解析已確認的對應';
  await mappingController.mount(); show('mapping'); stage('import','preview'); $('mapping').scrollIntoView({block:'start'})
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
  work = { id: crypto.randomUUID(), type: 'import', status: 'collected', sourceTab: Number($('source-tab').value), sourcePath: selectedPath, title: snapshot.title, snapshot, ids: {}, dateFrom: $('date-from').value, dateTo: $('date-to').value, includeInternalNotes: $('include-internal-notes').checked, done: 0 }
  if ($('read-history').checked) work.history = { paths: snapshot.admissionPaths, next: 0 }
  await save(); if (work.history) await collectHistory()
  await mappingView(); notice(`已擷取 ${work.snapshot.records.length} 筆可辨識資料。缺少欄位仍需確認。${work.status === 'paused-extraction' ? '擷取中斷，可從工作紀錄繼續。' : ''}`)
}
async function collectHistory() {
  paused = false; work.status = 'collecting'; await save()
  try {
    while (work.history.next < work.history.paths.length && !paused) {
      const records = await source('history', { workId: work.id, historyPath: work.history.paths[work.history.next] })
      work.snapshot.records = mergeRecords(work.snapshot.records,records)
      work.history.next++; await save(); notice(`已擷取 ${work.history.next} / ${work.history.paths.length} 份學習紀錄。`)
    }
    work.status = paused ? 'paused-extraction' : 'collected'; await save()
  } catch (error) { work.status = 'paused-extraction'; work.collectionError = error.message; await save() }
}
function prepareRows() {
  work.includeInternalNotes = $('include-internal-notes').checked
  const eligible = new Set(work.snapshot.records.filter(r=>r.kind==='enrollment'&&mappingController.validateRow(r)).map(r=>r.source_id))
  if (!eligible.size) throw new Error('目前沒有可匯入的報名。請查看各筆核對提示，完成既有報名查詢與對應後再產生差異。')
  const courseIds = [...new Set(work.snapshot.records.filter(r=>eligible.has(r.source_id)&&r.kind==='enrollment').map(r=>$(`enrollment-course-${r.source_id}`).value))], courseId = courseIds[0]
  const sessionId = $('class-session').value === 'new' ? idFor('class_session', work.snapshot.classId) : $('class-session').value
  if (!$('classroom').value || !courseId || !sessionId) throw new Error('請選擇目標教室、班級及各筆報名的課程。')
  const rows = [], needs = []
  if (work.history && work.history.next < work.history.paths.length) needs.push(`尚有 ${work.history.paths.length - work.history.next} 份來源紀錄未完成擷取。`)
  const add = (kind, sourceId, targetId, data) => rows.push({ source_id: sourceId, target_id: targetId, overwrite: [], record: { kind, data } })
  rows.push(...mappingController.courseRows().filter(r=>courseIds.includes(r.target_id)))
  const session = context.class_sessions.find(s => s.id === sessionId)
  let schedule
  if ($('class-session').value === 'new') {
    if (!$('session-name').value.trim() || !$('session-start').value || $('session-day').value === '' || !$('session-from').value || !$('session-to').value || $('session-from').value >= $('session-to').value) throw new Error('請補齊班級名稱、開班日期、星期及有效原站時段。')
    schedule = { name: $('session-name').value.trim(), start_date: $('session-start').value, day_of_week: Number($('session-day').value), start_time: $('session-from').value, end_time: $('session-to').value }
  } else {
    if (!session?.start_time || !session.end_time || session.day_of_week == null || !session.start_date) throw new Error('此班級不是完整週間排程，請在 EduLog 確認時段後再匯入。')
    schedule = { name: session.name, start_date: session.start_date, day_of_week: session.day_of_week, start_time: session.start_time, end_time: session.end_time }
    needs.push('原站班級時間未完整辨識；保留所選 EduLog 班級排程。')
  }
  if(session&&courseIds.some(id=>!session.course_ids.includes(id))&&!context.permissions.session?.class_update)throw new Error('此班級缺少所選課程，且你沒有修改班級權限。請改選可上課程或請管理員處理。')
  add('class_session', work.snapshot.classId, sessionId, { ...schedule, classroom_id: $('classroom').value, course_ids: [...new Set([...(session?.course_ids || []), ...courseIds])], time_zone: 'Asia/Taipei', external_link: `https://corp.orangeapple.co/courses/dt/${work.snapshot.classId}` })
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
    work.sourceRosterEntries.push({ id, start_date: start, status })
    add('enrollment',r.source_id,id,{student_id:studentId,course_id:chosenCourse,class_session_id:sessionId,classroom_id:$('classroom').value,status,start_date:start,time_zone:'Asia/Taipei',external_link:r.data.external_link})
    rows.at(-1).source_identity=admissionIdentity(r)
  }
  const dates = new Set()
  for (const r of work.snapshot.records.filter(r => r.kind === 'report')) {
    if (!r.date || !enrollments.has(r.enrollment_source_id)) { needs.push(`報告 ${r.source_id} 缺少完整日期或報名對應。`); continue }
    if (r.date < work.dateFrom || r.date > work.dateTo) continue
    const occurrenceSource = `${work.snapshot.classId}:${r.date}`, occurrenceId = idFor('occurrence', occurrenceSource)
    const occurrenceChoice = $(`occurrence-${r.date}`)?.value, reportChoice = $(`report-${r.source_id}`)?.value
    if (!occurrenceChoice || !reportChoice) { needs.push(`報告 ${r.source_id} 尚未確認課次與報告對應。`); continue }
    const chosenOccurrence = occurrenceChoice === 'new' ? occurrenceId : occurrenceChoice
    if(!mappingController.validateReport(r,enrollments.get(r.enrollment_source_id),chosenOccurrence)){needs.push(`報告 ${r.source_id} 的課次與單次調課紀錄不一致或紀錄尚未讀完，請前往 EduLog 核對。`);continue}
    const mapped = mappedReport(r,enrollmentCourses.get(r.enrollment_source_id),context.lessons)
    if(mapped.needs.length){needs.push(`報告 ${r.source_id}：${mapped.needs.join('；')}，暫不匯入此報告。`);continue}
    const reportData = { enrollment_id: enrollments.get(r.enrollment_source_id), class_occurrence_id: chosenOccurrence, external_link: r.data.external_link }
    for (const key of ['content','contact_notes','attendance_status','absence_reason','is_completed','class_participation','classroom_behavior','lesson_id','progress_letter']) if (mapped.data[key] !== undefined && mapped.data[key] !== '') reportData[key] = mapped.data[key]
    if (work.includeInternalNotes && r.sourceInternalNotes) reportData.class_notes = r.sourceInternalNotes
    if (!Object.keys(reportData).some(key => !['enrollment_id','class_occurrence_id','external_link'].includes(key))) {
      needs.push(`報告 ${r.source_id} 沒有可匯入的教學欄位；只保留來源編輯連結，未建立空白報告。`)
      continue
    }
    if (!dates.has(r.date)) { dates.add(r.date); add('occurrence', occurrenceSource, chosenOccurrence, { class_session_id: sessionId, occurrence_date: r.date, original_start_time: schedule.start_time, original_end_time: schedule.end_time, time_zone: 'Asia/Taipei' }) }
    add('report', r.source_id, reportChoice === 'new' ? idFor('report', r.source_id) : reportChoice, reportData)
  }
  work.destination = { classroom_id: $('classroom').value, course_ids: courseIds, class_session_id: sessionId }; work.needs = needs
  return rows
}
async function preview(reuse = false) {
  if (!work || work.type !== 'import') throw new Error('請先擷取目前班級。')
  if (!reuse) {
    if (work.jobId && (work.done > 0 || ['applying','outcome_unknown','failed'].includes(work.status))) throw new Error('此工作已有寫入或待確認檢查點。請使用「檢查並續傳」核對原批次，不能重新建立工作。')
    if (batchBytes < 4096) throw new Error('API 請求大小設定過小，請調整 API_BODY_LIMIT。')
    await mappingController.resolveFieldRules()
    await mappingController.verifyReportRelationships()
    const batches = splitBatches(prepareRows(), batchBytes)
    if (!batches.length) throw new Error('沒有可產生差異的資料，請先核對來源與目標。')
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
function renderDifferences() {
  $('diff-list').replaceChildren(); const totals = { added: 0, updated: 0, unchanged: 0, conflict: 0 }
  previewResults.forEach(result => result.rows.forEach((row, rowIndex) => {
    const batchIndex = result.batchIndex
    totals[row.status]++; const details = node('details'), summary = node('summary', `${labels[row.kind]} · ${row.source_id} · ${labels[row.status]}`); details.append(summary)
    if (row.kind === 'class_session' && row.status !== 'added' && JSON.stringify(row.before.course_ids) !== JSON.stringify(row.after.course_ids)) { details.open = true; summary.textContent = '加入班級可上課程 · 需要明確確認'; details.append(node('p','只追加本次確認的課程，保留班級原有課程與排程。','hint')) }
    for (const key of Object.keys(row.after)) {
      const diff = node('div', undefined, 'diff'), before = node('div'), after = node('div')
      before.append(node('strong', `${fieldLabels[key] || key} · EduLog`), node('span', displayValue(key, row.before[key])))
      after.append(node('strong', `${fieldLabels[key] || key} · 來源`), node('span', displayValue(key, row.after[key])))
      details.append(diff); diff.append(before, after)
      if (row.status !== 'added' && JSON.stringify(row.before[key]) !== JSON.stringify(row.after[key]) && (!['student_id','course_id','classroom_id','class_session_id','course_ids','enrollment_id','class_occurrence_id','start_date','day_of_week','start_time','end_time','time_zone','occurrence_date','original_start_time','original_end_time'].includes(key) || row.kind === 'class_session' && key === 'course_ids' && context.permissions.session?.class_update)) {
        const label = node('label', undefined, 'check'), check = node('input'); check.type = 'checkbox'; check.checked = work.batches[batchIndex].rows[rowIndex].overwrite.includes(key)
        label.append(check, node('span', key === 'course_ids' ? '我確認追加選定課程到班級可上課程（保留原有課程與排程）' : `明確改用來源「${fieldLabels[key] || key}」`)); details.append(label)
        check.addEventListener('change', () => { const target = work.batches[batchIndex].rows[rowIndex]; target.overwrite = check.checked ? [...target.overwrite, key] : target.overwrite.filter(k => k !== key); work.previewDirty = true; $('apply').disabled = true; notice('欄位選擇已變更，請按「更新差異」。') })
      }
    }
    $('diff-list').append(details)
  }))
  work.batchSummaries ||= {}
  for (const result of previewResults) work.batchSummaries[work.batches[result.batchIndex].key] = summarizeImportRows(result.rows || [])
  $('counts').textContent = [...Object.entries(totals).map(([k, v]) => `${labels[k]} ${v}`), `需處理 ${work.needs.length}`].join(' · ')
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
  const title = node('h3', work.status === 'complete' ? '匯入批次已核驗完成' : '本次匯入尚有資料待處理')
  host.append(title)
  const totals = {}
  for (const key of work.appliedBatchKeys || []) mergeImportSummary(totals, work.batchSummaries?.[key])
  for (const kind of ['student','enrollment','occurrence','report']) {
    const states = totals[kind]
    if (!states) continue
    const text = [`新增 ${states.added || 0}`,`更新 ${states.updated || 0}`,`無變更 ${states.unchanged || 0}`,`保留 EduLog ${states.conflict || 0}`].join(' · ')
    host.append(node('p', `${labels[kind]}：${text}`))
  }
  if (!Object.keys(totals).length && work.done) host.append(node('p','此工作由舊版擴充套件建立，沒有保留逐類結果；可查詢伺服器批次與有效名單。','hint'))
  if (work.needs?.length) host.append(node('p', `另有 ${work.needs.length} 項未匯入或需處理；批次完成不代表來源資料已全部同步。`, 'hint'))
  if (work.rosterVerification) {
    const v = work.rosterVerification
    host.append(node('p', `${v.date} 有效名單核對：EduLog ${v.actual} 人；來源應有 ${v.expected} 人；缺少 ${v.missing.length} 人；其他 ${v.extra.length} 人。`))
    if (v.missing.length || v.extra.length) host.append(node('p', `名單有差異：${[...v.missing.map(id=>`缺少 ${id.slice(0,8)}`),...v.extra.map(id=>`EduLog 另有 ${id.slice(0,8)}`)].join('、')}`, 'hint'))
  } else if (work.rosterCheckError) host.append(node('p',`有效名單核對暫時失敗：${work.rosterCheckError}。可在工作紀錄重新查詢。`,'hint'))
}
function displayValue(key, value) {
  if (value == null) return '—'
  if (key === 'is_completed') return value ? '課程已完成' : '課程未完成'
  if (key === 'status') return ({ regular: '正式', trial: '試讀', completed: '完課', dropped: '退班' })[value] || String(value)
  const resource = { classroom_id: 'classrooms', course_id: 'courses', course_ids: 'courses', student_id: 'students', class_session_id: 'class_sessions', lesson_id: 'lessons' }[key]
  if (resource) return (Array.isArray(value) ? value : [value]).map(id => { const item = context[resource].find(r => r.id === id); return item?.name || item?.display_name || item?.title || (item?.subject ? `${item.subject} ${item.stage}` : `待建立／對應 ${String(id).slice(0, 8)}`) }).join('、')
  return String(value)
}
function progress() {
  show('import-progress'); $('progress').max = work.batchCount || 1; $('progress').value = work.done || 0
  $('progress-label').textContent = `已完成 ${work.done || 0} / ${work.batchCount || 0} 批。${work.needs?.length || 0} 項仍需處理。`
  $('resume').hidden = !['paused','failed','outcome_unknown'].includes(work.status)
  $('pause').hidden = work.status !== 'applying'; $('cancel-work').hidden = ['complete','cancelled'].includes(work.status)
  $('operation-status').hidden = false
  $('operation-status').dataset.state = work.status === 'applying' ? 'loading' : ['failed','outcome_unknown'].includes(work.status) ? 'error' : 'complete'
  $('operation-title').textContent = ({ applying:'正在寫入匯入批次', paused:'匯入已暫停', failed:'匯入部分失敗', outcome_unknown:'寫入結果尚未確認', complete:'匯入批次已完成', cancelled:'已取消剩餘批次' })[work.status] || '匯入進度'
  $('operation-detail').textContent = `已核對 ${work.done || 0} / ${work.batchCount || 0} 批；${work.needs?.length || 0} 筆需處理。取消不會撤回已完成批次。`
  $('operation-progress').hidden = !work.batchCount; $('operation-progress').max = work.batchCount || 1; $('operation-progress').value = work.done || 0
  if (work.status === 'complete' || work.status === 'partial_complete') renderImportOutcome()
}
function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}-${parts.find(p=>p.type==='day').value}`
}
async function finalizeImport() {
  const keys = work.batches.map(batch => batch.key)
  const completed = await api('complete', { expected_batch_keys: keys }, { jobId: work.jobId })
  work.status = completed.verified === true ? 'complete' : 'partial_complete'
  work.appliedBatchKeys = keys
  try {
    const info = await api('import-info', undefined, { jobId: work.jobId, query: { roster_date: taipeiToday() } })
    const roster = info.roster?.enrollments || []
    const sessionId = work.destination?.class_session_id
    const expected = [...new Set((work.sourceRosterEntries || []).filter(row => row.start_date <= info.roster_date && ['regular','completed'].includes(row.status)).map(row => row.id))]
    const actual = [...new Set(roster.filter(row => !sessionId || row.class_session_id === sessionId).map(row => row.id))]
    work.rosterVerification = { date: info.roster_date, expected: expected.length, actual: actual.length, missing: expected.filter(id => !actual.includes(id)), extra: actual.filter(id => !expected.includes(id)) }
    work.serverImportSummary = {
      status: info.job?.status,
      batchCount: info.batches?.length || 0,
      appliedRows: (info.batches || []).reduce((sum, batch) => sum + (batch.applied || 0), 0),
      kinds: (info.batches || []).reduce((sum, batch) => mergeImportSummary(sum, batch.counts || {}), {}),
    }
  } catch (error) {
    work.rosterVerification = null
    work.rosterCheckError = error.message
  }
  delete work.sourceRosterEntries
  await save(); progress()
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
  context.source_links=[]; const mapped=await api('resolve',{source_refs:[{source_kind:'enrollment',source_id:form.admissionId}],target_refs:[],memory_refs:[{kind:'admission',key:form.admissionId}]}); const memory=(mapped.memories||[]).find(m=>m.valid&&!m.suggestion); const linked=(mapped.source_links||[]).find(m=>m.valid!==false); form.targetEnrollmentId=memory?.target_id||linked?.target_id||null; form.targetStudentId=memory?.student_id; form.targetCourseId=memory?.course_id;
  work = { id: crypto.randomUUID(), type: 'prefill', status: 'reviewing', sourceTab: Number($('source-tab').value), sourcePath: selectedPath, title: form.title || `原站報告 ${form.reportId}`, form }
  await save(); $('target-title').textContent = `${form.targetEnrollmentId ? '已沿用報名對應 · ' : ''}${form.title || '請核對原站學生'} · 報名 ${form.admissionId} · 報告 ${form.reportId}`; $('target-date').value = form.date || ''; $('target-confirm').checked = false
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
  fieldRules=[];if(integrationCapabilities.field_mapping_memory&&form.targetCourseId){const result=await api('field-resolve',{source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',items:form.fields.filter(f=>f.type!=='text').map(f=>({field_key:f.key,course_id:form.targetCourseId,options_signature:globalThis.edulogFieldMappings.signature(f)}))});fieldRules=result.items||[]}
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
    const original=globalThis.edulogFieldMappings.display(field,{...report,lesson_name:report.lesson_name||lesson?.title})
    card.append(node('p', `EduLog：${original}`, 'hint'))
    const input = node(field.type === 'text' ? 'textarea' : 'select'); input.id = `field-${field.key}`; input.dataset.value = ''; input.disabled = field.disabled
    if (field.type !== 'text') { input.append(new Option('請人工確認選項', '')); field.options.filter(o => !o.disabled && o.value).forEach(o => input.append(new Option(o.label || o.value, o.value))) }
    input.value = field.type === 'text' ? plainText(suggested) : suggested
    const valueLabel = node('label', `確認${field.label}值`); valueLabel.htmlFor = input.id; card.append(valueLabel, input)
    if (!suggested && field.type !== 'text') card.append(node('p', '未建立可靠選項對應。請依 EduLog 報告人工選擇原站選項。', 'hint'))
    if(consistent)card.append(node('p','內容一致，保留原站；不需覆寫。','field-mapping-status'))
    if (field.value&&!consistent) { const overwriteLabel = node('label', undefined, 'check'), overwrite = node('input'); overwrite.type = 'checkbox'; overwrite.dataset.overwrite = ''; overwriteLabel.append(overwrite, node('span', '我確認覆寫此欄原站內容')); card.append(overwriteLabel) }
    const selectedReport=report,selectedWork=work;globalThis.edulogFieldMappingUI.attach(card,field,report,fieldRules,{enabled:integrationCapabilities.field_mapping_memory&&Boolean(form.targetCourseId),sourceValue:input.value,lessons:context.lessons,confirm:item=>api('field-confirm',{source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',items:[{...item,course_id:form.targetCourseId}]}),isCurrent:()=>report===selectedReport&&work===selectedWork,changed:()=>{if(!check.checked)input.value=suggestedValue(field,report,fieldRules)}});
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
async function loadWork() {
  const [localResult, remoteResult] = await Promise.allSettled([send({ type: 'workspace-store', action: 'list' }), api('work')])
  const local = localResult.status === 'fulfilled' ? localResult.value : null
  const remote = remoteResult.status === 'fulfilled' ? remoteResult.value : null
  $('work-list').replaceChildren()
  if (!local) {
    const card = node('article', undefined, 'card'); card.append(node('h2', '本機工作暫時無法讀取'), node('p', '工作資料庫連線已中斷。請重新整理以重新開啟連線；已儲存的工作資料不會因這次讀取失敗而刪除。', 'hint'))
    const retry = node('button', '重試讀取本機工作'); retry.addEventListener('click', () => void runLatest(loadWork, { label: '正在重新開啟本機工作資料庫' })); card.append(retry); $('work-list').append(card)
  }
  for (const row of (local || []).sort((a, b) => b.updatedAt - a.updatedAt)) {
    const card = node('article', undefined, 'card'); const statusText = ({ applying:'寫入中', paused:'已暫停', failed:'部分失敗', outcome_unknown:'結果尚未確認', complete:'已完成', cancelled:'已取消剩餘批次', collected:'已擷取，待確認對應', collecting:'擷取中', 'paused-extraction':'擷取已暫停', reviewing:'待檢查欄位', pending_confirmation:'待人工送出／待確認' })[row.status] || '狀態需確認'; card.append(node('h2', row.title || row.id), node('p', `${row.type === 'import' ? '教學資料匯入' : '報告預填'} · ${statusText} · ${new Date(row.updatedAt).toLocaleString()}`))
    if (row.type === 'import' && row.batches && !['complete','cancelled'].includes(row.status)) {
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
        flow('import'); if (row.history) await collectHistory(); await mappingView(); notice('已恢復來源資料，請確認對應。')
      })); card.append(resume)
    }
    if (row.type === 'prefill' && row.push && !row.pushRecorded) {
      const retry = node('button', '重試回寫待確認紀錄'); retry.addEventListener('click', () => void run(async () => { await api('push', row.push); await send({ type: 'workspace-store', action: 'put', work: { ...row, pushRecorded: true } }); notice('待確認紀錄已回寫；原站表單未再次套用。'); await loadWork() })); card.append(retry)
    }
    if (row.type === 'prefill' && row.status === 'applying') card.append(node('p', '上次套用回應中斷，請到原站確認內容。不會自動重複套用。'))
    $('work-list').append(card)
  }
  if (local && !local.length) $('work-list').append(node('p', '此瀏覽器沒有未完成工作。'))
  if (!remote) {
    const remoteError = node('article', undefined, 'card'); remoteError.append(node('h2', 'EduLog 工作紀錄暫時無法載入'), node('p', '本機續傳資料仍可查看。請確認連線後重試伺服器紀錄。', 'hint'))
    const retryRemote = node('button', '重試載入 EduLog 紀錄'); retryRemote.addEventListener('click', () => void runLatest(loadWork, { label: '正在重新載入 EduLog 工作紀錄' })); remoteError.append(retryRemote); $('work-list').append(remoteError)
    notice('工作紀錄部分載入失敗；本機與伺服器資料分開保留。', true); return
  }
  const d = node('details'); d.append(node('summary', `EduLog 紀錄：${remote.imports.length} 個匯入／${remote.pushes.length} 個預填`))
  const statusText = status => ({ queued:'排隊中', collecting:'擷取中', previewed:'待確認差異', applying:'匯入中', paused:'已暫停', failed:'部分失敗', outcome_unknown:'結果尚未確認', complete:'已完成', cancelled:'已取消剩餘批次', pending_confirmation:'待人工確認', confirmed:'已確認' })[status] || '狀態待確認'
  remote.imports.forEach(r => {
    const item=node('div',undefined,'row-card'); item.append(node('p',`來源班級 ${r.source_class_id || '—'} · ${statusText(r.status)} · 批次內已處理 ${r.counts.applied || 0} 筆`))
    const inspect=node('button','查詢批次與有效名單');inspect.type='button';inspect.addEventListener('click',()=>void runLatest(async()=>{
      const info=await api('import-info',undefined,{jobId:r.id,query:{roster_date:taipeiToday()}}), roster=info.roster?.enrollments||[]
      const panel=node('div',undefined,'hint');panel.append(node('p',`伺服器狀態：${statusText(info.job?.status)} · ${info.batches?.length||0} 個批次 · 核對日期 ${info.roster_date}`),node('p',`有效名單：${roster.length} 筆。批次筆數是已處理資料列，不代表名單或報告筆數。`))
      for(const batch of info.batches||[])panel.append(node('p',`批次 ${batch.key.slice(0,8)} · ${batch.status==='applied'?'已提交':'尚未提交'} · ${batch.applied} 筆`))
      item.append(panel);inspect.disabled=true;notice('已讀取伺服器批次檢查點與目標班級有效名單。')
    },{label:'正在核對伺服器批次與班級名單'}));item.append(inspect);d.append(item)
  })
  remote.pushes.forEach(r => d.append(node('p', `報告 ${r.report_id.slice(0, 8)} · ${r.status === 'confirmed' ? '已確認' : '待人工送出／待確認'}`)))
  $('work-list').append(d); notice('工作紀錄已更新。')
}
document.querySelectorAll('[data-flow]').forEach(b => b.addEventListener('click', () => flow(b.dataset.flow)))
$('source-tab').addEventListener('change', () => void runLatest(changeSource, { label: '正在讀取來源班級' }))
$('classroom-search').addEventListener('input', () => { clearTimeout(mappingSearchTimer); mappingSearchTimer = setTimeout(() => void runLatest(() => loadClassrooms(true), { label: '正在搜尋目標教室' }), 300) })
$('more-classrooms').addEventListener('click', () => void runLatest(() => loadClassrooms(false), { label: '正在載入更多教室候選' }))
$('mapping-course-search').addEventListener('input', () => { clearTimeout(mappingSearchTimer); mappingSearchTimer = setTimeout(() => void runLatest(() => loadMappingCourses(true), { label: '正在搜尋目標課程' }), 300) })
$('more-mapping-courses').addEventListener('click', () => void runLatest(() => loadMappingCourses(false), { label: '正在載入更多課程候選' }))
$('classroom').addEventListener('change', () => void runLatest(async () => { await updateDestinations(); await loadScopedMappingData(); updateMappingOptions() }, { label: '正在查詢教室與課程候選' }))
$('course').addEventListener('change', () => void runLatest(async () => { await updateDestinations(); await loadScopedMappingData(); updateMappingOptions() }, { label: '正在查詢班級候選' }))
$('class-session').addEventListener('change', () => void runLatest(async () => { $('new-session').hidden = $('class-session').value !== 'new'; await loadScopedMappingData(); updateMappingOptions() }, { label: '正在查詢學生報名與課次' }))
$('course-source-id').addEventListener('change', updateMappingOptions)
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
bridge.onInvalidated(() => { paused = true; ++generation; notice('擴充套件已更新，請重新開啟工作分頁；已保存檢查點可續傳。', true) })
document.querySelectorAll('input,select,textarea').forEach(input => { if (!input.name) input.name = input.id; input.autocomplete = 'off' })
document.addEventListener('input', event => {
  if (!work || !event.target.closest('#mapping')) return
  unsaved = true; work.mappingDirty = true; work.previewDirty = true; $('apply').disabled = true
  work.revision = (work.revision || 0) + 1
  clearTimeout(editTimer)
  const editingId = work.id
  editTimer = setTimeout(() => {
    if (work?.id !== editingId || busy) return
    captureMappingChoices()
    void save().catch(() => { unsaved = true; notice('對應選擇尚未儲存，請保留此分頁並重試。', true) })
  }, 250)
})
window.addEventListener('beforeunload', event => { if (unsaved || busy) { event.preventDefault(); event.returnValue = '' } })
void run(async () => { try { await initialize() } catch (error) { show('connect'); $('workspace').hidden = true; throw error } }, { label: '正在驗證連線與檢查工作台能力', readOnly: true })
