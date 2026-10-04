(() => {
  const ORIGIN = 'https://corp.orangeapple.co'
  const text = node => node?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 256) || ''
  const path = value => { try { const u = new URL(value, ORIGIN); return u.origin === ORIGIN ? u.pathname : '' } catch { return '' } }
  const links = node => [...node.querySelectorAll('a[href]')].map(a => ({ path: path(a.getAttribute('href')), node: a }))
  const dates = globalThis.edulogSourceDate
  const fullDate = value => dates.parse(value).date
  const contexts = new Map(), answers = new Map()
  function captureEntry(event) {
    const link=event.target.closest?.('a[href]'), action=path(link?.getAttribute('href')).replace(/\/edit$/,'')
    if (!/^\/dt_admissions\/\d+\/reports\/\d+$/.test(action)) return
    const cell=link.closest('td'), row=cell?.parentElement, table=cell?.closest('table')
    const header=table && [...table.rows].find(r=>r.querySelector('th'))?.cells[cell.cellIndex]
    const rangeText=text(row && teachingCell(row,['課程','課程名稱'])) || text(row?.cells[1])
    const range=[...rangeText.matchAll(/\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}(?:日)?/g)].map(m=>m[0])
    const entryValues=[link.getAttribute('data-date')||'',text(header),text(cell).slice(0,256)], ranges=range.length===2?[range]:[]
    const previous=contexts.get(action)
    const unchanged=previous && JSON.stringify(previous.entryValues||previous.values)===JSON.stringify(entryValues) && JSON.stringify(previous.ranges)===JSON.stringify(ranges)
    contexts.set(action,unchanged?{...previous,sourcePath:location.pathname}:{values:entryValues,entryValues,ranges,sourcePath:location.pathname})
    if(contexts.size>100){const key=contexts.keys().next().value;contexts.delete(key);answers.delete(key)}
  }
  document.addEventListener('click',captureEntry,true)
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
    const currentPath = path(doc.location?.pathname || '')
    return [...doc.querySelectorAll('.modal.show form, #remote_modal form, form')].find(form => {
      const action = path(form.getAttribute('action'))
      return /^\/dt_admissions\/\d+\/reports\/\d+$/.test(action) && (form.closest('.modal.show') || form.closest('#remote_modal') || /^\/dt_admissions\/\d+\/reports\/\d+\/edit$/.test(currentPath))
    }) || null
  }
  async function readForm(doc, targetForm = getForm(doc)) {
    const form = targetForm
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
    const title=text(form.closest('.modal')?.querySelector('.modal-title'))
    const context=contexts.get(action) || {values:[],ranges:[]}
    const evidence=[title,...context.values]
    const dateInfo=dates.resolve(evidence,context.ranges)
    const evidenceKey=JSON.stringify({evidence,ranges:context.ranges,history:context.history||null})
    let supplement=answers.get(action)
    if(supplement?.evidenceKey!==evidenceKey){answers.delete(action);supplement=null}
    const target = { formId: forms.get(form), action, admissionId: ids[1], reportId: ids[2], title, date: supplement?.date || dateInfo.date, dateInfo:{...dateInfo,raw:evidence.filter(Boolean),basis:supplement?.date?'user_confirmed':dateInfo.basis}, supplement:supplement?{date:supplement.date||null,enrollmentId:supplement.enrollmentId||null,binding:supplement.binding||null,label:'使用者確認'}:null, fields: values }
    return { ...target, fingerprint: await digest(target), sourceReportUrl: `${ORIGIN}${action}/edit` }
  }
  async function supplementForm(doc,input) {
    const before=await readForm(doc)
    if(before.formId!==input.formId || before.fingerprint!==input.fingerprint)throw new Error('表單或來源證據已改變，請重新核對。')
    const context=contexts.get(before.action)||{values:[],ranges:[]}
    const evidence=[before.title,...context.values], evidenceKey=JSON.stringify({evidence,ranges:context.ranges,history:context.history||null})
    if(input.clear){answers.delete(before.action);return readForm(doc)}
    if(input.clearEnrollment){const saved=answers.get(before.action);if(saved){delete saved.enrollmentId;delete saved.binding;if(!saved.date)answers.delete(before.action)}return readForm(doc)}
    if(input.date && (!dates.parse(input.date).date || dates.parse(input.date).date!==input.date))throw new Error('請選擇有效的完整上課日期。')
    if(input.date && before.dateInfo.conflict && input.conflictAcknowledged!==true)throw new Error('請先確認已核對矛盾的來源日期。')
    if(input.enrollmentId && !/^[a-f0-9-]{36}$/i.test(input.enrollmentId))throw new Error('報名識別碼格式不正確。')
    answers.set(before.action,{...answers.get(before.action),evidenceKey,...(input.date?{date:input.date}:{}),...(input.enrollmentId?{enrollmentId:input.enrollmentId,binding:input.binding||null}:{})})
    return readForm(doc)
  }
  async function resolveFormDate(doc) {
    const before=await readForm(doc), nativeForm=getForm(doc)
    if(before.date)return before
    if(!contexts.has(before.action))contexts.set(before.action,{values:[],ranges:[]})
    const records=extractHistory(await readPath(`/dt_admissions/${before.admissionId}`),before.admissionId)
    if(getForm(doc)!==nativeForm || (await readForm(doc)).fingerprint!==before.fingerprint)throw new Error('來源表單已改變，歷史日期回應已忽略。')
    const matches=records.filter(r=>r.source_id===before.reportId)
    const context=contexts.get(before.action)
    if(matches.length){context.entryValues||=context.values;const historyDates=[...new Set(matches.map(r=>r.date))];context.values=[...context.entryValues,...historyDates];context.history=historyDates.join('|')}
    return readForm(doc)
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
    const appliedFields=[]
    operations.sort((a,b)=>fields.findIndex(f=>f[0]===a.item.key)-fields.findIndex(f=>f[0]===b.item.key))
    for (const { item, nodes, type } of operations) {
      if (getForm(doc) !== form || nodes.some(n => !n.isConnected || n.disabled) || type==='select'&&![...nodes[0].options].some(o=>o.value===item.value&&!o.disabled)) {const error=new Error(`原生連動已改變「${before.fields.find(f=>f.key===item.key)?.label}」；已套用 ${appliedFields.length} 個欄位，請重新核對，不會自動重試。`);error.code='SOURCE_PARTIAL_APPLY';error.appliedFields=appliedFields;throw error}
      if (type === 'radio') { for (const n of nodes) n.checked = n.value === item.value }
      else nodes[0].value = item.value
      const node = type === 'radio' ? nodes.find(n => n.checked) : nodes[0]
      node.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }))
      node.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
      appliedFields.push(item.key)
    }
    const after = await readForm(doc)
    if (after.formId !== before.formId || operations.some(({ item }) => after.fields.find(f => f.key === item.key)?.value !== item.value)) {const error=new Error('原生欄位已變更，請檢查已套用內容，不會自動重試。');error.code='SOURCE_PARTIAL_APPLY';error.appliedFields=appliedFields;throw error}
    return { status: 'pending_confirmation', applied: operations.length, target: after }
  }

  // Read only verified teaching cells; remove actions, popovers and injected UI.
  function cellText(node) {
    if (!node) return ''
    const copy = node.cloneNode(true)
    copy.querySelectorAll('script,style,svg,button,input,select,textarea,div,.dropdown,.badge,.admission-comment-box,.tooltip,.popover,.status,[role="tooltip"],[data-edulog-owned]').forEach(n => n.remove())
    copy.querySelectorAll('a').forEach(n => { if (!/^\/(?:students|courses)\/\d+$/.test(path(n.getAttribute('href')))) n.remove() })
    return text(copy)
  }
  function evidence(row, sourcePath, values) {
    return { sourcePath: path(sourcePath), table: row.closest('table')?.id || '學習紀錄', row: [...row.parentElement.children].indexOf(row) + 1, capturedAt: new Date().toISOString(), fields: values.map(([key,label,value]) => ({ key,label,text: String(value || '').slice(0, key === 'content' ? 10000 : 512) })) }
  }
  function fieldLabel(cell, fallback) {
    const header = headerCells(cell?.closest('table'))[cell?.cellIndex]
    return cellText(header) || fallback
  }
  function headerCells(table) {
    return [...(table?.rows || [])].find(r => r.querySelector('th') && [...r.cells].some(c => /^(姓名|學生|上課日期|課次日期|日期)$/.test(cellText(c))))?.cells || []
  }
  function teachingCell(row, labels) {
    const headers = [...headerCells(row.closest('table'))]
    const index = headers.findIndex(c => labels.includes(cellText(c)))
    return index >= 0 ? row.cells[index] : null
  }
  function mergeEvidence(...arrays) {
    const map = new Map()
    for (const e of arrays.flat().filter(Boolean)) { const key = `${e.sourcePath}:${e.table}:${e.row}`, old = map.get(key); map.set(key, { ...old, ...e, fields: [...new Map([...(old?.fields || []), ...e.fields].map(f => [f.key,f])).values()] }) }
    return [...map.values()]
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
      const nameCell = teachingCell(row, ['姓名', '學生']) || row.querySelector('td:has(.admission-comment), td:has(a[href*="/students/"])') || row.cells[0]
      const name = cellText(nameCell?.querySelector(':scope > span:not(.badge), .student-name')) || cellText(rowLinks.find(a => /^\/students\/\d+$/.test(a.path))?.node) || cellText(rowLinks.find(a => /^\/admissions\/comments\//.test(a.path))?.node) || cellText(nameCell)
      // Roster: 姓名 → 年級 → 課程. Reports: 學生 → 課程. Never infer a
      // roster course from adjacency when the site's headers are present.
      const headers = headerCells(row.closest('table'))
      const courseCell = teachingCell(row, ['課程', '課程名稱']) || (!headers.length ? nameCell?.nextElementSibling : null)
      const gradeCell = teachingCell(row, ['年級']), dateCell = teachingCell(row, ['報名時間', '報名日期'])
      const courseLink = links(courseCell || row).find(a => /^\/courses\/(?!dt\/)\d+$/.test(a.path))
      const courseLabel = cellText(courseCell?.querySelector(':scope > span:not(.badge), .course-name')) || cellText(courseLink?.node) || cellText(courseCell)
      const sourceEvidence = [evidence(row, sourcePath, [['student_name',fieldLabel(nameCell,'姓名原文'),name],['course_name',fieldLabel(courseCell,'課程原文'),courseLabel],['grade','年級',cellText(gradeCell)],['admission_date','報名日期原文',cellText(dateCell)],['student_id','來源學生 ID',student],['admission_id','來源報名 ID',admission]])]
      let enrollment = admissions.get(admission)
      if (!enrollment) { enrollment = { kind: 'enrollment', source_id: admission, student_source_id: null, sourceStudentName: '', sourceCourseLabel: '', source_course_id: null, sourceCourseConflict: false, data: { external_link: `${ORIGIN}/dt_admissions/${admission}` }, needs: ['報名日期', '報名狀態'] }; admissions.set(admission, enrollment); records.push(enrollment) }
      enrollment.sourceEvidence = mergeEvidence(enrollment.sourceEvidence || [], sourceEvidence)
      if (student) enrollment.student_source_id = student
      if (name) enrollment.sourceStudentName = name
      if (gradeCell) enrollment.sourceGrade = cellText(gradeCell)
      const admissionDate = fullDate(cellText(dateCell))
      if (admissionDate) { enrollment.data.start_date = admissionDate; enrollment.needs = enrollment.needs.filter(n => n !== '報名日期') }
      if (enrollment.sourceCourseLabel && courseLabel && enrollment.sourceCourseLabel !== courseLabel) enrollment.sourceCourseConflict = true
      if (courseLabel) enrollment.sourceCourseLabel = courseLabel
      if (courseLink) enrollment.source_course_id = courseLink.path.split('/').pop()
      if (enrollment.student_source_id && enrollment.sourceStudentName) {
        const id = enrollment.student_source_id
        if (!students.has(id)) { const record = { kind: 'student', source_id: id, data: { name: enrollment.sourceStudentName, external_link: `${ORIGIN}/students/${id}` }, sourceEvidence }; students.set(id, record); records.push(record) }
        else { students.get(id).data.name = enrollment.sourceStudentName; students.get(id).sourceEvidence = mergeEvidence(students.get(id).sourceEvidence || [], sourceEvidence) }
      }
      for (const link of rowLinks.filter(a => /^\/dt_admissions\/\d+\/reports\/\d+\/edit$/.test(a.path))) {
        const date = fullDate(text(link.node.closest('td'))) || fullDate(link.node.getAttribute('data-date'))
        const reportId = link.path.match(/reports\/(\d+)/)[1]
        if (reportIds.has(reportId)) continue
        reportIds.add(reportId)
        const dateText = text(link.node.closest('td')).match(/\b20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/)?.[0] || (date ? link.node.getAttribute('data-date') : '')
        records.push({ kind: 'report', source_id: reportId, enrollment_source_id: admission, date, sourceEvidence: [evidence(row, sourcePath, [['admission_id','來源報名 ID',admission],['report_id','來源報告 ID',reportId],['date','課次日期原文',dateText]])], data: { external_link: `${ORIGIN}${link.path}` }, needs: ['既有報告欄位', ...(date ? [] : ['完整課次日期'])] })
      }
    }
    for (const r of admissions.values()) if (!r.student_source_id) issues.push({ kind: 'enrollment', source_id: r.source_id, reason: `${r.sourceStudentName || '姓名尚未辨識'}：缺少可靠學生 ID，可指定既有學生；不能新建學生。` })
    return { extractionVersion: 2, sourceOrigin: ORIGIN, sourcePath: path(sourcePath), classId, title, records, issues, admissionPaths: [...admissions.keys()].map(id => `/dt_admissions/${id}`), completeness: 'partial', note: '只列出目前可辨識資料；日期、教材、時段及未取得內容需確認。' }
  }
  function extractHistory(doc, admissionId) {
    const results=[]
    for(const row of doc.querySelectorAll('#page-body > .content table tbody tr')){
      if(!row.querySelector('td'))continue
      const cells=[...row.cells],dateCell=teachingCell(row,['日期','上課日期','課次日期'])||(!headerCells(row.closest('table')).length?cells[1]:null)
      const dateRaw=cellText(dateCell),date=fullDate(dateRaw)
      const ref=links(row).find(a=>new RegExp(`^/dt_admissions/${admissionId}/reports/\\d+(?:/edit)?$`).test(a.path))
      if(!ref&&links(row).some(a=>/^\/dt_admissions\/\d+\/reports\//.test(a.path)))continue
      // A single published report ID can be verified against its actual editor;
      // multiple IDs or row numbers never supply a permanent report identity.
      const queryIds=[...row.querySelectorAll('a[href]')].flatMap(a=>{try{const u=new URL(a.getAttribute('href'),ORIGIN);if(u.origin!==ORIGIN||u.pathname!=='/dt/admissions/lesson_reports/attendance_status')return [];const ids=u.searchParams.getAll('report_ids[]');return ids.length===1&&/^\d+$/.test(ids[0])?ids:[]}catch{return []}})
      const reportId=ref?.path.match(/reports\/(\d+)/)?.[1]||([...new Set(queryIds)].length===1?queryIds[0]:null)
      const contentNode=[...row.querySelectorAll('p')].find(p=>/^評語[：:]/.test(text(p)))
      const content=contentNode?.textContent.trim().replace(/^評語[：:]\s*/,'').slice(0,10000)
      if(!reportId&&!dates.parse(dateRaw).month&&!content)continue
      const editPath=reportId?`/dt_admissions/${admissionId}/reports/${reportId}/edit`:null
      results.push({kind:'report',source_id:reportId,enrollment_source_id:admissionId,date,dateRaw,
        evidenceKey:`${admissionId}:${row.rowIndex}`,identityUnverified:!ref,
        sourceEvidence:[evidence(row,`/dt_admissions/${admissionId}`,[['admission_id','來源報名 ID',admissionId],['report_id','來源報告 ID',reportId],['date','课次日期原文',dateRaw],['content','學習表現原文',content]])],
        data:{...(content?{content}:{}),...(editPath?{external_link:ORIGIN+editPath}:{})},
        needs:[...(!date?['完整上課日期待確認']:[]),...(!reportId?['缺少可靠報告連結，請補上原站編輯連結']:['待讀取已儲存報告欄位'])]})
    }
    const unique=new Map()
    for(const record of results){const key=record.source_id?`report:${record.source_id}`:record.evidenceKey,old=unique.get(key);if(!old){unique.set(key,record);continue}old.sourceEvidence=mergeEvidence(old.sourceEvidence,record.sourceEvidence);old.historyDateValues=[...new Set([...(old.historyDateValues||[old.dateRaw]),record.dateRaw])];if(!old.data.content&&record.data.content)old.data.content=record.data.content}
    return [...unique.values()]
  }
  async function readReport(record, suppliedUrl, confirmedDate) {
    const editPath=path(suppliedUrl||record.data?.external_link),match=editPath.match(/^\/dt_admissions\/(\d+)\/reports\/(\d+)\/edit$/)
    if(!match||match[1]!==record.enrollment_source_id||record.source_id&&match[2]!==record.source_id)throw new Error('編輯連結與來源報名／報告不一致。')
    if(suppliedUrl){const url=new URL(suppliedUrl,ORIGIN);if(url.origin!==ORIGIN||url.search||url.hash||url.username||url.password)throw new Error('請提供原站完整且沒有查詢參數的報告編輯連結。')}
    const doc=await readPath(editPath),action=editPath.replace(/\/edit$/,'')
    const native=[...doc.querySelectorAll('form')].filter(f=>path(f.getAttribute('action'))===action)
    if(native.length!==1)throw new Error('編輯頁未提供唯一且符合目標的原生報告表單。')
    const saved=await readForm(doc,native[0])
    const ownDates=[...doc.querySelectorAll('[data-date],input[type=date]')].filter(n=>!n.closest('form')||n.closest('form')===native[0]).map(n=>n.getAttribute('data-date')||n.value)
    const dateInfo=dates.resolve([record.date||record.dateRaw||'',...record.historyDateValues||[],saved.title,...ownDates],[])
    if(dateInfo.conflict)throw new Error('列表與編輯頁的上課日期矛盾，請核對原站後重讀。')
    if(confirmedDate&&(!dates.parse(confirmedDate).date||dates.parse(confirmedDate).date!==confirmedDate))throw new Error('請提供有效完整上課日期。')
    if(confirmedDate&&dateInfo.date&&confirmedDate!==dateInfo.date)throw new Error('確認日期與可靠來源日期不同，請先核對原站。')
    if(confirmedDate&&record.dateRaw){const checked=dates.resolve([record.dateRaw,confirmedDate],[]);if(checked.conflict)throw new Error('確認日期與來源月日不同。')}
    const date=confirmedDate||dateInfo.date||record.date||null
    const data={...record.data,external_link:ORIGIN+editPath},needs=[]
    for(const field of saved.fields){
      if(field.internal)continue
      if(field.type==='text'){if(field.key==='content'||field.key==='contact_notes')data[field.key]=field.value;continue}
      delete data[field.key]
      const value=globalThis.edulogFieldMappings.canonical(field)
      if(value!==undefined&&!['lesson_id','progress_start','progress_end'].includes(field.key))data[field.key]=value
      else if(field.value!==''&&!field.disabled)needs.push(`「${field.label}」需要確認欄位映射`)
    }
    const lesson=saved.fields.find(f=>f.key==='lesson_id'),sourceLessonLabel=lesson?.options.find(o=>o.value===lesson.value)?.label
    const raw=saved.fields.map(f=>({key:f.key,label:f.label,text:f.options.find(o=>o.value===f.value)?.label||f.value})).filter(f=>f.text!==''&&f.text!==undefined)
    return {...record,source_id:match[2],date,dateInfo:{...dateInfo,basis:confirmedDate?'user_confirmed':dateInfo.basis},identityUnverified:false,sourceReadStatus:'complete',sourceFields:saved.fields,
      sourceLessonLabel,sourceInternalNotes:saved.fields.find(f=>f.internal)?.value||'',data,needs:[...(!date?['完整上課日期待確認']:[]),...needs],
      sourceEvidence:mergeEvidence(record.sourceEvidence||[],[{sourcePath:editPath,table:'已儲存報告欄位',row:1,capturedAt:new Date().toISOString(),fields:raw}])}
  }
  async function readHistory(sourcePath,input={}) {
    if(!/^\/dt_admissions\/\d+$/.test(sourcePath))throw new Error('來源路徑尚未驗證。')
    const records=extractHistory(await readPath(sourcePath),sourcePath.split('/').pop())
    if(input.listOnly)return records
    for(let i=0;i<records.length;i++){
      const record=records[i]
      if(input.dateFrom&&record.date&&record.date<input.dateFrom||input.dateTo&&record.date&&record.date>input.dateTo){record.outsideRange=true;continue}
      if(!record.source_id)continue
      try{records[i]=await readReport(record)}catch(e){record.sourceReadStatus='failed';record.needs=[e.message]}
    }
    return records
  }
  async function readPath(sourcePath) {
    if (!/^\/(?:courses\/dt\/\d+(?:\/lesson[-_]reports)?|dt_admissions\/\d+|dt_admissions\/\d+\/reports\/\d+\/edit)$/.test(sourcePath)) throw new Error('來源路徑尚未驗證。')
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
        else { if (previous.sourceCourseLabel && record.sourceCourseLabel && previous.sourceCourseLabel !== record.sourceCourseLabel) previous.sourceCourseConflict = true; for (const [key, value] of Object.entries(record)) if (value != null && value !== '') previous[key] = key === 'sourceCourseConflict' ? previous[key] || value : key === 'data' ? { ...previous.data, ...value } : key === 'sourceEvidence' ? mergeEvidence(previous.sourceEvidence || [], value) : value }
      }
      snapshot.admissionPaths = [...new Set([...snapshot.admissionPaths, ...richer.admissionPaths])]
    }
    if(input.history)for(const sourcePath of snapshot.admissionPaths){
      if(doc.location.pathname!==initialPath)throw new Error('來源頁已導覽，工作已暫停。')
      try{for(const record of await readHistory(sourcePath,input)){
        const index=record.source_id?snapshot.records.findIndex(r=>r.kind===record.kind&&r.source_id===record.source_id):-1
        if(index<0)snapshot.records.push(record);else snapshot.records[index]={...snapshot.records[index],...record,sourceEvidence:mergeEvidence(snapshot.records[index].sourceEvidence||[],record.sourceEvidence||[])}
      }}catch(e){snapshot.issues.push({kind:'report',source_id:sourcePath.split('/').pop(),reason:e.message})}
    }
    return snapshot
  }
  globalThis.edulogSourceIntegration = Object.freeze({ origin: ORIGIN, extractClass, extractHistory, collect, readForm, getForm, applyForm, digest, supplementForm, resolveFormDate,
    readHistory, readReport,
    context(doc) { const p = doc.location.pathname, page = globalThis.edulogSiteAdapter?.matchPage?.(p), classId = p.match(/^\/courses\/dt\/(\d+)/)?.[1] || null; return { sourceOrigin: ORIGIN, sourcePath: p, classId, title: text(doc.querySelector('#page-body > .content h2')) || page?.title || '', reportOpen: Boolean(getForm(doc)), capabilities: { current_class_import: Boolean(classId && page?.kind !== 'report-editor'), report_prefill: Boolean(getForm(doc) || page?.kind === 'report-editor') } } },
    capabilities: { current_class_import: true, report_prefill: true, all_classes_import: false, submission_confirmation: false },
  })
  if (globalThis.edulogRuntime && typeof document !== 'undefined') globalThis.edulogRuntime.listen((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['integration-context', 'integration-collect', 'integration-history', 'integration-history-report', 'integration-form', 'integration-supplement', 'integration-resolve-date', 'integration-apply', 'integration-apply-inline'].includes(message?.type)) return
    const run = async () => {
      if (message.expectedPath && message.expectedPath !== location.pathname) throw new Error('來源分頁已變更，請重新選擇來源。')
      if (message.type === 'integration-context') return globalThis.edulogSourceIntegration.context(document)
      if (message.type === 'integration-collect') return collect(document, { history: message.history === true })
      if (message.type === 'integration-history') return globalThis.edulogSourceIntegration.readHistory(message.historyPath,{...message.input,listOnly:true})
      if (message.type === 'integration-history-report') return readReport(message.input.record,message.input.editUrl,message.input.confirmedDate)
      if (message.type === 'integration-form') return readForm(document)
      if (message.type === 'integration-supplement') return supplementForm(document,message.input)
      if (message.type === 'integration-resolve-date') return resolveFormDate(document)
      if (message.type === 'integration-apply-inline') return applyForm(document, message.input)
      return applyForm(document, message.input)
    }
    const response = value => { try { respond(value) } catch { /* An updated extension cannot receive this response. Native content is retained. */ } }
    void run().then(data => response({ data }), error => response({ error: { code: error.code||'SOURCE_ACTION_FAILED', message: error.message, appliedFields:error.appliedFields } }))
    return true
  })
})()
