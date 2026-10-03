import { workStore } from './work-store.js'
const supported = url => { try { const u = new URL(url); return u.origin === 'https://corp.orangeapple.co' && globalThis.edulogSiteAdapter.matchesTeachingPage(u.pathname) } catch { return false } }
const fail = message => { throw new Error(message) }
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
  const trusted = sender => sender.id === chrome.runtime.id && sender.url?.split('?')[0] === chrome.runtime.getURL('workspace.html')
  const entry = sender => sender.id === chrome.runtime.id && (sender.url === chrome.runtime.getURL('popup.html') || supported(sender.url))
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
    try { tab = await chrome.tabs.get(message.tabId) } catch { fail('來源分頁已關閉。請重新開啟支援網站並選取新的來源分頁。') }
    if (!supported(tab.url) || (message.sourcePath && new URL(tab.url).pathname !== message.sourcePath)) fail('來源分頁已關閉或導覽，請重新選擇來源。')
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
      reconcile: ['GET', `/enrollments/${message.enrollmentId}/reconciliation`],
      'import-info': ['GET', `/imports/${message.jobId}`], complete: ['POST', `/imports/${message.jobId}/complete`],
      'enrollment-info': ['GET', `/enrollments/${message.enrollmentId}`],
      context: ['GET', '/context'], catalog: ['GET', '/catalog'], resolve: ['POST', '/catalog/resolve'], confirm: ['POST', '/catalog/confirm'], reports: ['GET', '/reports'], work: ['GET', '/work'], map: ['POST', '/source-links'],
      job: ['POST', '/imports'], preview: ['POST', `/imports/${message.jobId}/preview`], apply: ['POST', `/imports/${message.jobId}/apply`],
      'job-status': ['PATCH', `/imports/${message.jobId}`], push: ['POST', '/report-pushes'],
    }
    if (message.operation === 'reconcile' && !/^[a-f0-9-]{36}$/i.test(message.enrollmentId || '')) fail('報名識別碼不正確。')
    if (!operations[message.operation] || (['preview', 'apply', 'job-status', 'import-info', 'complete'].includes(message.operation) && !/^[a-f0-9-]{36}$/.test(message.jobId)) || (message.operation === 'enrollment-info' && !/^[a-f0-9-]{36}$/i.test(message.enrollmentId || ''))) fail('工作操作不正確。')
    const [method, path] = operations[message.operation], url = new URL(`${bound.instance}/api/extension/v1${path}`)
    if (method === 'GET' && message.query) for (const [key, value] of Object.entries(message.query)) { if (value == null || value === '') continue; if (!['offset','id','resource','classroom_id','course_id','class_session_id','student_id','enrollment_id','class_occurrence_id','date_from','date_to','search','cursor','limit','summary','roster_date'].includes(key) || String(value).length > 100) fail('查詢格式不正確。'); url.searchParams.set(key, String(value)) }
    const payload = method === 'GET' ? undefined : JSON.stringify(message.operation === 'complete' ? message.body : message.body)
    if (payload && new TextEncoder().encode(payload).byteLength > 200000) fail('批次過大，請拆分後再試。')
    const readOnly = ['context','catalog','resolve','reports','work','reconcile','import-info'].includes(message.operation)
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
    if (!response.ok) return { error: { code: response.status === 429 ? 'RATE_LIMITED' : body?.error?.code || `HTTP_${response.status}`, message: body?.error?.message || 'API 無法完成操作。', fields: validationFields(body?.error?.fields), requestId: body?.error?.request_id, retryAfter: response.status === 429 ? Math.max(1, Math.min(3600, Number(response.headers?.get?.('retry-after')) || 0)) || null : null } }
    if (!body || !Object.hasOwn(body, 'data')) { const invalid = new Error('API 回應格式無法確認，請先檢查批次檢查點。'); invalid.code = 'API_RESPONSE_INVALID'; throw invalid }
    return { data: body?.data }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'get-integration-work-summary' && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html')) {
      void binding().then(async bound => {
        const rows = await workStore.list({ instance: bound.instance, userId: bound.userId })
        return { count: rows.filter(r => !['complete','cancelled'].includes(r.status)).length }
      }).then(respond, () => respond({ count: null }))
      return true
    }
    if (message?.type === 'open-integration-workspace' && entry(sender)) {
      void (async () => {
        const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
        const url = new URL(chrome.runtime.getURL('workspace.html'))
        url.searchParams.set('flow', message.flow === 'prefill' ? 'prefill' : message.flow === 'work' ? 'work' : 'import')
        if (tab?.id && supported(tab.url)) url.searchParams.set('source', String(tab.id))
        await chrome.tabs.create({ url: url.href, active: true })
        return { opened: true }
      })().then(respond, error => respond({ error: { code: 'WORKSPACE_UNAVAILABLE', message: error.message } }))
      return true
    }
    if (message?.type === 'integration-inline-prefill' && sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && supported(sender.tab.url)) {
      void (async () => {
        const tab = await source({ tabId: sender.tab.id, sourcePath: new URL(sender.tab.url).pathname })
        const bound = await binding()
        const formResponse = await chrome.tabs.sendMessage(tab.id, { type: 'integration-form', expectedPath: new URL(tab.url).pathname })
        if (formResponse?.error || !formResponse?.data) fail(formResponse?.error?.message || '原站報告表單已關閉，請重新開啟。')
        const form = formResponse.data
        if (!/^[0-9]+$/.test(form.admissionId || '') || !/^[0-9]+$/.test(form.reportId || '') || (message.formId && message.formId !== form.formId) || (message.fingerprint && message.fingerprint !== form.fingerprint)) fail('原站報告表單已變更，請重新讀取。')
        const operation = message.operation
        if (operation === 'lookup') {
          const resolveReply = await api({ operation: 'resolve', binding: { instance: bound.instance, userId: bound.userId }, body: {
            source_refs: [{ source_kind: 'enrollment', source_id: form.admissionId }], target_refs: [],
            memory_refs: [{ kind: 'admission', key: form.admissionId }],
          } })
          const resolved = resolveReply.data || {}
          const memory = (resolved.memories || []).find(row => row.valid && !row.suggestion)
          const link = (resolved.source_links || []).find(row => row.valid !== false)
          const enrollmentId = memory?.target_id || link?.target_id || null
          if (!enrollmentId) return { connected: true, form, target: null, reports: [], reason: '尚無有效來源報名對應；請先在匯入工作台確認報名。' }
          const enrollmentReply = await api({ operation: 'enrollment-info', binding: { instance: bound.instance, userId: bound.userId }, enrollmentId })
          const enrollment = enrollmentReply.data
          const studentId = memory?.student_id || enrollment?.student_id || null
          if (!form.date) return { connected: true, form, target: { enrollmentId, studentId, studentName:enrollment?.student_name, courseId:enrollment?.course_id, courseName:enrollment?.course_name, classSessionId:enrollment?.class_session_id, className:enrollment?.class_name }, reports: [], reason: '原站表單日期不完整，無法自動比對報告。' }
          const reportReply = await api({ operation: 'reports', binding: { instance: bound.instance, userId: bound.userId }, query: {
            summary: 'true', enrollment_id: enrollmentId, date_from: form.date, date_to: form.date, limit: 50,
          } })
          return { connected: true, form, target: { enrollmentId, studentId, studentName:enrollment?.student_name, courseId:enrollment?.course_id, courseName:enrollment?.course_name, classSessionId:enrollment?.class_session_id, className:enrollment?.class_name }, reports: reportReply.data?.reports || [], reason: '' }
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
          } })
          return { reports: result.data?.reports || [], next_cursor: result.data?.next_cursor || null }
        }
        if (operation === 'detail') {
          if (!/^[a-f0-9-]{36}$/i.test(message.reportId || '')) fail('報告識別碼不正確。')
          const result = await api({ operation: 'reports', binding: { instance: bound.instance, userId: bound.userId }, query: { id: message.reportId, summary: 'false' } })
          return result.data?.reports?.[0] || null
        }
        if (operation !== 'apply') fail('預填操作不正確。')
        const input = message.input
        if (!input || !/^[a-f0-9-]{36}$/i.test(input.reportId || '') || !Array.isArray(input.fields) || input.fields.length > 20) fail('預填資料格式不正確。')
        const full = await api({ operation: 'reports', binding: { instance: bound.instance, userId: bound.userId }, query: { id: input.reportId, summary: 'false' } })
        const report = full.data?.reports?.[0]
        if (!report || report.version !== input.version) fail('EduLog 報告已更新，請重新查詢並核對。')
        const sameTarget = input.targetEnrollmentId && report.enrollment_id === input.targetEnrollmentId && report.occurrence_date === form.date
        const identityMismatch = !input.targetEnrollmentId || report.enrollment_id !== input.targetEnrollmentId || report.occurrence_date !== form.date
        if (identityMismatch && input.identityConfirmed !== true) fail('此報告與原站學生、報名或日期不同；請在面板確認範本用途後再套用。')
        const workId = crypto.randomUUID()
        const row = { id: workId, type: 'prefill', status: 'applying', sourceTab: tab.id, sourcePath: new URL(tab.url).pathname,
          title: `${form.title || '課堂紀錄'} · ${form.date || '日期待確認'}`, form, report: { id: report.id, version: report.version }, createdAt: Date.now() }
        await workStore.put(row, { instance: bound.instance, userId: bound.userId })
        const applied = await chrome.tabs.sendMessage(tab.id, { type: 'integration-apply-inline', expectedPath: new URL(tab.url).pathname,
          input: { formId: form.formId, reportId: form.reportId, fingerprint: form.fingerprint, fields: input.fields } })
        if (applied?.error || !applied?.data) fail(applied?.error?.message || '原站表單套用結果尚未確認；請檢查目前編輯器，不要重複套用。')
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
      })().then(data => respond({ data }), error => respond({ error: { code: error.code || 'INLINE_PREFILL_FAILED', message: error.message || '預填無法完成。', requestId: error.requestId } }))
      return true
    }
    if (!trusted(sender) || !message?.type?.startsWith('workspace-')) return
    void (async () => {
      if (message.type === 'workspace-init') {
        const bound = await binding()
        const tabs = (await chrome.tabs.query({})).filter(t => supported(t.url)).map(t => ({ id: t.id, title: t.title, path: new URL(t.url).pathname, url: t.url }))
        return { data: { binding: { instance: bound.instance, userId: bound.userId }, status: bound.status, tabs } }
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
        return { data: await workStore.put(message.work, owner) }
      }
      if (message.type === 'workspace-source') {
        const tab = await source(message)
        const types = { context: 'integration-context', collect: 'integration-collect', history: 'integration-history', form: 'integration-form', apply: 'integration-apply' }
        if (!types[message.action]) fail('來源操作不正確。')
        if (message.action === 'apply' && (!message.input || JSON.stringify(message.input).length > 100000)) fail('預填資料格式不正確。')
        if (message.action === 'apply') {
          const row = await workStore.get(message.workId, owner)
          if (!row || row.type !== 'prefill' || row.status !== 'applying' || row.sourceTab !== tab.id || row.sourcePath !== new URL(tab.url).pathname || row.form?.formId !== message.input.formId || row.form?.fingerprint !== message.input.fingerprint) fail('預填目標不屬於此工作。')
        }
        if (message.action === 'history') {
          const row = await workStore.get(message.workId, owner)
          if (!row || row.sourceTab !== tab.id || row.sourcePath !== new URL(tab.url).pathname || !row.snapshot?.admissionPaths?.includes(message.historyPath)) fail('來源紀錄不屬於此工作。')
        }
        let response
        try { response = await chrome.tabs.sendMessage(tab.id, { type: types[message.action], expectedPath: new URL(tab.url).pathname, history: false, historyPath: message.historyPath, input: message.input }) }
        catch (error) { if (/receiving end does not exist|could not establish connection/i.test(error.message || '')) fail('來源分頁的擴充套件腳本不存在或已過期。請重新載入擴充套件並刷新來源分頁後重試。'); throw error }
        if (message.requestId && cancelledReads.has(message.requestId)) { cancelledReads.delete(message.requestId); const cancelled = new Error('唯讀查詢已取消。'); cancelled.code = 'READ_CANCELLED'; throw cancelled }
        const after = await chrome.tabs.get(tab.id)
        if (after.url !== tab.url) fail('來源分頁已導覽，工作已停止。')
        return response
      }
      if (message.type === 'workspace-check-source') {
        let tab
        try { tab = await chrome.tabs.get(message.tabId) } catch { return { data: { closed: true } } }
        if (!supported(tab.url) || new URL(tab.url).pathname !== message.sourcePath) fail('來源分頁已導覽，工作已停止。')
        return { data: { closed: false } }
      }
      if (message.type === 'workspace-return') { const tab = await source(message); await chrome.tabs.update(tab.id, { active: true }); return { data: true } }
      fail('工作操作尚未支援。')
    })().then(respond, error => respond({ error: { code: error.code || 'WORKSPACE_FAILED', message: error.message || '無法完成工作。', requestId: error.requestId, retryAfter: error.retryAfter } }))
    return true
  })
}
