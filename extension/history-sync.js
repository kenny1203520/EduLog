import { mappedReport } from './import-field-mappings.js'
import './field-mappings.js'

export const teachingFields = ['lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link']
export const historyIdentity = r => `${r.enrollment_source_id}:${r.historyKey || (r.source_id ? `report:${r.source_id}` : r.evidenceKey || '')}`

// This planner consumes permission-filtered, fully paginated server results.
// It never creates a class occurrence or infers a transfer from a class name.
export function planHistory(records, enrollmentTargets, archives, routes, options = {}) {
  const items = [], seen = new Map()
  for (const record of records.filter(r => r.kind === 'report')) {
    const key = historyIdentity(record), target = enrollmentTargets.get(record.enrollment_source_id)
    if (record.date && (record.date < options.dateFrom || record.date > options.dateTo)) continue
    const fingerprint = JSON.stringify({ date: record.date, fields: record.sourceFields, data: record.data })
    if (seen.has(key)) {
      if (seen.get(key).fingerprint !== fingerprint) { seen.get(key).category = 'needs'; seen.get(key).reason = '同一來源身份出現不同內容，請補讀並核對。' }
      continue
    }
    const item = { key, record, target, fingerprint, category: 'history', reason: '沒有唯一合法課次，先保存報名歷史。' }
    seen.set(key, item); items.push(item)
    if (record.sourceSkipped) { item.category = 'skipped'; item.reason = '已明確略過。'; continue }
    if (!target) { item.category = 'needs'; item.reason = '請先確認這筆來源報名的學生與課程。'; continue }
    if (!record.date || record.sourceDateConflict) { item.category = 'needs'; item.reason = '需要您確認完整日期；矛盾日期不能直接保存。'; continue }
    if (record.sourceReadStatus === 'failed') { item.category = 'needs'; item.reason = '報告編輯頁尚未完整讀取，請重試或略過。'; continue }
    if (!record.historyKey && !record.source_id && !record.evidenceKey) { item.category = 'needs'; item.reason = '來源證據不足，請補讀紀錄。'; continue }
    const previous = (archives.get(target.id) || []).filter(h => h.source_admission_id === record.enrollment_source_id)
    const sourceKey = record.historyKey || (record.source_id ? `report:${record.source_id}` : `evidence:${record.evidenceKey}`)
    item.sourceKey = sourceKey; item.existing = previous.find(h => h.source_key === sourceKey)
    if(item.existing&&item.existing.report_date!==record.date){item.category='needs';item.reason='來源日期與已保存歷史不同；請核對原站與 EduLog，保留舊紀錄。';continue}
    const mapped = mappedReport(record, target.courseId, options.lessons || [])
    const mappingNeeds=[...mapped.needs]
    if(record.sourceLearningStatusRaw&&!record.sourceLearningStatus)mappingNeeds.push('原站學習狀態尚未辨識；請選擇原站實際選項。')
    if(record.sourceFieldConflicts?.length&&!record.sourceConflictAcknowledged)mappingNeeds.push('列表與報告編輯頁的欄位內容不同；請核對原文後再匯入。')
    if(globalThis.edulogFieldMappings.splitClassNotes(record.data?.class_notes||'').invalid)mappingNeeds.push('已保存的學習狀態標記重複或內容不符，請重新核對內部紀錄。')
    item.mappingNeeds = mappingNeeds
    item.data = { enrollment_id: target.id, report_date: record.date, source_origin: 'https://corp.orangeapple.co', source_admission_id: record.enrollment_source_id, source_key: sourceKey, identity_status: record.source_id && !record.identityUnverified ? 'verified' : 'evidence_only',
      source_fields: (record.sourceFields || []).filter(f => !f.internal || options.includeInternal).filter(f => ['attendance_status','absence_reason','lesson_id','progress_start','progress_end','is_completed','class_participation','classroom_behavior','content','contact_notes','class_notes','sourceLessonLabel','progress_letter'].includes(f.key)).map(f => ({key:f.key,label:f.label || f.key,text:String(f.value ?? '')})),
      source_evidence: (record.sourceEvidence || []).slice(-50).map(e => ({source_path:e.sourcePath,table:e.table,row:e.row,captured_at:e.capturedAt})),
    }
    if (item.data.identity_status === 'verified') { item.data.source_report_id = record.source_id; item.data.external_link = `https://corp.orangeapple.co/dt_admissions/${record.enrollment_source_id}/reports/${record.source_id}/edit` }
    if(item.existing?.source_evidence?.length)item.data.source_evidence=[...item.existing.source_evidence,...item.data.source_evidence.filter(e=>!item.existing.source_evidence.some(old=>old.source_path===e.source_path&&old.table===e.table&&old.row===e.row))].slice(-50)
    for (const field of teachingFields.filter(f => f !== 'external_link' && f !== 'class_notes')) if (mapped.data[field] !== undefined && (mapped.data[field] !== '' || ['content','contact_notes','absence_reason'].includes(field))) item.data[field] = mapped.data[field]
    if (options.includeInternal && (record.sourceInternalNotes||record.sourceLearningStatus||record.sourceLearningStatusRaw)) item.data.class_notes=globalThis.edulogFieldMappings.composeClassNotes(record.sourceLearningStatus,record.sourceInternalNotes,record.sourceLearningStatusRaw&&!record.sourceLearningStatus?record.sourceLearningStatusRaw:'')
    if (!item.existing && previous.some(h => h.report_date === record.date && (item.data.identity_status === 'evidence_only' || h.identity_status === 'evidence_only')) && !record.historyDuplicateConfirmed) { item.category = 'needs'; item.identityAmbiguous=true; item.reason = '同日已有身份不足的歷史；請核對內容改變或同日另一筆，不自動產生第二份。'; continue }
    if (item.existing?.linked_report_id) {
      const changed = [...teachingFields,'source_fields'].some(f => Object.hasOwn(item.data,f) && JSON.stringify(item.data[f]) !== JSON.stringify(item.existing[f]))
      item.category = changed ? 'needs' : 'linked'; item.reason = changed ? '已綁定報告的来源內容改變；請在主站核對既有報告。' : '已保存並綁定課次；不重複新增。'; continue
    }
    const candidates = (routes.get(target.id) || []).filter(o => o.occurrence_date === record.date)
    item.candidates = candidates
    const chosen = record.historyOccurrenceId ? candidates.find(o => o.id === record.historyOccurrenceId) : candidates.length === 1 ? candidates[0] : undefined
    if (record.historyOnly) { item.reason = '已選擇先存歷史，不變更課次報告。'; continue }
    if (candidates.length > 1 && !chosen) { item.category = 'needs'; item.reason = '同日有多個合法課次，請選擇或先存歷史。'; continue }
    if (mappingNeeds.length) { item.category='needs';item.reason = `${mappingNeeds.join('；')}。選擇確認、重讀或略過後再同步。`; continue }
    if (!chosen || !chosen.can_write) { if (chosen) item.reason = '無目標課次報告寫入權限，先保存歷史。'; continue }
    if (!teachingFields.some(f => !['external_link','class_notes'].includes(f) && Object.hasOwn(item.data,f))) { item.reason = '尚無已確認的教學欄位，保留來源證據。'; continue }
    item.occurrence = chosen
    item.conflicts = teachingFields.filter(f => Object.hasOwn(item.data,f) && chosen.report?.[f] != null && chosen.report[f] !== '' && JSON.stringify(item.data[f]) !== JSON.stringify(chosen.report[f]))
    if (item.conflicts.length && !record.historyConflictConfirmed) { item.category = 'needs'; item.reason = '既有課次報告有不同內容，請核對保留或逐欄覆寫。'; continue }
    item.category = 'bind'; item.reason = `${chosen.class_name} · ${chosen.occurrence_date} · 有效名單已核對，報名關係不變。`
  }
  for(const item of items) {
    const sameDay=items.filter(i=>i!==item&&i.target?.id===item.target?.id&&i.record.date===item.record.date&&i.data&&i.category!=='skipped')
    if(item.data?.identity_status==='evidence_only'&&sameDay.length&&!item.record.historyDuplicateConfirmed){item.category='needs';item.identityAmbiguous=true;item.reason='同日有多筆且無可靠報告 ID；請確認是不同紀錄，或略過重複項目。'}
    else if(item.category==='bind'&&sameDay.some(i=>i.occurrence?.id===item.occurrence.id&&!i.record.historyOnly)){item.category='needs';item.reason='同日多份來源報告可能綁到同一課次；請選一份綁定，其餘先存歷史。'}
  }
  return items
}

/** Binding responses are checked against the exact summary the teacher saw. */
export function bindingStillMatches(item, preview) {
  if (preview?.report_version !== (item.occurrence?.report?.version ?? null)) return false
  if (!item.occurrence?.enrollment) return true // Legacy summaries still receive SQL preview/apply validation.
  return preview.occurrence?.class_session_id === item.occurrence.class_session_id
    && preview.occurrence?.occurrence_date === item.occurrence.occurrence_date
    && JSON.stringify(preview.enrollment) === JSON.stringify(item.occurrence.enrollment)
}
