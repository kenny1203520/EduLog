(() => {
  const ORIGIN = 'https://corp.orangeapple.co'
  const text = node => node?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 256) || ''
  const path = value => { try { const u = new URL(value, ORIGIN); return u.origin === ORIGIN ? u.pathname : '' } catch { return '' } }
  const links = node => [...node.querySelectorAll('a[href]')].map(a => ({ path: path(a.getAttribute('href')), node: a }))
  const fullDate = value => {
    const match = value?.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
    if (!match) return null
    const result = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    return new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) === result ? result : null
  }
  const fields = [
    ['attendance_status', '出席', 'select[name="dt_admission_lesson_report[attendance_status]"]'],
    ['absence_reason', '不出席原因', '#lesson_report_reason'],
    ['lesson_id', '課程／教材', '#dt_admission_lesson_report_learning_stage'],
    ['is_completed', '課程完成狀況', '#dt_admission_lesson_report_completion_status'],
    ['progress_start', '章節起點', '#dt_admission_lesson_report_start_from'],
    ['progress_end', '章節終點', '#dt_admission_lesson_report_end_to'],
    ['class_participation', '課程參與', 'input[type="radio"][name="admission_lesson_report[participation_rating]"]'],
    ['classroom_behavior', '課堂表現', 'input[type="radio"][name="admission_lesson_report[behavior_rating]"]'],
    ['content', '學習表現', '#lesson_report_feedback'],
    ['contact_notes', '聯絡欄', '#dt_admission_lesson_report_contact'],
    ['class_notes', '內部紀錄', '#lesson_report_comment'],
  ]
  const forms = new WeakMap()
  async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(b => b.toString(16).padStart(2, '0')).join('') }
  function getForm(doc) {
    return [...doc.querySelectorAll('.modal.show form, #remote_modal form')].find(form => /^\/dt_admissions\/\d+\/reports\/\d+$/.test(path(form.getAttribute('action')))) || null
  }
  async function readForm(doc) {
    const form = getForm(doc)
    if (!form) throw new Error('請先在原站開啟學生的「記錄」編輯視窗。')
    const action = path(form.getAttribute('action')), ids = action.match(/^\/dt_admissions\/(\d+)\/reports\/(\d+)$/)
    if (!forms.has(form)) forms.set(form, crypto.randomUUID())
    const values = fields.flatMap(([key, label, selector]) => {
      const nodes = [...form.querySelectorAll(selector)]
      if (!nodes.length) return []
      const first = nodes[0], radio = first.type === 'radio'
      return [{ key, label, internal: key === 'class_notes', type: radio ? 'radio' : first.tagName === 'SELECT' ? 'select' : 'text', disabled: nodes.every(n => n.disabled),
        value: radio ? nodes.find(n => n.checked)?.value || '' : first.value,
        options: radio ? nodes.map(n => ({ value: n.value, label: `${Number(n.value) / 2} 星`, disabled: n.disabled })) : first.tagName === 'SELECT' ? [...first.options].map(o => ({ value: o.value, label: text(o), disabled: o.disabled })) : [],
      }]
    })
    const target = { formId: forms.get(form), action, admissionId: ids[1], reportId: ids[2], title: text(form.closest('.modal')?.querySelector('.modal-title')), date: fullDate(text(form.closest('.modal')?.querySelector('.modal-title'))), fields: values }
    return { ...target, fingerprint: await digest(target), sourceReportUrl: `${ORIGIN}${action}` }
  }
  async function applyForm(doc, input) {
    const before = await readForm(doc)
    if (before.fingerprint !== input.fingerprint || before.formId !== input.formId || before.reportId !== input.reportId) throw new Error('原站表單或內容已變更，請重新檢查欄位。')
    if (!Array.isArray(input.fields) || input.fields.length > fields.length || new Set(input.fields.map(f => f.key)).size !== input.fields.length) throw new Error('預填欄位格式不正確。')
    const form = getForm(doc), operations = []
    for (const item of input.fields) {
      const spec = fields.find(f => f[0] === item.key), snapshot = before.fields.find(f => f.key === item.key)
      if (!spec || !snapshot || snapshot.disabled || typeof item.value !== 'string' || item.value.length > 10000) throw new Error('目標欄位不可預填。')
      if (snapshot.internal && item.includeInternal !== true) throw new Error('內部紀錄尚未確認。')
      if (snapshot.value && snapshot.value !== item.value && item.overwrite !== true) throw new Error('原站已有內容，請明確確認覆寫。')
      if (snapshot.type !== 'text' && !snapshot.options.some(o => o.value === item.value && !o.disabled)) throw new Error('原站選項已變更，請人工選擇。')
      operations.push({ item, nodes: [...form.querySelectorAll(spec[2])], type: snapshot.type })
    }
    if (path(form.getAttribute('action')) !== before.action || getForm(doc) !== form) throw new Error('原站目標表單已變更。')
    for (const field of before.fields) {
      const selector = fields.find(f => f[0] === field.key)[2], nodes = [...form.querySelectorAll(selector)]
      const current = field.type === 'radio' ? nodes.find(n => n.checked)?.value || '' : nodes[0]?.value
      if (current !== field.value) throw new Error('原站內容已變更，請重新檢查欄位。')
    }
    // Validate every field before modifying any native node. Never submit/click
    // confirmation controls. Native change events retain original dependencies.
    for (const { item, nodes, type } of operations) {
      if (getForm(doc) !== form || nodes.some(n => !n.isConnected || n.disabled)) throw new Error('原生連動已變更表單，請檢查已套用內容，再重新讀取。')
      if (type === 'radio') { for (const n of nodes) n.checked = n.value === item.value }
      else nodes[0].value = item.value
      const node = type === 'radio' ? nodes.find(n => n.checked) : nodes[0]
      node.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }))
      node.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
    }
    const after = await readForm(doc)
    if (after.formId !== before.formId || operations.some(({ item }) => after.fields.find(f => f.key === item.key)?.value !== item.value)) throw new Error('原生欄位已變更，請檢查已套用內容，不會自動重試。')
    return { status: 'pending_confirmation', applied: operations.length, target: after }
  }
  function extractClass(doc, sourcePath) {
    const classId = path(sourcePath).match(/^\/courses\/dt\/(\d+)(?:\/lesson[-_]reports)?$/)?.[1]
    if (!classId || !doc.querySelector('#page-body > .content')) throw new Error('此頁無法辨識班級，請從班級工作區開始。')
    const records = [], issues = [], students = new Map(), admissions = new Map(), reportIds = new Set()
    const title = text(doc.querySelector('#page-body > .content h2, #page-body > .content h1')) || `班級 ${classId}`
    for (const row of doc.querySelectorAll('#reports tbody tr, #students-table tbody tr')) {
      const rowLinks = links(row), admission = rowLinks.find(a => /^\/dt_admissions\/\d+$/.test(a.path))?.path.match(/\d+$/)?.[0] || rowLinks.find(a => /^\/admissions\/comments\/\d+\/edit_teacher$/.test(a.path))?.path.split('/')[3]
      if (!admission) continue
      const student = rowLinks.find(a => /^\/students\/\d+(?:\/(?:accounts|teachers_comment))?$/.test(a.path))?.path.match(/^\/students\/(\d+)/)?.[1]
      // Read only the site's name/course text nodes, never action/status text.
      const nameCell = row.querySelector('td:has(.admission-comment), td:has(a[href*="/students/"])') || row.cells[0]
      const name = text(nameCell?.querySelector(':scope > span:not(.badge), .student-name')) || text(rowLinks.find(a => /^\/students\/\d+$/.test(a.path))?.node) || text(rowLinks.find(a => /^\/admissions\/comments\//.test(a.path))?.node)
      const courseCell = nameCell?.nextElementSibling
      const courseLink = links(courseCell || row).find(a => /^\/courses\/(?!dt\/)\d+$/.test(a.path))
      const courseLabel = text(courseCell?.querySelector(':scope > span:not(.badge), .course-name')) || text(courseLink?.node)
      let enrollment = admissions.get(admission)
      if (!enrollment) { enrollment = { kind: 'enrollment', source_id: admission, student_source_id: null, sourceStudentName: '', sourceCourseLabel: '', source_course_id: null, data: { external_link: `${ORIGIN}/dt_admissions/${admission}` }, needs: ['報名日期', '報名狀態'] }; admissions.set(admission, enrollment); records.push(enrollment) }
      if (student) enrollment.student_source_id = student
      if (name) enrollment.sourceStudentName = name
      if (courseLabel) enrollment.sourceCourseLabel = courseLabel
      if (courseLink) enrollment.source_course_id = courseLink.path.split('/').pop()
      if (enrollment.student_source_id && enrollment.sourceStudentName) {
        const id = enrollment.student_source_id
        if (!students.has(id)) { const record = { kind: 'student', source_id: id, data: { name: enrollment.sourceStudentName, external_link: `${ORIGIN}/students/${id}` } }; students.set(id, record); records.push(record) }
        else students.get(id).data.name = enrollment.sourceStudentName
      }
      for (const link of rowLinks.filter(a => /^\/dt_admissions\/\d+\/reports\/\d+\/edit$/.test(a.path))) {
        const date = fullDate(text(link.node.closest('td'))) || fullDate(link.node.getAttribute('data-date'))
        const reportId = link.path.match(/reports\/(\d+)/)[1]
        if (reportIds.has(reportId)) continue
        reportIds.add(reportId)
        records.push({ kind: 'report', source_id: reportId, enrollment_source_id: admission, date, data: { external_link: `${ORIGIN}${link.path.replace(/\/edit$/, '')}` }, needs: ['既有報告內容', ...(date ? [] : ['完整課次日期'])] })
      }
    }
    for (const r of admissions.values()) if (!r.student_source_id) issues.push({ kind: 'enrollment', source_id: r.source_id, reason: `${r.sourceStudentName || '姓名尚未辨識'}：缺少可靠學生 ID，可指定既有學生；不能新建學生。` })
    return { sourceOrigin: ORIGIN, sourcePath: path(sourcePath), classId, title, records, issues, admissionPaths: [...admissions.keys()].map(id => `/dt_admissions/${id}`), completeness: 'partial', note: '只列出目前可辨識資料；日期、教材、時段及未取得內容需確認。' }
  }
  function extractHistory(doc, admissionId) {
    const results = []
    for (const row of doc.querySelectorAll('#page-body > .content table tbody tr')) {
      const cells = [...row.cells], date = fullDate(text(cells[1]))
      if (!date) continue
      const ref = links(row).find(a => /^\/dt_admissions\/\d+\/reports\/\d+(\/edit)?$/.test(a.path))
      // Only an explicit report URL is authoritative. Attendance query IDs may
      // contain multiple targets and are deliberately not treated as a report.
      if (!ref || !ref.path.startsWith(`/dt_admissions/${admissionId}/`)) continue
      const reportId = ref.path.match(/reports\/(\d+)/)[1]
      const contentNode = [...row.querySelectorAll('p')].find(p => /^評語[：:]/.test(text(p)))
      const content = contentNode?.textContent.trim().replace(/^評語[：:]\s*/, '').slice(0, 10000)
      results.push({ kind: 'report', source_id: reportId, enrollment_source_id: admissionId, date, data: { ...(content ? { content } : {}), external_link: `${ORIGIN}${ref.path.replace(/\/edit$/, '')}` }, needs: content ? ['教材／評量欄位未驗證'] : ['既有報告內容'] })
    }
    return results
  }
  async function readPath(sourcePath) {
    if (!/^\/(?:courses\/dt\/\d+(?:\/lesson[-_]reports)?|dt_admissions\/\d+)$/.test(sourcePath)) throw new Error('來源路徑尚未驗證。')
    const response = await fetch(`${ORIGIN}${sourcePath}`, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/html' } })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('來源頁暫時無法讀取或權限不足。')
    const html = await response.text()
    if (html.length > 5_000_000) throw new Error('來源頁超過可處理大小。')
    return new DOMParser().parseFromString(html, 'text/html')
  }
  async function collect(doc, input) {
    const initialPath = doc.location.pathname
    let snapshot = extractClass(doc, initialPath)
    if (!doc.querySelector('#reports')) {
      const richer = extractClass(await readPath(`/courses/dt/${snapshot.classId}/lesson_reports`), `/courses/dt/${snapshot.classId}/lesson_reports`)
      for (const record of richer.records) {
        const previous = snapshot.records.find(r => r.kind === record.kind && r.source_id === record.source_id)
        if (!previous) snapshot.records.push(record)
        else { for (const [key, value] of Object.entries(record)) if (value != null && value !== '') previous[key] = key === 'data' ? { ...previous.data, ...value } : value }
      }
      snapshot.admissionPaths = [...new Set([...snapshot.admissionPaths, ...richer.admissionPaths])]
    }
    if (input.history) for (const sourcePath of snapshot.admissionPaths) {
      if (doc.location.pathname !== initialPath) throw new Error('來源頁已導覽，工作已暫停。')
      try {
        const records = extractHistory(await readPath(sourcePath), sourcePath.split('/').pop())
        for (const record of records) { const index = snapshot.records.findIndex(r => r.kind === record.kind && r.source_id === record.source_id); if (index < 0) snapshot.records.push(record); else snapshot.records[index] = record }
      } catch (error) { snapshot.issues.push({ kind: 'report', source_id: sourcePath.split('/').pop(), reason: error.message }) }
    }
    return snapshot
  }
  globalThis.edulogSourceIntegration = Object.freeze({ origin: ORIGIN, extractClass, extractHistory, collect, readForm, applyForm, digest,
    async readHistory(sourcePath) { if (!/^\/dt_admissions\/\d+$/.test(sourcePath)) throw new Error('來源路徑尚未驗證。'); return extractHistory(await readPath(sourcePath), sourcePath.split('/').pop()) },
    context(doc) { const p = doc.location.pathname; return { sourceOrigin: ORIGIN, sourcePath: p, classId: p.match(/^\/courses\/dt\/(\d+)/)?.[1] || null, title: text(doc.querySelector('#page-body > .content h2')), reportOpen: Boolean(getForm(doc)) } },
    capabilities: { current_class_import: true, report_prefill: true, all_classes_import: false, submission_confirmation: false },
  })
  if (globalThis.edulogRuntime && typeof document !== 'undefined') globalThis.edulogRuntime.listen((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['integration-context', 'integration-collect', 'integration-history', 'integration-form', 'integration-apply'].includes(message?.type)) return
    const run = async () => {
      if (message.expectedPath && message.expectedPath !== location.pathname) throw new Error('來源分頁已變更，請重新選擇來源。')
      if (message.type === 'integration-context') return globalThis.edulogSourceIntegration.context(document)
      if (message.type === 'integration-collect') return collect(document, { history: message.history === true })
      if (message.type === 'integration-history') return globalThis.edulogSourceIntegration.readHistory(message.historyPath)
      if (message.type === 'integration-form') return readForm(document)
      return applyForm(document, message.input)
    }
    const response = value => { try { respond(value) } catch { /* An updated extension cannot receive this response. Native content is retained. */ } }
    void run().then(data => response({ data }), error => response({ error: { code: 'SOURCE_ACTION_FAILED', message: error.message } }))
    return true
  })
})()
