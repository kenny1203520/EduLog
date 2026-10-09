import './field-mappings.js'
import './field-mapping-ui.js'

// Metadata stays in the trusted snapshot. Only returned canonical data enters an import.
export function mappedReport(record, courseId, lessons = []) {
  const m = globalThis.edulogFieldMappings, data = { ...record.data }, needs = []
  const rules = (record.fieldRules || []).filter(rule => rule.field_key === 'lesson_id' ? rule.course_id === courseId : !rule.course_id)
  const choices = record.fieldChoices?.courseId === courseId ? record.fieldChoices.fields || {} : {}
  let start, end
  for (const field of record.sourceFields || []) {
    if (!['lesson_id','is_completed','progress_start','progress_end','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes'].includes(field.key)) continue
    if (field.internal || field.type === 'text') continue
    delete data[field.key]
    if (field.disabled) continue
    if (m.empty(field.value)) continue
    const choice = choices[field.key]
    let value = choice?.signature === m.signature(field) && choice.sourceValue === field.value ? choice.value : m.canonical(field, rules)
    if (field.key === 'lesson_id' && field.type === 'stage') {
      const sequence=Number(String(field.value).match(/^lesson:(\d+)$/)?.[1])
      if(Number.isInteger(sequence)){const matches=lessons.filter(l=>l.course_id===courseId&&Number(l.sequence)===sequence);if(value!==undefined&&!matches.some(l=>l.id===value))value=undefined;if(value===undefined&&matches.length===1)value=matches[0].id;if(value===undefined&&matches.length>1)needs.push(`來源 Lesson ${sequence} 在此課程有多個教材候選，請選擇。`);if(value===undefined&&!matches.length)needs.push(`此課程沒有序號 ${sequence} 的教材，請核對課程或手動對應。`)}
    }
    if (field.key === 'lesson_id') {
      if (value !== undefined && !lessons.some(l => l.id === value && l.course_id === courseId)) value = undefined
    }
    if (field.key.startsWith('progress_') && value === undefined) {
      const option = field.options.find(o => o.value === field.value && !o.disabled)
      if (/^[A-Z]$/.test(option?.label?.trim() || '')) value = option.label.trim()
    }
    if (value === undefined) {
      // A disabled dependent field is not currently applicable, rather than missing.
      if (!field.disabled) needs.push(`「${field.label}」的原站值「${field.options.find(o => o.value === field.value)?.label || field.value}」尚未確認映射`)
      continue
    }
    if (field.key === 'progress_start') start = value
    else if (field.key === 'progress_end') end = value
    else data[field.key] = value
  }
  if (start || end) {
    if (!start || !end || start > end) needs.push('請確認有效的章節起點與終點')
    else data.progress_letter = start === end ? start : `${start}-${end}`
  }
  if(record.historyLessonCourse===courseId&&lessons.some(l=>l.id===record.historyLessonId&&l.course_id===courseId))data.lesson_id=record.historyLessonId
    if (!data.lesson_id && record.sourceLessonLabel && !(record.sourceFields||[]).some(f=>f.key==='lesson_id'&&f.type==='stage')) {
    needs.push('教材尚未確認對應；請選擇已核對的 EduLog 教材')
  }
  return { data, needs }
}

export function attachImportFields(parent, record, hooks) {
  const doc = parent.ownerDocument, make = (tag, text) => { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; return n }
  const live=()=>hooks.record?.()||record
  const reportLabel=record.source_id?`報告 #${record.source_id}`:`${record.sourceStudentName||`來源報名 #${record.enrollment_source_id}`} · ${record.date||record.dateRaw||`堂次 ${record.sourceSessionOrdinal||'未辨識'}`}`
  const details = make('details'), summary = make('summary', `${reportLabel}：核對教學欄位與映射`)
  const load = make('button', '讀取此報告的欄位映射'), status = make('p')
  details.className = 'import-field-review'; details.dataset.reviewKey=`field-review:${record.source_id||record.historyKey||record.evidenceKey||record.enrollment_source_id}`; load.type = 'button'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
  details.append(summary, status, load); parent.append(details)
  const editor = make('div'); details.append(editor)
  let busy = false, sequence = 0
  load.addEventListener('click', async () => {
    if (busy) return
    busy = true; load.disabled = true; status.textContent = '正在讀取已確認映射與教材候選…'
    const owner = hooks.work(), courseId = hooks.courseId(), serial = ++sequence
    const current = () => owner === hooks.work() && courseId === hooks.courseId() && details.isConnected && serial === sequence
    try {
      if (!courseId || courseId === 'new') throw new Error('請先確認此報名的既有 EduLog 課程；新課程需先於 EduLog 建立教材。')
      await hooks.resolve(live(), courseId)
      if (!current()) return
      const query = make('input'); query.type = 'search'; query.placeholder = '搜尋此課程教材'; query.setAttribute('aria-label', '搜尋此課程教材')
      const more = make('button', '查詢教材／載入更多'); more.type = 'button'
      let cursor, search = '', loaded = false
      const loadLessons = async () => {
        if (more.disabled) return
        more.disabled = true; status.textContent = '正在讀取教材候選…'
        try {
          if (search !== query.value.trim()) { search = query.value.trim(); cursor = undefined; loaded = false }
          const page = await hooks.catalog('lessons', { course_id: courseId, search: search || undefined, cursor })
          if (!current()) return
          hooks.ingestLessons(page.items || []); cursor = page.next_cursor || undefined; loaded = true
          build(); status.textContent = `已取得 ${page.items?.length || 0} 筆教材${cursor ? '，可載入更多' : '，已到清單結尾'}。`
        } catch (e) { if (current()) status.textContent = `教材查詢未完成：${e.message}；選擇保留。` }
        finally { more.disabled = loaded && !cursor && search === query.value.trim(); more.textContent = cursor ? '載入更多教材' : '教材已到清單結尾' }
      }
      query.addEventListener('input', () => { more.disabled = false; more.textContent = '查詢教材' })
      more.addEventListener('click', () => void loadLessons())
      let controls
      function build() {
        if (!current()) return
        controls?.remove(); controls = make('div'); editor.append(controls)
        if(live().sourceLessonLabel&&!(live().sourceFields||[]).some(f=>f.key==='lesson_id'&&f.type==='stage')) {
          const label=make('label',`教材原文：${live().sourceLessonLabel}`),select=make('select');select.add(new Option('請確認 EduLog 教材',''));for(const lesson of globalThis.edulogFieldMappingUI.sortLessons(hooks.lessons().filter(l=>l.course_id===courseId)))select.add(new Option(globalThis.edulogFieldMappings.lessonLabel(lesson),lesson.id));select.value=live().historyLessonCourse===courseId?live().historyLessonId||'':'';label.append(select);controls.append(label)
          select.addEventListener('change',()=>{if(!current())return;live().historyLessonId=select.value;live().historyLessonCourse=courseId;hooks.changed()})
        }
        live().fieldChoices ||= { courseId, fields: {} }
        if (live().fieldChoices.courseId !== courseId) live().fieldChoices = { courseId, fields: {} }
        for (const field of live().sourceFields || []) {
          if (field.internal || field.type === 'text' || globalThis.edulogFieldMappings.empty(field.value)) continue
          const row = make('section'), label = make('label', `${field.label} · 原站：${field.options.find(o => o.value === field.value)?.label || field.value}`), select = make('select')
          row.dataset.reviewField=field.key
          label.append(select); select.append(new Option('請確認此欄位的 EduLog 意義', ''))
          const values = globalThis.edulogFieldMappingUI.choices(field, {}, hooks.lessons().filter(l => l.course_id === courseId))
          values.forEach(([value, text]) => select.append(new Option(text, JSON.stringify(value))))
          const mapped = mappedReport(live(), courseId, hooks.lessons()).data
          const value = field.key.startsWith('progress_') ? mapped.progress_letter?.split('-')[field.key === 'progress_start' ? 0 : mapped.progress_letter.split('-').length - 1] : mapped[field.key]
          if (value !== undefined) select.value = JSON.stringify(value)
          select.disabled = field.disabled
          const message = make('p', field.disabled ? '原站連動停用，目前不適用；不匯入此欄位。' : '選擇只適用於本份報告；確認記憶後才會跨裝置沿用。')
          row.append(label, message); controls.append(row)
          select.addEventListener('change', () => { if (!current()) return; const target=live();if (select.value === '') delete target.fieldChoices.fields[field.key]; else target.fieldChoices.fields[field.key] = { value: JSON.parse(select.value), sourceValue: field.value, signature: globalThis.edulogFieldMappings.signature(field) }; hooks.changed() })
          globalThis.edulogFieldMappingUI.attach(row, field, value === undefined ? {} : { [field.key]: value }, live().fieldRules || [], {
            enabled: hooks.capable(), sourceValue: field.value, lessons: hooks.lessons().filter(l => l.course_id === courseId), isCurrent: current,
            scopeLabel: field.key==='lesson_id'?(hooks.courseName?.(courseId)||'此課程'):'所有學生與報告',
            confirm: item => hooks.api('field-confirm', { source_origin: 'https://corp.orangeapple.co', adapter_version: 'orange-apple-v1', items: [{ ...item, ...(field.key==='lesson_id'?{course_id:courseId}:{}) }] }),
            changed: (_rules,change) => { const target=live();if(change?.action==='confirm'&&target.fieldChoices?.courseId===courseId){const choice=target.fieldChoices.fields?.[field.key];if(choice?.sourceValue===change.sourceValue&&choice.signature===globalThis.edulogFieldMappings.signature(field))delete target.fieldChoices.fields[field.key]}const data = mappedReport(target, courseId, hooks.lessons()).data; if (data[field.key] !== undefined) select.value = JSON.stringify(data[field.key]); hooks.shareRule?.(target.fieldRules||[],change); hooks.changed() },
          })
        }
      }
      editor.replaceChildren(query, more); build(); status.textContent = '已讀取映射；請核對未知選項。教材候選按需查詢。'
    } catch (e) { if (current()) status.textContent = `讀取未完成：${e.message}` }
    finally { busy = false; if (load.isConnected) { load.disabled = false; load.textContent = '重新核對欄位映射' } }
  })
}
