import { workStore } from '../shared/work-store.js'
import { frontendBase, openPanel, panelFailed, preparePanel, readChannel, PANEL_PAGE } from './editor-panel.js'
const supported = url => { try { const u = new URL(url), adapter = globalThis.edulogSiteAdapter; return u.origin === 'https://corp.orangeapple.co' && Boolean(adapter.matchesIntegrationPage?.(u.pathname) ?? adapter.matchesTeachingPage(u.pathname)) } catch { return false } }
// A field count reported by a site page, as a small whole number.
const fillCount = value => Number.isInteger(value) ? Math.min(Math.max(value, 0), 50) : 0
const fail = (message, code) => { const error=new Error(message);if(code)error.code=code;throw error }
function validationFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined
  return Object.fromEntries(Object.entries(fields).slice(0, 20).filter(([, values]) => Array.isArray(values)).map(([key, values]) => [key.slice(0, 100), values.filter(value => typeof value === 'string').slice(0, 10).map(value => value.slice(0, 500))]))
}
export function installWorkspaceBroker(getStatus) {
  void workStore.purge().catch(() => { /* Workspace operations report storage failures when opened. */ })
  const requests = new Set()
  const cancelledReads = new Set()
  chrome.storage.onChanged?.addListener((changes, area) => {
    const change = changes.edulogExtension
    if (area === 'local' && change && (change.oldValue?.origin !== change.newValue?.origin || change.oldValue?.token !== change.newValue?.token || change.oldValue?.userId !== change.newValue?.userId)) for (const request of requests) request.controller.abort('connection-changed')
  })
  const trusted = sender => sender.id === chrome.runtime.id && sender.url?.split('?')[0] === chrome.runtime.getURL('workspace/workspace.html')
  const entry = sender => sender.id === chrome.runtime.id && (sender.url === chrome.runtime.getURL('popup/popup.html') || supported(sender.url))
  async function binding(expected) {
    const status = await getStatus(), current = (await chrome.storage.local.get('edulogExtension')).edulogExtension
    if (status.status !== 'connected' || !current?.userId) fail('請先連接並驗證你的 EduLog。')
    const value = { instance: current.origin, userId: current.userId }
    if (expected && (value.instance !== expected.instance || value.userId !== expected.userId)) fail('EduLog 實例或使用者已變更，工作已停止。')
    return { ...value, token: current.token, status }
  }
  async function source(message) {
    if (!Number.isInteger(message.tabId)) fail('請選擇來源分頁。')
    let tab
    try { tab = await chrome.tabs.get(message.tabId) } catch { fail('來源分頁已關閉。請重新開啟支援網站並選取新的來源分頁。','SOURCE_CLOSED') }
    if (!supported(tab.url) || (message.sourcePath && new URL(tab.url).pathname !== message.sourcePath)) fail('來源分頁已關閉或導覽，請重新選擇來源。','SOURCE_CHANGED')
    return tab
  }
  async function api(message) {
    const startedAt = Date.now()
    let verificationTimer
    let bound
    try {
      bound = await Promise.race([
        binding(message.binding),
        new Promise((_, reject) => { verificationTimer = setTimeout(() => { const error = new Error('連線驗證與 API 查詢超過 30 秒。'); error.code = 'API_TIMEOUT'; reject(error) }, 30000) }),
      ])
    } finally { clearTimeout(verificationTimer) }
    const operations = {
      'history-list':['GET','/history-reports'], 'history-route':['POST','/history-reports/route'], 'history-detail':['GET',`/history-reports/${message.historyId}`],
      'history-candidates':['GET',`/history-reports/${message.historyId}/candidates`],
      'history-bind-preview':['POST',`/history-reports/${message.historyId}/bind/preview`], 'history-bind-apply':['POST',`/history-reports/${message.historyId}/bind/apply`],
      reconcile: ['GET', `/enrollments/${message.enrollmentId}/reconciliation`],
      'import-info': ['GET', `/imports/${message.jobId}`], complete: ['POST', `/imports/${message.jobId}/complete`],
      'enrollment-info': ['GET', `/enrollments/${message.enrollmentId}`],
      'field-resolve':['POST','/field-mappings/resolve'], 'field-confirm':['POST','/field-mappings/confirm'], 'sync-preferences-get':['GET','/sync-preferences'], 'sync-preferences-save':['PATCH','/sync-preferences'], context: ['GET', '/context'], catalog: ['GET', '/catalog'], resolve: ['POST', '/catalog/resolve'], confirm: ['POST', '/catalog/confirm'], reports: ['GET', '/reports'], work: ['GET', '/work'], map: ['POST', '/source-links'],
      job: ['POST', '/imports'], preview: ['POST', `/imports/${message.jobId}/preview`], apply: ['POST', `/imports/${message.jobId}/apply`],
      'job-status': ['PATCH', `/imports/${message.jobId}`], push: ['POST', '/report-pushes'],
      'work-records':['GET','/work-records'], 'work-record-save':['PATCH',`/work-records/${message.workId}`],
      'attendance-evidence':['POST','/attendance-evidence'],
      'report-decisions-resolve':['POST','/report-decisions/resolve'], 'report-decisions-confirm':['POST','/report-decisions/confirm'],
    }
    if (message.operation === 'reconcile' && !/^[a-f0-9-]{36}$/i.test(message.enrollmentId || '')) fail('報名識別碼不正確。')
    if (['history-detail','history-candidates','history-bind-preview','history-bind-apply'].includes(message.operation) && !/^[a-f0-9-]{36}$/i.test(message.historyId||'')) fail('歷史報告識別碼不正確。')
    if (!operations[message.operation] || (['preview', 'apply', 'job-status', 'import-info', 'complete'].includes(message.operation) && !/^[a-f0-9-]{36}$/.test(message.jobId)) || (message.operation === 'work-record-save' && !/^[a-f0-9-]{36}$/i.test(message.workId||'')) || (message.operation === 'enrollment-info' && !/^[a-f0-9-]{36}$/i.test(message.enrollmentId || ''))) fail('工作操作不正確。')
    const [method, path] = operations[message.operation], url = new URL(`${bound.instance}/api/extension/v1${path}`)
    if (method === 'GET' && message.query && message.operation !== 'work-records') for (const [key, value] of Object.entries(message.query)) { if (value == null || value === '') continue; if (!['offset','id','resource','classroom_id','course_id','class_session_id','student_id','enrollment_id','class_occurrence_id','date_from','date_to','search','cursor','limit','summary','roster_date','sort','anchor_date','exclude_course_id','source_admission_id','unlinked_only','source_origin','adapter_version'].includes(key) || String(value).length > (key==='cursor'?160:100)) fail('查詢格式不正確。'); url.searchParams.set(key, String(value)) }
    if (message.operation === 'work-records' && message.query) for (const [key,value] of Object.entries(message.query)) { if(value==null||value==='')continue;if(!['limit','cursor'].includes(key)||String(value).length>100)fail('工作紀錄查詢格式不正確。');url.searchParams.set(key,String(value)) }
    const payload = method === 'GET' ? undefined : JSON.stringify(message.operation === 'complete' ? message.body : message.body)
    if (payload && new TextEncoder().encode(payload).byteLength > 200000) fail('批次過大，請拆分後再試。')
    const readOnly = ['history-list','history-route','history-detail','history-candidates','context','catalog','resolve','field-resolve','sync-preferences-get','reports','work','work-records','report-decisions-resolve','reconcile','import-info'].includes(message.operation)
    if (readOnly && message.requestId && !/^[a-f0-9-]{36}$/i.test(message.requestId)) fail('查詢識別碼不正確。')
    const remaining = 30000 - (Date.now() - startedAt)
    if (remaining <= 0) { const error = new Error('連線驗證與 API 查詢超過 30 秒。'); error.code = 'API_TIMEOUT'; throw error }
    const controller = new AbortController(), request = { controller, requestId: message.requestId, readOnly }; requests.add(request)
    const timer = setTimeout(() => controller.abort('timeout'), remaining)
    let response, body
    try {
      response = await fetch(url.href, { method, headers: { authorization: `Bearer ${bound.token}`, ...(payload ? { 'content-type': 'application/json' } : {}) }, body: payload, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal })
      body = await response.json().catch(() => null)
    }
    catch (error) { if (controller.signal.reason === 'timeout') { const timeout = new Error('API 查詢超過 30 秒。'); timeout.code = 'API_TIMEOUT'; throw timeout } if (controller.signal.reason === 'connection-changed') fail('EduLog 連線已變更，請重新開始查詢。'); if (controller.signal.reason === 'user-cancelled') { if (message.requestId) cancelledReads.delete(message.requestId); const cancelled = new Error('唯讀查詢已取消。'); cancelled.code = 'READ_CANCELLED'; throw cancelled } if (!error?.code) { const network = new Error('EduLog API 暫時無法連線。'); network.code = 'API_NETWORK_ERROR'; throw network } throw error }
    finally { clearTimeout(timer); requests.delete(request) }
    const current = (await chrome.storage.local.get('edulogExtension')).edulogExtension
    if (current?.origin !== bound.instance || current?.token !== bound.token) fail('連線已變更，請重新開啟工作。')
    if (!response.ok) return { error: { code: response.status === 429 ? 'RATE_LIMITED' : body?.error?.code || `HTTP_${response.status}`, message: body?.error?.message || 'API 無法完成操作。', fields: validationFields(body?.error?.fields), diagnosticSource: body?.error?.diagnostic_source, requestId: body?.error?.request_id, retryAfter: response.status === 429 ? Math.max(1, Math.min(3600, Number(response.headers?.get?.('retry-after')) || 0)) || null : null } }
    if (!body || !Object.hasOwn(body, 'data')) { const invalid = new Error('API 回應格式無法確認，請先檢查批次檢查點。'); invalid.code = 'API_RESPONSE_INVALID'; throw invalid }
    return { data: body?.data }
  }
  async function inlineTarget(form,bound) {
    const call=async message=>{const result=await api({...message,binding:{instance:bound.instance,userId:bound.userId}});if(result.error){const error=new Error(result.error.message);Object.assign(error,result.error);throw error}return result.data}
    const resolved=await call({operation:'resolve',body:{source_refs:[{source_kind:'enrollment',source_id:form.admissionId}],target_refs:[],memory_refs:[{kind:'admission',key:form.admissionId}]}})
    const memory=(resolved?.memories||[]).find(row=>row.valid&&!row.suggestion)
    const link=(resolved?.source_links||[]).find(row=>row.valid!==false)
    const manual=form.supplement?.binding?.instance===bound.instance&&form.supplement.binding.userId===bound.userId?form.supplement.enrollmentId:null
    const enrollmentId=manual||memory?.target_id||link?.target_id
    if(!enrollmentId)return null
    const enrollment=await call({operation:'enrollment-info',enrollmentId})
    if(!enrollment?.student_id || !enrollment.course_id)return null
    // Never let a stale remembered relationship override the current target.
    if(!manual && memory && (memory.student_id&&memory.student_id!==enrollment.student_id || memory.course_id&&memory.course_id!==enrollment.course_id))return null
    return {enrollmentId,studentId:enrollment.student_id,studentName:enrollment.student_name,courseId:enrollment.course_id,courseName:enrollment.course_name,classSessionId:enrollment.class_session_id,className:enrollment.class_name,userConfirmed:Boolean(manual)}
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'get-integration-work-summary' && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup/popup.html')) {
      void binding().then(async bound => {
        const rows = await workStore.list({ instance: bound.instance, userId: bound.userId })
        return { count: rows.filter(r => !['complete','cancelled'].includes(r.status)).length }
      }).then(respond, () => respond({ count: null }))
      return true
    }
    if (message?.type === 'open-integration-workspace' && entry(sender)) {
      void (async () => {
        const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
        const flow=message.flow === 'prefill' ? 'prefill' : message.flow === 'work' ? 'work' : 'import'
        const sourceTab=tab?.id&&supported(tab.url)?{id:tab.id,path:new URL(tab.url).pathname}:null
        const workspaces=await chrome.tabs.query({url:`${chrome.runtime.getURL('workspace/workspace.html')}*`})
        const existing=workspaces.find(candidate=>candidate.id!==sender.tab?.id)
        if(existing?.id){
          const bound=await binding()
          const reply=await chrome.tabs.sendMessage(existing.id,{type:'workspace-focus',flow,sourceTab,binding:{instance:bound.instance,userId:bound.userId}}).catch(()=>null)
          if(reply?.ok){await chrome.tabs.update(existing.id,{active:true});return{opened:true,reused:true}}
        }
        const url = new URL(chrome.runtime.getURL('workspace/workspace.html'))
        url.searchParams.set('flow', flow)
        if (sourceTab) url.searchParams.set('source', String(sourceTab.id))
        await chrome.tabs.create({ url: url.href, active: true })
        return { opened: true }
      })().then(respond, error => respond({ error: { code: 'WORKSPACE_UNAVAILABLE', message: error.message } }))
      return true
    }
    // 回填 from the EduLog web app in the side panel: the panel page has checked that the request came
    // from its own frame of the paired web app. Forwards the report id to the source form that opened
    // the panel, which fills it in (never submits it) and reports how many fields it filled.
    if (message?.type === 'source-fill-request' && sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(PANEL_PAGE))) {
      void (async () => {
        const bound = await binding()
        const channel = await readChannel(message.channel)
        if (!channel || channel.instance !== bound.instance || channel.userId !== bound.userId || channel.sourceTabId !== message.tabId) return { ok: false, reason: 'CHANNEL_EXPIRED' }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(message.reportId))) return { ok: false, reason: 'INVALID_REQUEST' }
        const tab = await chrome.tabs.get(channel.sourceTabId).catch(() => null)
        if (!tab || !supported(tab.url) || new URL(tab.url).pathname !== channel.sourcePath) return { ok: false, reason: 'SOURCE_CLOSED' }
        const reply = await chrome.tabs.sendMessage(tab.id, { type: 'edulog-fill-report', formId: channel.formId, reportId: message.reportId }).catch(() => null)
        if (!reply?.ok) return { ok: false, reason: reply?.reason || 'SOURCE_CLOSED' }
        return { ok: true, applied: fillCount(reply.applied), skipped: fillCount(reply.skipped), review: reply.review === true }
      })().then(respond, () => respond({ ok: false, reason: 'EXTENSION_UNAVAILABLE' }))
      return true
    }
    if (message?.type === 'integration-inline-prefill' && sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && supported(sender.tab.url)) {
      // The side panel must open during the teacher's click, before any lookup below.
      const opening = message.operation === 'open-editor' ? openPanel(sender.tab.id).then(() => null, error => error) : null
      void (async () => {
        const tab = await source({ tabId: sender.tab.id, sourcePath: new URL(sender.tab.url).pathname })
        const bound = await binding()
        const formResponse = await chrome.tabs.sendMessage(tab.id, { type: 'integration-form', expectedPath: new URL(tab.url).pathname })
        if (formResponse?.error || !formResponse?.data) fail(formResponse?.error?.message || '原站報告表單已關閉，請重新開啟。')
        let form = formResponse.data
        if (!/^[0-9]+$/.test(form.admissionId || '') || !/^[0-9]+$/.test(form.reportId || '') || (message.formId && message.formId !== form.formId) || (message.operation !== 'lookup' && message.fingerprint && message.fingerprint !== form.fingerprint)) fail('原站報告表單已變更，請重新讀取。')
        const operation = message.operation
        const call=async details=>{const reply=await api({...details,binding:{instance:bound.instance,userId:bound.userId}});if(reply.error){const error=new Error(reply.error.message);Object.assign(error,reply.error);throw error}return reply.data}
        if(operation==='supplement'){
          const input=message.input||{}
          if(input.enrollmentId){const enrollment=await call({operation:'enrollment-info',enrollmentId:input.enrollmentId});if(!enrollment?.student_id||!enrollment?.course_id)fail('此報名關係已無法確認，請重新選擇。')}
          const reply=await chrome.tabs.sendMessage(tab.id,{type:'integration-supplement',expectedPath:new URL(tab.url).pathname,input:{formId:form.formId,fingerprint:form.fingerprint,date:input.date,enrollmentId:input.enrollmentId,binding:{instance:bound.instance,userId:bound.userId},conflictAcknowledged:input.conflictAcknowledged===true,clear:input.clear===true}})
          if(reply?.error||!reply?.data)fail(reply?.error?.message||'補充資訊未保存。')
          return {form:reply.data}
        }
        if(operation==='identity-search'){
          const query=message.query||{}
          if(query.resource==='enrollments'&&!query.student_id)fail('請先選擇學生。')
          if(!['students','enrollments'].includes(query.resource))fail('身份查詢格式不正確。')
          return call({operation:'catalog',query:{resource:query.resource,search:query.search||undefined,student_id:query.student_id||undefined,cursor:query.cursor||undefined,limit:50}})
        }
        if (operation === 'open-editor') {
          if(await opening)fail('無法開啟 EduLog 側邊欄，請再按一次「在 EduLog 編輯」。')
          // Bound enrollments only (source link, confirmed memory or the teacher's pick); never by name.
          const target=await inlineTarget(form,bound)
          if(!target){await panelFailed(tab.id,'此學生尚未同步到 EduLog。同步本班後即可在 EduLog 編輯。');return {opened:false,reason:'no-target'}}
          if(!form.date)fail('請先確認完整上課日期。')
          const base=frontendBase(bound.status.settingsUrl)
          if(!base)fail('EduLog 網址無法確認，請重新連線。')
          const opened=await preparePanel({sourceTab:tab,base,enrollmentId:target.enrollmentId,date:form.date,formId:form.formId,binding:{instance:bound.instance,userId:bound.userId},label:[target.studentName,target.className,form.date].filter(Boolean).join(' · ')})
          return {opened:true,access:opened.access}
        }
        if (operation === 'lookup') {
          if(form.supplement?.enrollmentId&&(form.supplement.binding?.instance!==bound.instance||form.supplement.binding?.userId!==bound.userId)){
            const reply=await chrome.tabs.sendMessage(tab.id,{type:'integration-supplement',expectedPath:new URL(tab.url).pathname,input:{formId:form.formId,fingerprint:form.fingerprint,clearEnrollment:true}})
            if(reply?.error||!reply?.data)fail('EduLog 連線已變更，請重新確認當次報名。')
            form=reply.data
          }
          let dateReadError=''
          if(!form.date){try{const reply=await chrome.tabs.sendMessage(tab.id,{type:'integration-resolve-date',expectedPath:new URL(tab.url).pathname});if(reply?.data?.formId!==form.formId)fail(reply?.error?.message||'來源表單已改變。');form=reply.data}catch(error){dateReadError=error.message}}
          const target=await inlineTarget(form,bound)
          const data=target&&form.date?await call({operation:'reports',query:{summary:'true',enrollment_id:target.enrollmentId,date_from:form.date,date_to:form.date,limit:50,...(bound.status.capabilities?.nearest_report_candidates?{sort:'nearest',anchor_date:form.date}:{})}}):{reports:[]}
          return {connected:true,form,target,reports:data.reports||[],next_cursor:data.next_cursor||null,settingsUrl:bound.status.settingsUrl,capabilities:bound.status.capabilities,reason:!target?'尚無有效報名對應；可選擇既有學生與報名，或人工選取範本。':!form.date?form.dateInfo?.reason||dateReadError||'請確認完整上課日期。':''}
        }
        if(operation==='candidates'){
          if(bound.status.capabilities?.nearest_report_candidates!==true)fail('目前連線未提供依目標日期排序的候選；請重新檢查連線後再試。','CAPABILITY_UNAVAILABLE')
          const target=await inlineTarget(form,bound), query=message.query||{}
          if(!target)fail('請先確認目標學生與報名；仍可使用其他學生搜尋。')
          if(query.group==='history'){
            if(!bound.status.capabilities?.enrollment_history_reports)fail('目前連線未提供已保存歷史範本；請重新檢查連線後再試。','CAPABILITY_UNAVAILABLE')
            const data=await call({operation:'history-list',query:{student_id:target.studentId,course_id:target.courseId,sort:'nearest',anchor_date:form.date||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),unlinked_only:'true',limit:50,cursor:query.cursor||undefined}})
            return {reports:data.items.map(r=>({...r,occurrence_date:r.report_date,template_only:true})),next_cursor:data.next_cursor}
          }
          if(!['same-course','other-course','exact'].includes(query.group))fail('候選分組格式不正確。')
          if(query.group==='exact'&&!form.date)fail('請先確認完整上課日期。')
          const anchor=form.date||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
          const result=await call({operation:'reports',query:{summary:'true',limit:50,student_id:target.studentId,sort:'nearest',anchor_date:anchor,cursor:query.cursor||undefined,...(query.group==='other-course'?{exclude_course_id:target.courseId}:{course_id:target.courseId}),...(query.group==='exact'?{enrollment_id:target.enrollmentId,date_from:form.date,date_to:form.date}:{})}})
          return {...result,anchor_date:anchor,anchorConfirmed:Boolean(form.date)}
        }
        if (operation === 'search') {
          const query = message.query || {}
          if (query.search && String(query.search).length > 80) fail('搜尋文字過長。')
          const result = await api({ operation: 'reports', binding: { instance: bound.instance, userId: bound.userId }, query: {
            summary: 'true', limit: 50, ...(query.search ? { search: String(query.search) } : {}),
            ...(query.student_id ? { student_id: String(query.student_id) } : {}),
            ...(query.course_id ? { course_id: String(query.course_id) } : {}),
            ...(query.date_from ? { date_from: String(query.date_from) } : {}),
            ...(query.date_to ? { date_to: String(query.date_to) } : {}),
            ...(query.cursor ? {cursor:String(query.cursor)} : {}),
            ...(bound.status.capabilities?.nearest_report_candidates ? {sort:'nearest',anchor_date:form.date||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())} : {}),
          } })
          if(result.error){const error=new Error(result.error.message);Object.assign(error,result.error);throw error}
          return { reports: result.data?.reports || [], next_cursor: result.data?.next_cursor || null }
        }
        if (['field-resolve','field-confirm'].includes(operation)) {
          if(bound.status.capabilities?.field_mapping_memory!==true)fail('目前連線未提供跨裝置欄位映射記憶；本次核對仍可繼續。','CAPABILITY_UNAVAILABLE')
          const target=await inlineTarget(form,bound)
          if(!target)fail('請先確認有效報名，才能保存課程範圍的映射。')
          const items=operation==='field-resolve'?form.fields.filter(f=>f.type!=='text').map(f=>({field_key:f.key,options_signature:JSON.stringify(f.options.map(o=>[String(o.value),o.label,Boolean(o.disabled)]))})):message.items
          if(!Array.isArray(items)||!items.length||items.length>50)fail('欄位映射格式不正確。')
          const safe=items.map(item=>{
            const field=form.fields.find(f=>f.key===item.field_key&&f.type!=='text')
            const signature=field&&JSON.stringify(field.options.map(o=>[String(o.value),o.label,Boolean(o.disabled)]))
            if(!field||signature!==item.options_signature||operation==='field-confirm'&&item.action!=='clear'&&(field.disabled||!field.options.some(o=>o.value===item.source_value&&!o.disabled)))fail('原站欄位選項已變更，請重新核對。')
            return {field_key:field.key,options_signature:signature,...(field.key==='lesson_id'?{course_id:target.courseId}:{}),class_session_id:target.classSessionId,...(operation==='field-confirm'?{action:item.action,source_value:item.source_value,canonical_value:item.canonical_value,expected_revision:item.expected_revision}: {})}
          })
          return call({operation,body:{source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',items:safe}})
        }
        if (operation === 'detail') {
          if (!/^[a-f0-9-]{36}$/i.test(message.reportId || '')) fail('報告識別碼不正確。')
          if(message.kind==='history_report'){
            const data=await call({operation:'history-detail',historyId:message.reportId})
            return {...data,kind:'history_report',occurrence_date:data.report_date,template_only:true}
          }
          const result = await api({ operation: 'reports', binding: { instance: bound.instance, userId: bound.userId }, query: { id: message.reportId, summary: 'false' } })
          if(result.error){const error=new Error(result.error.message);Object.assign(error,result.error);throw error}
          return result.data?.reports?.[0] || null
        }
        if (operation !== 'apply') fail('預填操作不正確。')
        const input = message.input
        if (!input || !/^[a-f0-9-]{36}$/i.test(input.reportId || '') || !Array.isArray(input.fields) || input.fields.length > 20) fail('預填資料格式不正確。')
        const historyTemplate=input.kind==='history_report'
        const full = await api(historyTemplate?{operation:'history-detail',historyId:input.reportId,binding:{instance:bound.instance,userId:bound.userId}}:{ operation: 'reports', binding: { instance: bound.instance, userId: bound.userId }, query: { id: input.reportId, summary: 'false' } })
        if(full.error)fail(full.error.message)
        const report = historyTemplate?{...full.data,occurrence_date:full.data?.report_date}:full.data?.reports?.[0]
        if (!report || report.version !== input.version) fail('EduLog 報告已更新，請重新查詢並核對。')
        if(!form.date || form.dateInfo?.conflict && form.dateInfo?.basis!=='user_confirmed')fail('請先確認完整且無矛盾的上課日期。')
        const target=await inlineTarget(form,bound)
        const sameTarget = !historyTemplate && target && !target.userConfirmed && report.enrollment_id === target.enrollmentId && report.occurrence_date === form.date
        const identityMismatch = historyTemplate || !target || report.enrollment_id !== target.enrollmentId || report.occurrence_date !== form.date
        if (identityMismatch && input.identityConfirmed !== true) fail('此報告與原站學生、報名或日期不同；請在面板確認範本用途後再套用。')
        const workId = crypto.randomUUID()
        const row = { id: workId, type: 'prefill', status: 'applying', sourceTab: tab.id, sourcePath: new URL(tab.url).pathname,
          title: `${form.title || '課堂紀錄'} · ${form.date || '日期待確認'}`, form, report: { id: report.id, version: report.version }, createdAt: Date.now() }
        await workStore.put(row, { instance: bound.instance, userId: bound.userId })
        const applied = await chrome.tabs.sendMessage(tab.id, { type: 'integration-apply-inline', expectedPath: new URL(tab.url).pathname,
          input: { formId: form.formId, reportId: form.reportId, fingerprint: form.fingerprint, fields: input.fields } })
        if (applied?.error || !applied?.data) {const error=new Error(applied?.error?.message || '原站表單套用結果尚未確認；請檢查目前編輯器，不要重複套用。');error.code=applied?.error?.code;error.appliedFields=applied?.error?.appliedFields;throw error}
        row.status = 'pending_confirmation'; row.appliedCount = applied.data.applied
        if (sameTarget) row.push = { report_id: report.id, report_version: report.version, source_origin: 'https://corp.orangeapple.co', source_report_url: form.sourceReportUrl,
          source_id: form.reportId, target_fingerprint: applied.data.target.fingerprint, idempotency_key: workId }
        try { await workStore.put(row, { instance: bound.instance, userId: bound.userId }) }
        catch { return { applied: applied.data.applied, pendingConfirmation: true, matchingTarget: Boolean(sameTarget), recordSaved: false } }
        if (sameTarget) {
          try { await api({ operation: 'map', binding: { instance: bound.instance, userId: bound.userId }, body: { source_origin: 'https://corp.orangeapple.co', source_kind: 'report', source_id: form.reportId, target_id: report.id } }); await api({ operation: 'push', binding: { instance: bound.instance, userId: bound.userId }, body: row.push }); row.pushRecorded = true; await workStore.put(row, { instance: bound.instance, userId: bound.userId }) }
          catch { /* The source is already prefilled; history can retry the pending record without applying again. */ }
        }
        return { applied: applied.data.applied, pendingConfirmation: true, matchingTarget: Boolean(sameTarget), recordSaved: true }
      })().then(data => respond({ data }), error => {
        // A panel opened for this click shows why the editor could not load instead of loading forever.
        if (opening) void panelFailed(sender.tab.id, error.message || '無法開啟 EduLog 編輯器。').catch(() => {})
        respond({ error: { code: error.code || 'INLINE_PREFILL_FAILED', message: error.message || '預填無法完成。', requestId: error.requestId, appliedFields:error.appliedFields } })
      })
      return true
    }
    if (!trusted(sender) || !message?.type?.startsWith('workspace-')) return
    void (async () => {
      if (message.type === 'workspace-init') {
        const bound = await binding()
        const tabs = (await chrome.tabs.query({})).filter(t => supported(t.url)).map(t => ({ id: t.id, title: t.title, path: new URL(t.url).pathname, url: t.url }))
        return { data: { binding: { instance: bound.instance, userId: bound.userId }, status: bound.status, tabs } }
      }
      if (message.type === 'workspace-store-authorize') {
        const bound = await binding(message.binding)
        return { data: { instance: bound.instance, userId: bound.userId, action: message.action, workId: message.workId, revision: message.revision } }
      }
      if (!message.binding || typeof message.binding.instance !== 'string' || typeof message.binding.userId !== 'string') fail('缺少實例與使用者工作識別。')
      if (message.type === 'workspace-cancel-read') {
        if (!/^[a-f0-9-]{36}$/i.test(message.requestId || '')) fail('查詢識別碼不正確。')
        cancelledReads.add(message.requestId)
        for (const request of requests) if (request.readOnly && request.requestId === message.requestId) request.controller.abort('user-cancelled')
        return { data: true }
      }
      if (message.type === 'workspace-api') return api(message)
      const bound = await binding(message.binding), owner = { instance: bound.instance, userId: bound.userId }
      if (message.type === 'workspace-store') {
        if (message.action === 'list') return { data: await workStore.list(owner) }
        if (message.action === 'get') return { data: await workStore.get(message.id, owner) }
        if (message.action === 'delete') return { data: await workStore.delete(message.id, owner) }
        return { data: await workStore.put(message.work, owner) }
      }
      if (message.type === 'workspace-open-source') {
        if (typeof message.sourcePath!=='string' || !/^\/(courses\/dt\/\d+|dt_admissions\/\d+|admissions\/unfilled_report)$/.test(message.sourcePath)) fail('已保存的來源位置不受支援；請重新開啟原站班級或學生頁。','SOURCE_PATH_UNAVAILABLE')
        const url=`https://corp.orangeapple.co${message.sourcePath}`
        if(!supported(url))fail('此來源頁型目前無法自動開啟，請手動開啟來源頁後重試。','SOURCE_PATH_UNAVAILABLE')
        const tab=await chrome.tabs.create({url,active:false})
        if(tab.status!=='complete')await new Promise((resolve,reject)=>{let timer,finished=false;const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(onUpdated);error?reject(error):resolve()};const onUpdated=(id,change)=>{if(id===tab.id&&change.status==='complete')finish()};chrome.tabs.onUpdated.addListener(onUpdated);timer=setTimeout(()=>finish(Object.assign(new Error('來源頁開啟逾時；請確認你仍已登入來源網站。'),{code:'SOURCE_OPEN_TIMEOUT'})),20000);chrome.tabs.get(tab.id).then(current=>{if(current.status==='complete')finish()}).catch(finish)})
        const loaded=await chrome.tabs.get(tab.id);if(!supported(loaded.url))fail('來源頁要求重新登入或已轉址；請先在原站登入，再從工作紀錄重試。','SOURCE_LOGIN_REQUIRED')
        return {data:{id:loaded.id,url:loaded.url,path:new URL(loaded.url).pathname,title:loaded.title||message.sourcePath}}
      }
      if (message.type === 'workspace-source') {
        const tab = await source(message)
        const types = { context: 'integration-context', collect: 'integration-collect', history: 'integration-history', 'history-report':'integration-history-report', form: 'integration-form', apply: 'integration-apply' }
        if (!types[message.action]) fail('來源操作不正確。')
        const sourcePath = new URL(tab.url).pathname
        const sourcePage = globalThis.edulogSiteAdapter.matchPage?.(sourcePath)
        if (sourcePage?.kind === 'report-editor' && !['context','form','apply'].includes(message.action)) fail('獨立報告編輯頁只支援報告預填；請從班級頁啟動教學資料匯入。','IMPORT_SOURCE_UNAVAILABLE')
        if (message.action === 'collect' && !globalThis.edulogSiteAdapter.matchesTeachingPage(sourcePath)) fail('此頁面不是可匯入的班級或教學資料頁。','IMPORT_SOURCE_UNAVAILABLE')
        if (message.action === 'apply' && (!message.input || JSON.stringify(message.input).length > 100000)) fail('預填資料格式不正確。')
        if (message.action === 'apply') {
          const row = await workStore.get(message.workId, owner)
          if (!row || row.type !== 'prefill' || row.status !== 'applying' || row.sourceTab !== tab.id || row.sourcePath !== new URL(tab.url).pathname || row.form?.formId !== message.input.formId || row.form?.fingerprint !== message.input.fingerprint) fail('預填目標不屬於此工作。')
        }
        if (['history','history-report'].includes(message.action)) {
          const row = await workStore.get(message.workId, owner)
          if (!row || row.sourceTab !== tab.id || row.sourcePath !== new URL(tab.url).pathname || !row.snapshot?.admissionPaths?.includes(message.historyPath)) fail('來源紀錄不屬於此工作。')
          if(message.action==='history-report'){
            const input=message.input||{},records=[...row.snapshot.records,...row.history?.queue||[],...Object.values(row.history?.checkpoints||{}).flatMap(c=>c.records||[]),...row.history?.issues||[]]
            const record=records.find(r=>{
              if(r.kind!=='report'||(input.evidenceKey?r.evidenceKey!==input.evidenceKey:r.source_id!==input.reportId))return false
              const ownerAdmission=String(message.historyPath).split('/').pop()
              if(r.enrollment_source_id===ownerAdmission)return true
              return r.sourceRowType==='previous-admission'&&r.sourceAdmissionContextVerified===true&&
                (r.sourceHistoryPath===message.historyPath||(r.sourceEvidence||[]).some(e=>e.sourcePath===message.historyPath))
            })
            if(!record)fail('來源報告不屬於此工作。');if(input.editUrl&&String(input.editUrl).length>2048)fail('來源連結過長。');message.input={record,editUrl:input.editUrl,confirmedDate:input.confirmedDate}
          }
        }
        let response,sourceTimer
        try { response = await Promise.race([chrome.tabs.sendMessage(tab.id, { type: types[message.action], expectedPath: new URL(tab.url).pathname, history: false, historyPath: message.historyPath, input: message.input }),new Promise((_,reject)=>{sourceTimer=setTimeout(()=>reject(Object.assign(new Error('讀取來源超過 30 秒；檢查點保留，請稍後重試。'),{code:'SOURCE_READ_TIMEOUT'})),30000)})]) }
        catch (error) { if (/receiving end does not exist|could not establish connection/i.test(error.message || '')) fail('來源分頁的擴充套件腳本不存在或已過期。請重新載入擴充套件並刷新來源分頁後重試。','SOURCE_SCRIPT_UNAVAILABLE'); throw error }
        finally{clearTimeout(sourceTimer)}
        if(!response||response.data===undefined&&!response.error)fail('來源腳本尚不支援此操作。請重新載入擴充套件，保存草稿後刷新來源分頁。','SOURCE_SCRIPT_UNAVAILABLE')
        if (message.requestId && cancelledReads.has(message.requestId)) { cancelledReads.delete(message.requestId); const cancelled = new Error('唯讀查詢已取消。'); cancelled.code = 'READ_CANCELLED'; throw cancelled }
        let after;try{after=await chrome.tabs.get(tab.id)}catch{fail('來源分頁已關閉，工作已暫停。','SOURCE_CLOSED')}
        if (after.url !== tab.url) fail('來源分頁已導覽，工作已停止。','SOURCE_CHANGED')
        return response
      }
      if (message.type === 'workspace-check-source') {
        let tab
        try { tab = await chrome.tabs.get(message.tabId) } catch { return { data: { closed: true } } }
        if (!supported(tab.url) || new URL(tab.url).pathname !== message.sourcePath) fail('來源分頁已導覽，工作已停止。','SOURCE_CHANGED')
        return { data: { closed: false } }
      }
      if (message.type === 'workspace-return') { const tab = await source(message); await chrome.tabs.update(tab.id, { active: true }); return { data: true } }
      fail('工作操作尚未支援。')
    })().then(respond, error => respond({ error: { code: error.code || 'WORKSPACE_FAILED', message: error.message || '無法完成工作。', requestId: error.requestId, retryAfter: error.retryAfter, fields: error.fields, diagnosticSource:error.diagnosticSource } }))
    return true
  })
}
