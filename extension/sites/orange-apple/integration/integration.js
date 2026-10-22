(() => {
  const ORIGIN = 'https://corp.orangeapple.co'
  // Source pages may be zh-TW, zh-CN or English; labels are compared through the lexicon's term table.
  const site = globalThis.edulogSiteLexicon.locale
  // UI wording goes through the shared phrasebook (zh-TW / zh-CN / en); data stays in params.
  const tx = (text, params = {}) => globalThis.edulogUi?.tx(text, params) ?? String(text).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
  const text = node => node?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 256) || ''
  const path = value => { try { const u = new URL(value, ORIGIN); return u.origin === ORIGIN ? u.pathname : '' } catch { return '' } }
  const links = node => [...node.querySelectorAll('a[href]')].map(a => ({ path: path(a.getAttribute('href')), node: a }))
  const dates = globalThis.edulogSourceDate
  const fullDate = value => dates.parse(value).date
  const contexts = new Map(), answers = new Map()
  const fullDatePattern = /(?<!\d)(\d{4}\s*(?:[-/.年])\s*\d{1,2}\s*(?:[-/.月])\s*\d{1,2}\s*日?)(?!\d)/g
  const dateTokenPattern = /(?<!\d)(?:\d{4}\s*(?:[-/.年])\s*\d{1,2}\s*(?:[-/.月])\s*\d{1,2}\s*日?|\d{1,2}\s*(?:[-/.月])\s*\d{1,2}\s*日?)(?!\d)/g
  const dateTokens=value=>[...String(value||'').matchAll(dateTokenPattern)].map(match=>match[0])
  function reportDateEvidence(link) {
    const cell=link?.closest('td'),row=cell?.parentElement,table=cell?.closest('table')
    if(!cell||!row||!table)return {date:null,dateRaw:'',dateInfo:dates.resolve([]),headers:[],courseRange:[],cellText:''}
    const column=logicalColumn(row,cell),rows=[...table.rows]
    // Week headers in month/day order whatever the site language (English shows day first).
    const headers=[...new Set(rows.filter(r=>r.querySelector('th')).map(r=>logicalCell(r,column)).filter(Boolean).map(c=>site.canonWeekLabel(cellText(c),c.ownerDocument)).filter(Boolean))]
    const cellRaw=reportText(cell),cellValue=dateTokens(cellRaw).join(' | '),explicit=link.getAttribute('data-date')||''
    const courseCell=teachingCell(row,['課程','課程名稱'])||(!headerCells(table).length?row.cells[1]:null)
    const courseValue=cellText(courseCell)
    const rangeDates=[...courseValue.matchAll(fullDatePattern)].map(match=>match[1])
    const courseRange=rangeDates.length===2?rangeDates:[]
    const dateInfo=dates.resolve([explicit,...headers,cellValue],courseRange.length===2?[courseRange]:[])
    const dateRaw=[explicit,...headers,cellValue].filter(Boolean).join(' | ')
    return {date:dateInfo.date,dateRaw,dateInfo,headers,courseRange,cellText:cellValue}
  }
  function captureEntry(event) {
    const link=event.target.closest?.('a[href]'), action=path(link?.getAttribute('href')).replace(/\/edit$/,'')
    if (!/^\/dt_admissions\/\d+\/reports\/\d+$/.test(action)) return
    const found=reportDateEvidence(link)
    const entryValues=[link.getAttribute('data-date')||'',...found.headers,found.cellText].filter(Boolean)
    const ranges=found.courseRange.length===2?[found.courseRange]:[]
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
    ['classroom_behavior', '課堂秩序', 'input[type="radio"][name="admission_lesson_report[order_rating]"], input[type="radio"][name="admission_lesson_report[behavior_rating]"]'],
    ['learning_status', '學習狀態', '#admission_lesson_report_learning_status'],
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
    if (!form) throw new Error(tx('請先在原站開啟學生的「記錄」編輯視窗。'))
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
    if(before.formId!==input.formId || before.fingerprint!==input.fingerprint)throw new Error(tx('表單或來源證據已改變，請重新核對。'))
    const context=contexts.get(before.action)||{values:[],ranges:[]}
    const evidence=[before.title,...context.values], evidenceKey=JSON.stringify({evidence,ranges:context.ranges,history:context.history||null})
    if(input.clear){answers.delete(before.action);return readForm(doc)}
    if(input.clearEnrollment){const saved=answers.get(before.action);if(saved){delete saved.enrollmentId;delete saved.binding;if(!saved.date)answers.delete(before.action)}return readForm(doc)}
    if(input.date && (!dates.parse(input.date).date || dates.parse(input.date).date!==input.date))throw new Error(tx('請選擇有效的完整上課日期。'))
    if(input.date && before.dateInfo.conflict && input.conflictAcknowledged!==true)throw new Error(tx('請先確認已核對矛盾的來源日期。'))
    if(input.enrollmentId && !/^[a-f0-9-]{36}$/i.test(input.enrollmentId))throw new Error(tx('報名識別碼格式不正確。'))
    answers.set(before.action,{...answers.get(before.action),evidenceKey,...(input.date?{date:input.date}:{}),...(input.enrollmentId?{enrollmentId:input.enrollmentId,binding:input.binding||null}:{})})
    return readForm(doc)
  }
  async function resolveFormDate(doc) {
    const before=await readForm(doc), nativeForm=getForm(doc)
    if(before.date)return before
    if(!contexts.has(before.action))contexts.set(before.action,{values:[],ranges:[]})
    const records=extractHistory(await readPath(`/dt_admissions/${before.admissionId}`),before.admissionId)
    if(getForm(doc)!==nativeForm || (await readForm(doc)).fingerprint!==before.fingerprint)throw new Error(tx('來源表單已改變，歷史日期回應已忽略。'))
    const matches=records.filter(r=>r.source_id===before.reportId)
    const context=contexts.get(before.action)
    if(matches.length){context.entryValues||=context.values;const historyDates=[...new Set(matches.map(r=>r.date))];context.values=[...context.entryValues,...historyDates];context.history=historyDates.join('|')}
    return readForm(doc)
  }
  async function applyForm(doc, input) {
    const before = await readForm(doc)
    if (before.fingerprint !== input.fingerprint || before.formId !== input.formId || before.reportId !== input.reportId) throw new Error(tx('原站表單或內容已變更，請重新檢查欄位。'))
    if (!Array.isArray(input.fields) || input.fields.length > fields.length || new Set(input.fields.map(f => f.key)).size !== input.fields.length) throw new Error(tx('預填欄位格式不正確。'))
    const form = getForm(doc), operations = []
    for (const item of input.fields) {
      const spec = fields.find(f => f[0] === item.key), snapshot = before.fields.find(f => f.key === item.key)
      if (!spec || !snapshot || snapshot.disabled || typeof item.value !== 'string' || item.value.length > 10000) throw new Error(tx('目標欄位不可預填。'))
      if (snapshot.internal && item.includeInternal !== true) throw new Error(tx('內部紀錄尚未確認。'))
      if (snapshot.value && snapshot.value !== item.value && item.overwrite !== true) throw new Error(tx('原站已有內容，請明確確認覆寫。'))
      if (snapshot.type !== 'text' && !snapshot.options.some(o => o.value === item.value && !o.disabled)) throw new Error(tx('原站選項已變更，請人工選擇。'))
      operations.push({ item, nodes: [...form.querySelectorAll(spec[2])], type: snapshot.type })
    }
    if (path(form.getAttribute('action')) !== before.action || getForm(doc) !== form) throw new Error(tx('原站目標表單已變更。'))
    for (const field of before.fields) {
      const selector = fields.find(f => f[0] === field.key)[2], nodes = [...form.querySelectorAll(selector)]
      const current = field.type === 'radio' ? nodes.find(n => n.checked)?.value || '' : nodes[0]?.value
      if (current !== field.value) throw new Error(tx('原站內容已變更，請重新檢查欄位。'))
    }
    // Validate every field before modifying any native node. Never submit/click
    // confirmation controls. Native change events retain original dependencies.
    const appliedFields=[]
    operations.sort((a,b)=>fields.findIndex(f=>f[0]===a.item.key)-fields.findIndex(f=>f[0]===b.item.key))
    for (const { item, nodes, type } of operations) {
      if (getForm(doc) !== form || nodes.some(n => !n.isConnected || n.disabled) || type==='select'&&![...nodes[0].options].some(o=>o.value===item.value&&!o.disabled)) {const error=new Error(tx('原生連動已改變「{field}」；已套用 {count} 個欄位，請重新核對，不會自動重試。',{field:before.fields.find(f=>f.key===item.key)?.label,count:appliedFields.length}));error.code='SOURCE_PARTIAL_APPLY';error.appliedFields=appliedFields;throw error}
      if (type === 'radio') { for (const n of nodes) n.checked = n.value === item.value }
      else nodes[0].value = item.value
      const node = type === 'radio' ? nodes.find(n => n.checked) : nodes[0]
      node.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }))
      node.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
      appliedFields.push(item.key)
    }
    const after = await readForm(doc)
    if (after.formId !== before.formId || operations.some(({ item }) => after.fields.find(f => f.key === item.key)?.value !== item.value)) {const error=new Error(tx('原生欄位已變更，請檢查已套用內容，不會自動重試。'));error.code='SOURCE_PARTIAL_APPLY';error.appliedFields=appliedFields;throw error}
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
    return [...(table?.rows || [])].find(r => r.querySelector('th') && [...r.cells].some(c => site.isTerm(cellText(c), '姓名', '學生', '上課日期', '課次日期', '日期')))?.cells || []
  }
  const tableGrids=new WeakMap()
  function tableGrid(table){
    if(!table)return[]
    if(tableGrids.has(table))return tableGrids.get(table)
    const grid=[],rows=[...table.rows]
    rows.forEach((row,rowIndex)=>{grid[rowIndex]||=[];let column=0;for(const cell of [...row.cells]){while(grid[rowIndex][column])column++;const width=Math.max(1,Number(cell.colSpan)||1),height=Math.max(1,Number(cell.rowSpan)||1);for(let r=rowIndex;r<Math.min(rows.length,rowIndex+height);r++){grid[r]||=[];for(let c=column;c<column+width;c++)grid[r][c]=cell}column+=width}})
    tableGrids.set(table,grid);return grid
  }
  function logicalCell(row,column){const table=row?.closest('table'),index=table?[...table.rows].indexOf(row):-1;return index>=0?tableGrid(table)[index]?.[column]||null:null}
  function logicalColumn(row,cell){const grid=tableGrid(row?.closest('table'))[[...row.closest('table').rows].indexOf(row)]||[];return grid.indexOf(cell)}
  function teachingCell(row, labels) {
    const table=row.closest('table'),headerRow=[...(table?.rows||[])].find(r=>r.querySelector('th')&&[...r.cells].some(c=>site.isTerm(cellText(c),...labels)))
    const header=[...(headerRow?.cells||[])].find(c=>site.isTerm(cellText(c),...labels))
    const column=header?logicalColumn(headerRow,header):-1
    return column>=0?logicalCell(row,column):null
  }
  function reportText(node) {
    if (!node) return ''
    const copy=node.cloneNode(true)
    copy.querySelectorAll('script,style,svg,button,input,select,textarea,.dropdown,.badge,.admission-comment-box,.tooltip,.popover,.status,[role="tooltip"],[data-edulog-owned]').forEach(n=>n.remove())
    copy.querySelectorAll('a[href]').forEach(a=>{try{const u=new URL(a.getAttribute('href'),ORIGIN);if(u.origin===ORIGIN&&u.pathname==='/dt/admissions/lesson_reports/attendance_status')a.remove()}catch{}})
    return [...copy.querySelectorAll(':scope > p')].map(p=>p.textContent.trim()).filter(Boolean).join('\n') || copy.textContent.replace(/\u00a0/g,' ').replace(/[\t ]+/g,' ').trim()
  }
  function labeledValue(container, labelText) {
    for (const label of container?.querySelectorAll('label,strong,b,dt')||[]) {
      if (!site.isTerm(text(label), labelText)) continue
      const parent=label.parentElement
      let value='',found=false
      for (const child of parent.childNodes) {
        if (child===label) { found=true; continue }
        if (!found) continue
        if (child.nodeType===1 && child.matches('label,strong,b,dt')) break
        if (child.nodeType===1 && child.matches('p,span,dd')) value += `${value?'\n':''}${child.textContent.trim()}`
        else if (child.nodeType===3) value+=child.textContent
        else if (child.nodeType===1 && !child.matches('button,input,select,textarea,.dropdown,.badge,.admission-comment-box,.tooltip,.popover,.status,[role="tooltip"],[data-edulog-owned]')) value+=child.textContent
      }
      value=value.replace(/\u00a0/g,' ').replace(/^[\s：:]+|[\s]+$/g,'').trim()
      if (value || found) return value.slice(0,10000)
      const next=label.nextElementSibling
      if(next&&['P','DD','SPAN'].includes(next.tagName))return next.textContent.trim().slice(0,10000)
    }
    const inline=[...(container?.querySelectorAll('p')||[])].find(node=>site.leadTerm(node.textContent,labelText)!==null)
    if(inline)return inline.textContent.trim().replace(/^[^：:]+[：:]\s*/,'').slice(0,10000)
    return undefined
  }
  const completionValue=value=>{const v=site.canonLabel(value.trim());return /^(?:完整完成|已完成|完成|all_done|complete|completed)$/i.test(v)?true:/^(?:尚未完成|未完成|not_all_done|incomplete)$/i.test(v)?false:undefined}
  const lessonStage=value=>{const m=value.match(/(?:Lesson|L)\s*(\d+)/i);return m?Number(m[1]):undefined}
  const learningStatusLabels={on_track:'能跟上進度',hard_to_follow:'跟不上進度 (太難)',distracted:'跟不上進度 (分心)'}
  const markedLearningStatus=(status,notes='')=>{const label=learningStatusLabels[status];return label?`[corp.learning_status:${status}]\n${label}\n[/corp.learning_status]${notes?`\n\n${notes}`:''}`:notes}
  function admissionCourse(doc) {
    const item=[...doc.querySelectorAll('#admission-data li')].find(li=>site.leadTerm(text(li),'課程名稱')!==null)
    const raw=site.leadTerm(item?.textContent||'','課程名稱')||''
    const match=raw.match(/^(.*?)\s*\(([a-z][a-z0-9-]{1,63})\)\s*$/i)
    return {sourceCourseName:(match?.[1]||raw).trim(),sourceCourseCode:match?.[2]?.toLowerCase()||null,sourceCourseLabel:raw||null}
  }
  function admissionStudent(doc) {
    const item=[...doc.querySelectorAll('#admission-data li')].find(li=>site.leadTerm(text(li),'學生')!==null)
    const link=[...(item?.querySelectorAll('a[href]')||[])].map(a=>({node:a,path:(()=>{try{const u=new URL(a.getAttribute('href'),ORIGIN);return u.origin===ORIGIN?u.pathname:''}catch{return ''}})()})).find(a=>/^\/students\/\d+$/.test(a.path))
    const id=link?.path.match(/^\/students\/(\d+)$/)?.[1]||null
    const name=link?text(link.node):site.leadTerm(item?.textContent||'','學生')||''
    return {sourceStudentName:name,student_source_id:id}
  }
  function sourceCourseCode(label) { return label?.match(/\(([a-z][a-z0-9-]{1,63})\)\s*$/i)?.[1]?.toLowerCase()||null }
  function mergeEvidence(...arrays) {
    const map = new Map()
    for (const e of arrays.flat().filter(Boolean)) { const key = `${e.sourcePath}:${e.table}:${e.row}`, old = map.get(key); map.set(key, { ...old, ...e, fields: [...new Map([...(old?.fields || []), ...e.fields].map(f => [`${f.key}:${f.label}`,f])).values()] }) }
    return [...map.values()]
  }
  function extractClass(doc, sourcePath) {
    const classId = path(sourcePath).match(/^\/courses\/dt\/(\d+)(?:\/lesson[-_]reports)?$/)?.[1]
    if (!classId || !doc.querySelector('#page-body > .content')) throw new Error(tx('此頁無法辨識班級，請從班級工作區開始。'))
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
      const courseCode=sourceCourseCode(courseLabel)
      const sourceEvidence = [evidence(row, sourcePath, [['student_name',fieldLabel(nameCell,'姓名原文'),name],['course_name',fieldLabel(courseCell,'課程原文'),courseLabel],['grade','年級',cellText(gradeCell)],['admission_date','報名日期原文',cellText(dateCell)],['student_id','來源學生 ID',student],['admission_id','來源報名 ID',admission]])]
      let enrollment = admissions.get(admission)
      if (!enrollment) { enrollment = { kind: 'enrollment', source_id: admission, student_source_id: null, sourceStudentName: '', sourceCourseLabel: '', source_course_id: null, sourceCourseCode:null, sourceCourseConflict: false, data: { external_link: `${ORIGIN}/dt_admissions/${admission}` }, needs: ['報名日期', '報名狀態'] }; admissions.set(admission, enrollment); records.push(enrollment) }
      enrollment.sourceEvidence = mergeEvidence(enrollment.sourceEvidence || [], sourceEvidence)
      if (student) enrollment.student_source_id = student
      if (name) enrollment.sourceStudentName = name
      if (gradeCell) enrollment.sourceGrade = cellText(gradeCell)
      const admissionDate = fullDate(cellText(dateCell))
      if (admissionDate) { enrollment.data.start_date = admissionDate; enrollment.needs = enrollment.needs.filter(n => n !== '報名日期') }
      if (enrollment.sourceCourseLabel && courseLabel && enrollment.sourceCourseLabel !== courseLabel) enrollment.sourceCourseConflict = true
      if (courseLabel) enrollment.sourceCourseLabel = courseLabel
      if(courseCode&&enrollment.sourceCourseCode&&enrollment.sourceCourseCode!==courseCode)enrollment.sourceCourseConflict=true
      if(courseCode){enrollment.sourceCourseCode=courseCode;enrollment.source_course_id=`code:${courseCode}`}
      else if (courseLink&&!enrollment.sourceCourseCode) enrollment.source_course_id = courseLink.path.split('/').pop()
      if (enrollment.student_source_id && enrollment.sourceStudentName) {
        const id = enrollment.student_source_id
        if (!students.has(id)) { const record = { kind: 'student', source_id: id, data: { name: enrollment.sourceStudentName, external_link: `${ORIGIN}/students/${id}` }, sourceEvidence }; students.set(id, record); records.push(record) }
        else { students.get(id).data.name = enrollment.sourceStudentName; students.get(id).sourceEvidence = mergeEvidence(students.get(id).sourceEvidence || [], sourceEvidence) }
      }
      for (const link of rowLinks.filter(a => /^\/dt_admissions\/\d+\/reports\/\d+\/edit$/.test(a.path))) {
        const dateEvidence=reportDateEvidence(link.node),date=dateEvidence.date
        const reportId = link.path.match(/reports\/(\d+)/)[1]
        if (reportIds.has(reportId)) continue
        reportIds.add(reportId)
        const dateNeeds=dateEvidence.dateInfo.conflict?'來源日期欄頭、儲存格與課程期間不一致，請核對日期。':!date?dateEvidence.dateInfo.reason||'缺少可確認年份的日期依據，請核對日期。':null
        records.push({ kind: 'report', source_id: reportId, enrollment_source_id: admission, sourceClassId: classId, sourceClassBasis: 'class-page', date, dateRaw:dateEvidence.dateRaw,dateInfo:{...dateEvidence.dateInfo,raw:[...dateEvidence.headers,dateEvidence.cellText,...dateEvidence.courseRange].filter(Boolean)},dateEvidence:{explicit:link.node.getAttribute('data-date')||'',headers:dateEvidence.headers,cellText:dateEvidence.cellText,courseRange:dateEvidence.courseRange}, sourceEvidence: [evidence(row, sourcePath, [['admission_id','來源報名 ID',admission],['report_id','來源報告 ID',reportId],['date','課次日期',date||''],['date_header','日期欄頭',dateEvidence.headers.join(' | ')],['date_cell','日期儲存格原文',dateEvidence.cellText],['course_date_range','同列課程期間',dateEvidence.courseRange.join(' ~ ')],['date_resolution','日期判定',dateNeeds||'已由日期欄頭及課程期間確認']])], data: { external_link: `${ORIGIN}${link.path}` }, needs: ['既有報告欄位', ...(dateNeeds?[dateNeeds]:[])] })
      }
    }
    for (const r of admissions.values()) if (!r.student_source_id) issues.push({ kind: 'enrollment', source_id: r.source_id, reason: `${r.sourceStudentName || '姓名尚未辨識'}：缺少可靠學生 ID，可指定既有學生；不能新建學生。` })
    return { extractionVersion: 2, sourceOrigin: ORIGIN, sourcePath: path(sourcePath), classId, title, records, issues, admissionPaths: [...admissions.keys()].map(id => `/dt_admissions/${id}`), completeness: 'partial', note: '只列出目前可辨識資料；日期、教材、時段及未取得內容需確認。' }
  }
  function extractHistory(doc, admissionId) {
    const results=[]
    const course=admissionCourse(doc)
    const student=admissionStudent(doc)
    for(const row of doc.querySelectorAll('#page-body > .content table tbody tr')){
      if(!row.querySelector('td'))continue
      const cells=[...row.cells],dateCell=teachingCell(row,['日期','上課日期','課次日期'])||(!headerCells(row.closest('table')).length?cells[1]:null)
      const dateRaw=reportText(dateCell),date=fullDate(dateRaw)
      const rowLinks=links(row),reportRefs=rowLinks.filter(a=>/^\/dt_admissions\/\d+\/reports\/\d+(?:\/edit)?$/.test(a.path))
      const ref=reportRefs.find(a=>new RegExp(`^/dt_admissions/${admissionId}/reports/\\d+(?:/edit)?$`).test(a.path))
      const foreignRefs=reportRefs.filter(a=>a!==ref),ownerAdmissions=[...new Set(foreignRefs.map(a=>a.path.match(/^\/dt_admissions\/(\d+)\//)?.[1]).filter(Boolean))]
      const sessionCell=teachingCell(row,['堂次']),sessionRaw=sessionCell?reportText(sessionCell):''
      const isPreviousAdmission=/前\s*一\s*報名/.test(sessionRaw)
      if(reportRefs.length&&!ref&&!isPreviousAdmission)continue
      const ownerRef=isPreviousAdmission?(ownerAdmissions.length===1?foreignRefs.find(a=>a.path.startsWith(`/dt_admissions/${ownerAdmissions[0]}/`)):null):ref
      const ownerAdmission=ownerRef?.path.match(/^\/dt_admissions\/(\d+)\//)?.[1]||(isPreviousAdmission?null:admissionId)
      // A single published report ID can be verified against its actual editor;
      // multiple IDs or row numbers never supply a permanent report identity.
      const queryIds=[...row.querySelectorAll('a[href]')].flatMap(a=>{try{const u=new URL(a.getAttribute('href'),ORIGIN);if(u.origin!==ORIGIN||u.pathname!=='/dt/admissions/lesson_reports/attendance_status')return [];const ids=u.searchParams.getAll('report_ids[]');return ids.length===1&&/^\d+$/.test(ids[0])?ids:[]}catch{return []}})
      const reportId=ownerRef?.path.match(/reports\/(\d+)/)?.[1]||null
      const lookupReportIds=[...new Set(queryIds)]
      // The history page uses label + sibling paragraphs as well as table columns.
      // Never capture administrative cells or the whole evaluation container.
      const assessment=teachingCell(row,['學習評估'])||cells.find(c=>c.querySelector('label,strong,b')||site.labelPattern('評語','學習表現','聯絡欄','紀錄','內部紀錄').test(reportText(c)))
      const sourceFields=[],data={}
      const field=(key,label,value,{internal=false,type='text',options=[{value,label:value,disabled:false}]}={})=>{if(value===undefined)return;sourceFields.push({key,label,type,value,options,internal,disabled:false})}
      const setValue=(key,label,value,canonical,config)=>{field(key,label,value,config);if(canonical!==undefined)data[key]=canonical}
      const attendance=teachingCell(row,['出席狀況','出席狀態']);if(attendance){const raw=reportText(attendance).split('\n')[0].trim(),term=site.canonLabel(raw),canonical=/^(?:不出席|未出席|缺席)$/.test(term)?'absent':/^(?:出席|出席試聽|試聽出席)$/.test(term)?'present':undefined;if(raw&&!site.isTerm(raw,'設為不出席'))setValue('attendance_status','出席狀況',raw,canonical,{type:'select',options:[{value:raw,label:raw,disabled:false}]})}
      const progressCell=teachingCell(row,['課程進度']);const stageRaw=progressCell?reportText(progressCell):''
      const stageLabel=labeledValue(assessment,'最新課程階段')??labeledValue(assessment,'學習課程')??labeledValue(assessment,'教材')
      const stageSource=stageLabel||stageRaw,stageNumber=lessonStage(stageSource||'')
      if(stageSource&&stageNumber!==undefined){const value=`lesson:${stageNumber}`;field('lesson_id','最新課程階段',value,{type:'stage',options:[{value,label:`Lesson ${stageNumber}`,disabled:false}]})}
      const completionRaw=labeledValue(assessment,'課程進度')??labeledValue(assessment,'完成狀況');if(completionRaw!==undefined){const options=[{value:completionRaw,label:completionRaw,disabled:false}];field('is_completed','完成狀況',completionRaw,{type:'select',options});const complete=completionValue(completionRaw);if(complete!==undefined)data.is_completed=complete}
      const rows=[...(assessment?.querySelectorAll(':scope > .row')||[])],scoreNodes=[...(rows[0]?.querySelectorAll(':scope > [class*="col-"] span')||[])],scores=scoreNodes.map(n=>n.textContent.trim());
      for(const [i,key] of ['class_participation','classroom_behavior'].entries()){const label=i?'課堂秩序':'課程參與',raw=labeledValue(assessment,i?'課堂秩序':'課程參與評分')??(i?labeledValue(assessment,'課堂表現'):labeledValue(assessment,'課程參與'))??scores[i];if(i<2&&/^(?:[0-5](?:\.5)?)$/.test(raw||'')){const value=Number(raw);field(key,label,raw,{type:'score'});data[key]=value}}
      const details=[['content','評語'],['contact_notes','聯絡欄']];for(const [key,label]of details){const value=labeledValue(assessment,label);if(value!==undefined){field(key,label,value);data[key]=value}}
      const recordLabel=labeledValue(assessment,'紀錄')??labeledValue(assessment,'內部紀錄');
      if(recordLabel!==undefined){const labelNode=[...(assessment?.querySelectorAll('label,strong,b,dt')||[])].find(n=>site.isTerm(text(n),'紀錄','內部紀錄'));let paragraphs=[];if(labelNode){for(let n=labelNode.nextElementSibling;n&&n.tagName==='P';n=n.nextElementSibling)paragraphs.push(n.textContent.trim())}if(!paragraphs.length)paragraphs=recordLabel.split('\n');const statusText=paragraphs[0]||'',statusEntry=Object.entries(learningStatusLabels).find(([,label])=>label===site.canonLabel(statusText)),internalNotes=paragraphs.slice(1).join('\n');if(statusText){const known=statusEntry?.[0];field('class_notes','學習狀態原文',statusText,{internal:true});if(known)sourceFields.at(-1).learningStatus=known;else sourceFields.at(-1).unknownLearningStatus=true}if(internalNotes)field('class_notes','內部紀錄',internalNotes,{internal:true})}
      const detailProgress=labeledValue(assessment,'進度細項')??labeledValue(assessment,'章節進度');if(detailProgress){field('progress_letter','進度細項',detailProgress);const m=detailProgress.match(/^(?:Section\s*)?([A-Z])\s*(?:(?:到|至|to|–|-)\s*(?:Section\s*)?([A-Z]))?$/);if(m)data.progress_letter=m[2]?`${m[1]}-${m[2]}`:m[1]}
      const statusCell=teachingCell(row,['出席狀況','出席狀態']),statusText=statusCell?reportText(statusCell):''
      const attendanceAction=rowLinks.some(a=>a.path==='/dt/admissions/lesson_reports/attendance_status')||site.pattern('設為不出席').test(statusText)
      const holiday=site.pattern('休假日','停課','課程取消').test(statusText||sessionRaw)
      const persistedValues=Object.entries(data).filter(([key,value])=>key!=='external_link'&&!(holiday&&key==='attendance_status')&&value!==undefined&&value!==null&&value!=='')
      const hasTeachingContent=persistedValues.length>0||sourceFields.some(f=>!(holiday&&f.key==='attendance_status')&&f.value!==''&&f.value!==undefined&&f.value!==null)
      const rowType=isPreviousAdmission?(ownerRef?'previous-admission':'other-admission'):holiday&&!hasTeachingContent?'system-excluded':attendanceAction&&!hasTeachingContent?'unfilled':'report'
      if(!reportId&&!date&&!hasTeachingContent&&!attendanceAction&&!isPreviousAdmission&&!holiday)continue
      const editPath=reportId&&ownerAdmission?`/dt_admissions/${ownerAdmission}/reports/${reportId}/edit`:null
      const sessionOrdinal=sessionRaw.match(/\d+/)?.[0]||null
      const sameAdmission=ownerAdmission===admissionId
      results.push({kind:'report',source_id:reportId,enrollment_source_id:ownerAdmission||admissionId,sourceOwnerAdmissionId:ownerAdmission,sourceAdmissionContextVerified:sameAdmission,sourceRowType:rowType,sourceRowReason:isPreviousAdmission&&!ownerRef?'無法從原生報告連結確認前一報名。':undefined,sourceLookupReportId:lookupReportIds.length===1?lookupReportIds[0]:null,sourceLookupReportIds:lookupReportIds,sourceAttendanceAction:attendanceAction,sourceStudentName:sameAdmission?student.sourceStudentName:'',student_source_id:sameAdmission?student.student_source_id:null,date,dateRaw,sourceSessionOrdinal:sessionOrdinal,sourceSessionLabel:sessionRaw,sourceCourseName:sameAdmission?course.sourceCourseName:'',sourceCourseCode:sameAdmission?course.sourceCourseCode:null,sourceCourseLabel:sameAdmission?course.sourceCourseLabel:null,sourceLessonSequence:stageNumber,
        identityUnverified:!reportId,
        sourceEvidence:[evidence(row,`/dt_admissions/${admissionId}`,[['admission_id','目前頁面報名 ID',admissionId],['owner_admission_id','列所屬報名 ID',ownerAdmission],['student_id','來源學生 ID',sameAdmission?student.student_source_id:null],['student_name','學生姓名原文',sameAdmission?student.sourceStudentName:''],['report_id','原生報告編輯 ID',reportId],['attendance_lookup_id','設為不出席連結查找 ID',lookupReportIds.join(',')],['course_name','來源課程名稱',sameAdmission?course.sourceCourseName:''],['course_code','來源課程代碼',sameAdmission?course.sourceCourseCode:''],['date','課次日期原文',dateRaw],['row_type','來源列類型',rowType],...sourceFields.map(f=>[f.key,f.label,f.value])])],
        sourceFields,sourceLessonLabel:stageLabel||stageRaw||undefined,sourceLessonSequence:lessonStage(stageLabel||stageRaw||''),sourceLearningStatus:sourceFields.find(f=>f.learningStatus)?.learningStatus||null,sourceLearningStatusRaw:sourceFields.find(f=>f.label==='學習狀態原文')?.value||'',sourceInternalNotes:sourceFields.filter(f=>f.internal&&!f.learningStatus).map(f=>f.value).join('\n'),
        data:{...data,...(editPath?{external_link:ORIGIN+editPath}:{})},sourceReadStatus:'list',
        needs:[...(!date&&rowType==='report'?['完整上課日期待確認']:[]),...(reportId?['待讀取已儲存報告欄位']:[])]})
    }
    // Only a reportId identifies a report; rows without one stay separate evidence.
    const unique=new Map(),rows=[]
    for(const record of results){if(!record.source_id){rows.push(record);continue}const key=`report:${record.source_id}`,old=unique.get(key);if(!old){unique.set(key,record);rows.push(record);continue}old.sourceEvidence=mergeEvidence(old.sourceEvidence,record.sourceEvidence);old.historyDateValues=[...new Set([...(old.historyDateValues||[old.dateRaw]),record.dateRaw])];if(!old.data.content&&record.data.content)old.data.content=record.data.content}
    return rows
  }
  // The report editor's own 學習紀錄節次 link. The admission's current 梯次/節次
  // and navigation menus are never a report's class.
  function reportSessionClass(doc) {
    const ids=new Set()
    for(const node of doc.querySelectorAll('label,strong,b,dt,th,span,li,p,td')){
      if(node.closest('#admission-data,nav,.dropdown-menu,.sidebar,[data-edulog-owned]'))continue
      const own=[...node.childNodes].filter(n=>n.nodeType===3||n.nodeType===1&&!n.matches('a')).map(n=>n.textContent).join('').replace(/\s+/g,'')
      if(!/^(?:學習紀錄)?節次[：:]?$/.test(own))continue
      const scope=node.querySelector('a[href]')?node:node.parentElement
      for(const a of scope?.querySelectorAll('a[href]')||[]){const id=path(a.getAttribute('href')).match(/^\/courses\/dt\/(\d+)$/)?.[1];if(id)ids.add(id)}
    }
    return ids.size===1?[...ids][0]:null
  }
  // Rows without a reportId are attendance evidence: date, count and class.
  function attendanceEvidence(records) {
    const days=new Map()
    for(const record of records){
      if(record.kind!=='report'||record.source_id||!record.date||!['report','unfilled'].includes(record.sourceRowType))continue
      const key=`${record.enrollment_source_id}:${record.date}`,day=days.get(key)||{kind:'attendance',source_id:`attendance:${key}`,enrollment_source_id:record.enrollment_source_id,date:record.date,attendance_count:0,present_count:0,absent_count:0,sourceClassId:null,sourceEvidence:[]}
      day.attendance_count++;if(record.data?.attendance_status==='present')day.present_count++;if(record.data?.attendance_status==='absent')day.absent_count++
      day.sourceEvidence=mergeEvidence(day.sourceEvidence,record.sourceEvidence||[]);days.set(key,day)
    }
    return [...days.values()]
  }
  async function readReport(record, suppliedUrl, confirmedDate) {
    const editPath=path(suppliedUrl||record.data?.external_link),match=editPath.match(/^\/dt_admissions\/(\d+)\/reports\/(\d+)\/edit$/)
    if(!match||match[1]!==record.enrollment_source_id||record.source_id&&match[2]!==record.source_id)throw new Error(tx('編輯連結與來源報名／報告不一致。'))
    if(suppliedUrl){const url=new URL(suppliedUrl,ORIGIN);if(url.origin!==ORIGIN||url.search||url.hash||url.username||url.password)throw new Error(tx('請提供原站完整且沒有查詢參數的報告編輯連結。'))}
    const doc=await readPath(editPath),action=editPath.replace(/\/edit$/,'')
    const native=[...doc.querySelectorAll('form')].filter(f=>path(f.getAttribute('action'))===action)
    if(native.length!==1)throw new Error(tx('編輯頁未提供唯一且符合目標的原生報告表單。'))
    const saved=await readForm(doc,native[0])
    const sourceReportClassId=reportSessionClass(doc)
    const ownDates=[...doc.querySelectorAll('[data-date],input[type=date]')].filter(n=>!n.closest('form')||n.closest('form')===native[0]).map(n=>n.getAttribute('data-date')||n.value)
    const storedDateEvidence=record.dateEvidence||{}
    const dateInfo=dates.resolve([record.date||'',record.dateRaw||'',...record.historyDateValues||[],storedDateEvidence.explicit||'',...storedDateEvidence.headers||[],storedDateEvidence.cellText||'',saved.title,...ownDates],storedDateEvidence.courseRange?.length===2?[storedDateEvidence.courseRange]:[])
    if(record.dateInfo?.conflict||dateInfo.conflict)throw new Error(tx('列表與編輯頁的上課日期矛盾，請核對原站後重讀。'))
    if(confirmedDate&&(!dates.parse(confirmedDate).date||dates.parse(confirmedDate).date!==confirmedDate))throw new Error(tx('請提供有效完整上課日期。'))
    if(confirmedDate&&dateInfo.date&&confirmedDate!==dateInfo.date)throw new Error(tx('確認日期與可靠來源日期不同，請先核對原站。'))
    if(confirmedDate&&record.dateRaw){const checked=dates.resolve([record.dateRaw,confirmedDate],[]);if(checked.conflict)throw new Error(tx('確認日期與來源月日不同。'))}
    const date=confirmedDate||dateInfo.date||record.date||null
    const data={...record.data,external_link:ORIGIN+editPath},needs=[],sourceFieldConflicts=[]
    let sourceLearningStatus=record.sourceLearningStatus||null,sourceLearningStatusRaw=record.sourceLearningStatusRaw||''
    for(const field of saved.fields){
      if(field.key==='learning_status') {const known=Object.hasOwn(learningStatusLabels,field.value)?field.value:null,raw=known?'':field.options.find(o=>o.value===field.value)?.label||field.value;if(record.sourceFields.some(f=>f.label==='學習狀態原文')&&(known!==record.sourceLearningStatus||raw!==record.sourceLearningStatusRaw)){sourceFieldConflicts.push({key:field.key,label:'學習狀態',listValue:record.sourceLearningStatusRaw||'空白',editValue:raw||'空白'});needs.push('列表與報告編輯頁的學習狀態不同，請核對原站。')}sourceLearningStatus=known;sourceLearningStatusRaw=raw;continue}
      if(field.internal)continue
      const listField=record.sourceFields.find(f=>f.key===field.key&&!f.internal)
      if(listField){
        const sourceValue=globalThis.edulogFieldMappings.canonical(listField),editorValue=globalThis.edulogFieldMappings.canonical(field)
        let same=sourceValue!==undefined&&editorValue!==undefined&&sourceValue===editorValue
        if(field.key==='lesson_id'&&record.sourceLessonSequence){const editorLabel=field.options.find(o=>o.value===field.value)?.label||'';same=lessonStage(editorLabel)===record.sourceLessonSequence}
        if(!same&&(sourceValue===undefined||editorValue===undefined))same=String(listField.value??'').trim().replace(/\s+/g,' ')==String(field.options.find(o=>o.value===field.value)?.label||field.value||'').trim().replace(/\s+/g,' ')
        if(!same){const conflict={key:field.key,label:field.label,listValue:listField.options?.find(o=>o.value===listField.value)?.label||String(listField.value??'空白'),editValue:field.options.find(o=>o.value===field.value)?.label||String(field.value||'空白')};sourceFieldConflicts.push(conflict);needs.push(`列表與報告編輯頁的「${field.label}」不同，請核對原站。`)}
      }
      if(field.type==='text'){if(field.key==='content'||field.key==='contact_notes')data[field.key]=field.value;continue}
      delete data[field.key]
      const value=globalThis.edulogFieldMappings.canonical(field)
      if(value!==undefined&&!['lesson_id','progress_start','progress_end'].includes(field.key))data[field.key]=value
      else if(field.value!==''&&!field.disabled)needs.push(`「${field.label}」需要確認欄位映射`)
    }
    const lesson=saved.fields.find(f=>f.key==='lesson_id'),sourceLessonLabel=lesson?.options.find(o=>o.value===lesson.value)?.label
    const raw=saved.fields.map(f=>({key:f.key,label:f.label,text:f.options.find(o=>o.value===f.value)?.label||f.value})).filter(f=>f.text!==''&&f.text!==undefined)
    const internalField=saved.fields.find(f=>f.key==='class_notes'),internalNotes=internalField?.value??record.sourceInternalNotes??''
    if(internalField&&record.sourceFields.some(f=>f.label==='內部紀錄')&&internalNotes!==record.sourceInternalNotes){sourceFieldConflicts.push({key:'class_notes',label:'內部紀錄',listValue:record.sourceInternalNotes||'空白',editValue:internalNotes||'空白'});needs.push('列表與報告編輯頁的「內部紀錄」不同，請核對原站。')}
    const mergedFields=[...record.sourceFields||[]]
    for(const f of saved.fields.filter(f=>f.key!=='class_notes')){const i=mergedFields.findIndex(old=>old.key===f.key);if(i<0)mergedFields.push(f);else mergedFields[i]={...mergedFields[i],...f}}
    for(const f of saved.fields.filter(f=>f.key==='class_notes')){const i=mergedFields.findIndex(old=>old.key==='class_notes'&&old.label==='內部紀錄');if(i<0)mergedFields.push(f);else mergedFields[i]={...mergedFields[i],...f}}
    if(sourceLearningStatusRaw&&!sourceLearningStatus)needs.push('原站學習狀態無法辨識，請選擇原站實際選項。')
    const classFromPage=record.sourceClassBasis==='class-page'&&record.sourceClassId
    return {...record,source_id:match[2],date,dateInfo:{...dateInfo,basis:confirmedDate?'user_confirmed':dateInfo.basis},identityUnverified:false,sourceReadStatus:'complete',sourceFields:mergedFields,sourceFieldConflicts,
      sourceReportClassId,sourceClassId:classFromPage?record.sourceClassId:sourceReportClassId||null,sourceClassBasis:classFromPage?'class-page':sourceReportClassId?'report-page':null,
      sourceLessonLabel,sourceLearningStatus,sourceLearningStatusRaw,sourceInternalNotes:internalNotes,data,needs:[...(!date?['完整上課日期待確認']:[]),...needs],
      sourceEvidence:mergeEvidence(record.sourceEvidence||[],[{sourcePath:editPath,table:'已儲存報告欄位',row:1,capturedAt:new Date().toISOString(),fields:raw}])}
  }
  async function readHistory(sourcePath,input={}) {
    if(!/^\/dt_admissions\/\d+$/.test(sourcePath))throw new Error(tx('來源路徑尚未驗證。'))
    const currentAdmission=sourcePath.split('/').pop(),currentDoc=await readPath(sourcePath)
    let records=extractHistory(currentDoc,currentAdmission)
    const currentStudent=admissionStudent(currentDoc)
    const previousAdmissions=[...new Set(records.filter(r=>r.sourceRowType==='previous-admission').map(r=>r.enrollment_source_id))]
    for(const previousId of previousAdmissions){
      const rows=records.filter(r=>r.enrollment_source_id===previousId&&r.sourceRowType==='previous-admission')
      try{
        const previousDoc=await readPath(`/dt_admissions/${previousId}`),previousStudent=admissionStudent(previousDoc),previousCourse=admissionCourse(previousDoc)
        const studentMatches=Boolean(currentStudent.student_source_id&&previousStudent.student_source_id&&currentStudent.student_source_id===previousStudent.student_source_id)
        const courseReliable=Boolean(previousCourse.sourceCourseName&&previousCourse.sourceCourseCode)
        for(const record of rows){
          if(!studentMatches||!courseReliable){record.sourceRowType='other-admission';record.sourceAdmissionContextVerified=false;record.sourceRowReason=!studentMatches?'前一報名無法以可靠學生 ID 確認為同一學生。':'前一報名未提供可辨識課程。';continue}
          record.sourceAdmissionContextVerified=true;record.sourceStudentName=previousStudent.sourceStudentName;record.student_source_id=previousStudent.student_source_id
          record.sourceCourseName=previousCourse.sourceCourseName;record.sourceCourseCode=previousCourse.sourceCourseCode;record.sourceCourseLabel=previousCourse.sourceCourseLabel
          record.sourceEvidence=mergeEvidence(record.sourceEvidence,[{sourcePath:`/dt_admissions/${previousId}`,table:'原報名資料',row:1,capturedAt:new Date().toISOString(),fields:[['admission_id','前一報名 ID',previousId],['student_id','前一報名學生 ID',previousStudent.student_source_id],['student_name','前一報名學生姓名',previousStudent.sourceStudentName],['course_name','前一報名課程',previousCourse.sourceCourseName],['course_code','前一報名課程代碼',previousCourse.sourceCourseCode]].map(([key,label,value])=>({key,label,text:String(value||'')}))}])
        }
      }catch{
        for(const record of rows){record.sourceRowType='other-admission';record.sourceAdmissionContextVerified=false;record.sourceRowReason='無法讀取前一報名以確認學生與課程歸屬。'}
      }
    }
    for(const record of records)if(record.source_id)record.historyKey=`report:${record.enrollment_source_id}:${record.source_id}`
    records=[...records,...attendanceEvidence(records)]
    if(input.listOnly)return records
    for(let i=0;i<records.length;i++){
      const record=records[i]
      if(input.dateFrom&&record.date&&record.date<input.dateFrom||input.dateTo&&record.date&&record.date>input.dateTo){record.outsideRange=true;continue}
      if(record.kind!=='report'||!record.source_id||!['report','previous-admission'].includes(record.sourceRowType))continue
      try{records[i]=await readReport(record)}catch(e){record.sourceReadStatus='failed';record.needs=[e.message]}
    }
    return records
  }
  async function readPreviousTeaching(sourcePath,beforeDate) {
    if(!/^\/dt_admissions\/\d+$/.test(sourcePath))throw Object.assign(new Error(tx('來源報名位置尚未驗證。')),{code:'SOURCE_PATH_UNAVAILABLE'})
    if(!/^\d{4}-\d{2}-\d{2}$/.test(beforeDate||'')||!dates.parse(beforeDate).date)throw Object.assign(new Error(tx('原站未提供可核對的完整課次日期，無法判斷上次教學。')),{code:'SESSION_DATE_UNAVAILABLE'})
    const admissionId=sourcePath.split('/').pop(),listed=await readHistory(sourcePath,{listOnly:true})
    const groups=new Map()
    for(const record of listed){
      if(record.kind!=='report'||record.sourceRowType!=='report'||record.enrollment_source_id!==admissionId||!record.date||record.date>=beforeDate)continue
      const items=groups.get(record.date)||[];items.push(record);groups.set(record.date,items)
    }
    const datesDescending=[...groups.keys()].sort((a,b)=>b.localeCompare(a))
    const hasContent=record=>['content','contact_notes','class_notes','lesson_id','progress_start','progress_end','progress_letter','class_participation','classroom_behavior'].some(key=>Object.hasOwn(record.data||{},key)&&record.data[key]!==undefined&&record.data[key]!==null&&record.data[key]!=='')||Boolean(record.sourceLessonLabel||record.sourceInternalNotes)
    for(const date of datesDescending){
      const candidates=[]
      for(const record of groups.get(date)){
        const full=record.source_id?await readReport(record):record
        if((full.sourceReadStatus==='complete'||full.sourceReadStatus==='list')&&hasContent(full))candidates.push(full)
      }
      const present=candidates.map(record=>({
        sourceId:record.source_id,date:record.date,lesson:record.sourceLessonLabel||record.sourceFields?.find(f=>f.key==='lesson_id')?.options?.find(o=>o.value===record.sourceFields.find(f=>f.key==='lesson_id')?.value)?.label||'',
        completed:Object.hasOwn(record.data||{},'is_completed')?record.data.is_completed:null,
        progress:record.data?.progress_letter??null,content:record.data?.content||'',internalNotes:record.data?.class_notes||record.sourceInternalNotes||'',
        participation:Object.hasOwn(record.data||{},'class_participation')?record.data.class_participation:null,
        behavior:Object.hasOwn(record.data||{},'classroom_behavior')?record.data.classroom_behavior:null,
        contactNotes:record.data?.contact_notes||'',externalLink:record.data?.external_link||''
      }))
      if(present.length>1)return {status:'ambiguous',date,reports:present,readAt:new Date().toISOString()}
      if(present.length===1)return {status:'found',report:present[0],readAt:new Date().toISOString()}
    }
    return {status:'none',readAt:new Date().toISOString()}
  }
  async function resolveSessionDate(sourcePath, suppliedUrl) {
    if(!/^\/dt_admissions\/\d+$/.test(sourcePath))throw Object.assign(new Error(tx('來源報名位置尚未驗證。')),{code:'SOURCE_PATH_UNAVAILABLE'})
    const url=new URL(suppliedUrl,ORIGIN),match=url.pathname.match(/^\/dt_admissions\/(\d+)\/reports\/(\d+)\/edit\/?$/)
    if(url.origin!==ORIGIN||url.search||url.hash||url.username||url.password||!match||match[1]!==sourcePath.split('/').pop())throw Object.assign(new Error(tx('課次報告連結與來源報名不一致。')),{code:'SOURCE_REPORT_MISMATCH'})
    const doc=await readPath(sourcePath),record=extractHistory(doc,sourcePath.split('/').pop()).find(item=>item.source_id===match[2]&&item.enrollment_source_id===match[1])
    if(!record)throw Object.assign(new Error(tx('目前報名中找不到所選課次的報告。')),{code:'SOURCE_REPORT_NOT_FOUND'})
    const full=await readReport(record,url.href)
    if(!full.date)throw Object.assign(new Error(tx('所選課次的原站報告沒有提供完整日期。')),{code:'SESSION_DATE_UNAVAILABLE'})
    return {date:full.date,reportId:full.source_id,enrollmentId:full.enrollment_source_id}
  }
  async function readPath(sourcePath) {
    if (!/^\/(?:courses\/dt\/\d+(?:\/lesson[-_]reports)?|dt_admissions\/\d+|dt_admissions\/\d+\/reports\/\d+\/edit)$/.test(sourcePath)) throw new Error(tx('來源路徑尚未驗證。'))
    const response = await fetch(`${ORIGIN}${sourcePath}`, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/html' } })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error(tx('來源頁暫時無法讀取或權限不足。'))
    const html = await response.text()
    if (html.length > 5_000_000) throw new Error(tx('來源頁超過可處理大小。'))
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
      if(doc.location.pathname!==initialPath)throw new Error(tx('來源頁已導覽，工作已暫停。'))
      try{for(const record of await readHistory(sourcePath,input)){
        if(record.kind==='attendance')record.sourceClassId=snapshot.classId
        const index=record.source_id?snapshot.records.findIndex(r=>r.kind===record.kind&&r.source_id===record.source_id):-1
        if(index<0){snapshot.records.push(record);continue}
        const previous=snapshot.records[index],classPage=previous.sourceClassBasis==='class-page'
        snapshot.records[index]={...previous,...record,...(classPage?{sourceClassId:previous.sourceClassId,sourceClassBasis:'class-page'}:{}),sourceEvidence:mergeEvidence(previous.sourceEvidence||[],record.sourceEvidence||[])}
      }}catch(e){snapshot.issues.push({kind:'report',source_id:sourcePath.split('/').pop(),reason:e.message})}
    }
    return snapshot
  }
  globalThis.edulogSourceIntegration = Object.freeze({ origin: ORIGIN, extractClass, extractHistory, collect, readForm, getForm, applyForm, digest, supplementForm, resolveFormDate,
    readHistory, readReport, readPreviousTeaching, resolveSessionDate,
    // Native controls of one mapped field, so the assistant can point at what it filled.
    fieldNodes(doc, key) { const form = getForm(doc), spec = fields.find(f => f[0] === key); return form && spec ? [...form.querySelectorAll(spec[2])] : [] },
    context(doc) { const p = doc.location.pathname, page = globalThis.edulogSiteAdapter?.matchPage?.(p), classId = p.match(/^\/courses\/dt\/(\d+)/)?.[1] || null; return { sourceOrigin: ORIGIN, sourcePath: p, classId, title: text(doc.querySelector('#page-body > .content h2')) || page?.title || '', reportOpen: Boolean(getForm(doc)), capabilities: { current_class_import: Boolean(classId && page?.kind !== 'report-editor'), report_prefill: Boolean(getForm(doc) || page?.kind === 'report-editor') } } },
    capabilities: { current_class_import: true, report_prefill: true, all_classes_import: false, submission_confirmation: false },
  })
  if (globalThis.edulogRuntime && typeof document !== 'undefined') globalThis.edulogRuntime.listen((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['integration-context', 'integration-collect', 'integration-history', 'integration-history-report', 'integration-form', 'integration-supplement', 'integration-resolve-date', 'integration-apply', 'integration-apply-inline'].includes(message?.type)) return
    const run = async () => {
      if (message.expectedPath && message.expectedPath !== location.pathname) throw new Error(tx('來源分頁已變更，請重新選擇來源。'))
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
