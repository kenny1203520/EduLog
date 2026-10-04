import './field-mappings.js'
import './field-mapping-ui.js'

// Metadata stays in the trusted snapshot. Only returned canonical data enters an import.
export function mappedReport(record, courseId, lessons = []) {
  const m = globalThis.edulogFieldMappings, data = { ...record.data }, needs = []
  const rules = record.fieldRuleScope === courseId ? record.fieldRules || [] : []
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
  if (!data.lesson_id && record.sourceLessonLabel && !(record.sourceFields||[]).some(f=>f.key==='lesson_id')) {
    needs.push('教材尚未確認對應；請選擇已核對的 EduLog 教材')
  }
  return { data, needs }
}

export function attachImportFields(parent, record, hooks) {
  const doc = parent.ownerDocument, make = (tag, text) => { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; return n }
  const details = make('details'), summary = make('summary', `報告 #${record.source_id}：核對教學欄位與映射`)
  const load = make('button', '讀取此報告的欄位映射'), status = make('p')
  details.className = 'import-field-review'; load.type = 'button'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
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
      await hooks.resolve(record, courseId)
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
        if(record.sourceLessonLabel&&!(record.sourceFields||[]).some(f=>f.key==='lesson_id')) {
          const label=make('label',`教材原文：${record.sourceLessonLabel}`),select=make('select');select.add(new Option('請確認 EduLog 教材',''));for(const lesson of hooks.lessons().filter(l=>l.course_id===courseId))select.add(new Option(lesson.title,lesson.id));select.value=record.historyLessonCourse===courseId?record.historyLessonId||'':'';label.append(select);controls.append(label)
          select.addEventListener('change',()=>{if(!current())return;record.historyLessonId=select.value;record.historyLessonCourse=courseId;hooks.changed()})
        }
        record.fieldChoices ||= { courseId, fields: {} }
        if (record.fieldChoices.courseId !== courseId) record.fieldChoices = { courseId, fields: {} }
        for (const field of record.sourceFields || []) {
          if (field.internal || field.type === 'text' || globalThis.edulogFieldMappings.empty(field.value)) continue
          const row = make('section'), label = make('label', `${field.label} · 原站：${field.options.find(o => o.value === field.value)?.label || field.value}`), select = make('select')
          label.append(select); select.append(new Option('請確認此欄位的 EduLog 意義', ''))
          const values = globalThis.edulogFieldMappingUI.choices(field, {}, hooks.lessons().filter(l => l.course_id === courseId))
          values.forEach(([value, text]) => select.append(new Option(text, JSON.stringify(value))))
          const mapped = mappedReport(record, courseId, hooks.lessons()).data
          const value = field.key.startsWith('progress_') ? mapped.progress_letter?.split('-')[field.key === 'progress_start' ? 0 : mapped.progress_letter.split('-').length - 1] : mapped[field.key]
          if (value !== undefined) select.value = JSON.stringify(value)
          select.disabled = field.disabled
          const message = make('p', field.disabled ? '原站連動停用，目前不適用；不匯入此欄位。' : '選擇只適用於本份報告；確認記憶後才會跨裝置沿用。')
          row.append(label, message); controls.append(row)
          select.addEventListener('change', () => { if (!current()) return; if (select.value === '') delete record.fieldChoices.fields[field.key]; else record.fieldChoices.fields[field.key] = { value: JSON.parse(select.value), sourceValue: field.value, signature: globalThis.edulogFieldMappings.signature(field) }; hooks.changed() })
          globalThis.edulogFieldMappingUI.attach(row, field, value === undefined ? {} : { [field.key]: value }, record.fieldRules || [], {
            enabled: hooks.capable(), sourceValue: field.value, lessons: hooks.lessons().filter(l => l.course_id === courseId), isCurrent: current,
            confirm: item => hooks.api('field-confirm', { source_origin: 'https://corp.orangeapple.co', adapter_version: 'orange-apple-v1', items: [{ ...item, course_id: courseId }] }),
            changed: () => { const data = mappedReport(record, courseId, hooks.lessons()).data; if (data[field.key] !== undefined) select.value = JSON.stringify(data[field.key]); hooks.changed() },
          })
        }
      }
      editor.replaceChildren(query, more); build(); status.textContent = '已讀取映射；請核對未知選項。教材候選按需查詢。'
    } catch (e) { if (current()) status.textContent = `讀取未完成：${e.message}` }
    finally { busy = false; if (load.isConnected) { load.disabled = false; load.textContent = '重新核對欄位映射' } }
  })
}
