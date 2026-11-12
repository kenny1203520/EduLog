import { mappedReport } from './import-field-mappings.js'
import { mergeClearToken, mergeSignature } from './history-merge.js'
import '../shared/field-mappings.js'

export const teachingFields = ['lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link']
const lessonProgressFields = ['lesson_id','is_completed','progress_letter']
const matchingLessonEntry = (report, target, lessonId) => lessonId
  ? (report?.lesson_entries || []).find(entry => entry.enrollment_id === target?.id && entry.course_id === target?.courseId && entry.lesson_id === lessonId) || null
  : null
const occurrenceConfirmation = (route, target, lessonId) => JSON.stringify({
  occurrence_id: route?.id || null,
  report_id: route?.report?.id || null,
  occurrence_date: route?.occurrence_date || null,
  enrollment_id: target?.id || null,
  course_id: target?.courseId || null,
  lesson_id: lessonId || null,
  lesson_entry_id: matchingLessonEntry(route?.report, target, lessonId)?.id || null,
  report_version: route?.report?.version ?? null,
})
// The source reportId is the report identity. Rows without one are attendance
// evidence and keep only a display key.
export const historyIdentity = r => `${r.enrollment_source_id}:${r.source_id ? `report:${r.source_id}` : r.historyKey || r.evidenceKey || `attendance:${r.date || r.dateRaw || 'undated'}`}`
const compareReportIds = (a, b) => /^\d+$/.test(a) && /^\d+$/.test(b) ? a.length - b.length || (a < b ? -1 : a > b ? 1 : 0) : String(a).localeCompare(String(b))

// Class: the class page that lists the report, then the report page's lesson
// session, otherwise an exception. Same-day reports of one class map to that
// day's lessons by reportId and lesson start time.
function assignOccurrences(records, enrollmentTargets, archives, routes, options) {
  const assignments = new Map(), groups = new Map()
  for (const record of records) {
    if (record.kind !== 'report' || !record.source_id || !record.date || record.historyOnly || record.historyOccurrenceId) continue
    const target = enrollmentTargets.get(record.enrollment_source_id)
    if (!target?.id) continue
    const key = historyIdentity(record), onDate = (routes.get(target.id) || []).filter(o => o.occurrence_date === record.date)
    if (!onDate.length || onDate.some(o => o.report?.source_report_id === record.source_id)) continue
    if ((archives.get(target.id) || []).some(h => h.linked_report_id && h.source_report_id === record.source_id)) continue
    if (!record.sourceClassId) { assignments.set(key, { code: 'class', message: '無法確認此報告屬於哪個班級；請從列出此報告的班級頁同步，或手動選擇課次、僅保存歷史。' }); continue }
    const session = options.sourceClassSessions?.get(String(record.sourceClassId))
    if (!session) { assignments.set(key, { code: 'class-other', message: `此報告屬於原站其他班級（#${record.sourceClassId}）；請在該班同步，或手動選擇課次、僅保存歷史。` }); continue }
    const groupKey = `${target.id}|${record.date}|${session}`
    if (!groups.has(groupKey)) groups.set(groupKey, { target, date: record.date, session, records: new Map() })
    groups.get(groupKey).records.set(key, record)
  }
  for (const group of groups.values()) {
    const inSession = (routes.get(group.target.id) || []).filter(o => o.occurrence_date === group.date && o.class_session_id === group.session)
    if (!inSession.length) continue
    const free = inSession.filter(o => !o.report?.source_report_id).sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')) || String(a.id).localeCompare(String(b.id)))
    const reports = [...group.records].sort(([, a], [, b]) => compareReportIds(a.source_id, b.source_id))
    if (free.length === reports.length) { reports.forEach(([key], index) => assignments.set(key, { occurrence: free[index] })); continue }
    const message = free.length < inSession.length && free.length < reports.length ? '此日課次已綁定其他原站報告；請核對原站與 EduLog 課次後再同步。' : `此日有 ${reports.length} 份原站報告、${free.length} 個可用課次，數量不一致；請手動選擇課次或僅保存歷史。`
    for (const [key] of reports) assignments.set(key, { code: 'occurrence-mismatch', message })
  }
  return assignments
}

// This planner consumes permission-filtered, fully paginated server results.
// It never creates a class occurrence or infers a transfer from a class name.
export function planHistory(records, enrollmentTargets, archives, routes, options = {}) {
  const items = [], seen = new Map(), reportAdmissions = new Map(), evidenceKeys = new Map(), assignments = assignOccurrences(records, enrollmentTargets, archives, routes, options), fieldAllowed=(record,key)=>{const globalKey=key.startsWith('progress_')?'progress_letter':key;const configured=options.syncFields?.[globalKey]!==false;const reportConfigured=record.syncFieldOverrides?.[globalKey];return (reportConfigured===undefined?configured:reportConfigured)&&(globalKey!=='class_notes'||options.includeInternal||record.syncFieldOverrides?.class_notes===true)}
  const needs = (item, code, reason, details = []) => {
    item.category = 'needs'; item.reason = reason
    item.issues = details.length ? details : [{id:code,code,message:reason,target:'source'}]
  }
  for (const record of records.filter(r => r.kind === 'report')) {
    let key = historyIdentity(record)
    if (!record.source_id) { const count = (evidenceKeys.get(key) || 0) + 1; evidenceKeys.set(key, count); if (count > 1) key = `${key}#${count}` }
    const target = enrollmentTargets.get(record.enrollment_source_id)
    const fingerprint = JSON.stringify({ date: record.date, fields: record.sourceFields, data: record.data })
    if (seen.has(key)) {
      if (seen.get(key).fingerprint !== fingerprint) needs(seen.get(key),'source-conflict','同一來源身份出現不同內容，請補讀並核對。')
      continue
    }
    const item = { key, record, target, fingerprint, category: 'history', reason: '沒有唯一合法課次，先保存報名歷史。' }
    seen.set(key, item); items.push(item)
    if (record.date && (record.date < options.dateFrom || record.date > options.dateTo)) {item.category='system-excluded';item.reason='日期不在本次同步範圍內。';continue}
    if(record.sourceRowType==='other-admission'||record.sourceRowType==='previous-admission'&&!record.sourceAdmissionContextVerified){item.category='other-admission';item.reason=record.sourceRowReason||'來源列屬於其他報名，無法確認學生與課程歸屬；未納入同步。';continue}
    if(record.sourceRowType==='unfilled'){item.category='unfilled';item.reason='原站尚未填寫教學報告；保留在未填清單，來源有內容後重新讀取即可納入。';continue}
    if(record.sourceRowType==='system-excluded'){item.category='system-excluded';item.reason=record.sourceRowReason||'原站標示休假或停課，且沒有教學資料；系統已排除。';continue}
    if(!record.source_id){item.category='system-excluded';item.attendanceEvidence=true;item.reason='原站沒有報告 ID；只記為出席證據（日期、次數、班級），不匯入報告。';continue}
    const reportAdmission = reportAdmissions.get(record.source_id)
    if (reportAdmission && reportAdmission !== record.enrollment_source_id) { needs(item,'source-conflict','同一原站報告 ID 出現在不同報名，請補讀並核對。'); continue }
    reportAdmissions.set(record.source_id, record.enrollment_source_id)
    if (record.skipDecision?.status === 'review') { const reason=record.skipDecision.reason||'content_changed'; const message=reason==='expired'?'先前略過已超過 30 天，請重新確認。':reason==='context_changed'?'先前略過時的學生、報名或目標對應已改變，請重新確認。':reason==='legacy'?'舊工作中的略過沒有版本資料，請重新確認。':'來源內容與上次略過時不同，請確認是否繼續略過。'; needs(item,'previously-skipped',message,[{id:'previously-skipped',code:'previously-skipped',message,target:'skip-decision'}]); continue }
    if (record.sourceSkipped) { item.category = 'skipped'; item.reason = '已確認略過。'; continue }
    if (!target) { needs(item,'enrollment','請先確認這筆來源報名的學生與課程',[{id:'enrollment',code:'enrollment',message:'請先確認這筆來源報名的學生與課程',target:'enrollment'}]); continue }
    if (!record.date || record.sourceDateConflict) { needs(item,'date','需要您確認完整日期；矛盾日期不能直接保存',[{id:'date',code:'date',message:'需要您確認完整日期；矛盾日期不能直接保存',target:'date'}]); continue }
    if (record.sourceReadStatus === 'failed') { needs(item,'source-read','報告編輯頁尚未完整讀取，請重試或略過',[{id:'source-read',code:'source-read',message:'報告編輯頁尚未完整讀取，請重試或略過',target:'source'}]); continue }
    const previous = (target.id ? archives.get(target.id) || [] : []).filter(h => h.source_admission_id === record.enrollment_source_id)
    const canonicalKey = `report:${record.enrollment_source_id}:${record.source_id}`, legacyKeys = new Set([canonicalKey, `report:${record.source_id}`, record.historyKey].filter(Boolean))
    item.existing = previous.find(h => h.source_report_id === record.source_id) || previous.find(h => legacyKeys.has(h.source_key))
    const sourceKey = item.existing?.source_key || canonicalKey
    item.sourceKey = sourceKey
    if(item.existing&&item.existing.report_date!==record.date){needs(item,'saved-date-conflict','來源日期與已保存歷史不同；請核對原站與 EduLog，保留舊紀錄。',[{id:'saved-date-conflict',code:'date',message:'來源日期與已保存歷史不同；請核對原站與 EduLog，保留舊紀錄。',target:'date'}]);continue}
    const mapped = mappedReport(record, target.courseId, options.lessons || [])
    const targetLessonId=mapped.data.lesson_id
    for(const field of teachingFields)if(!fieldAllowed(record,field))delete mapped.data[field]
    const includedFields=teachingFields.filter(field=>fieldAllowed(record,field)&&field!=='class_notes'&&field!=='external_link'&&Object.hasOwn(mapped.data,field));if(fieldAllowed(record,'class_notes')&&options.includeInternal&&Object.hasOwn(mapped.data,'class_notes'))includedFields.push('class_notes');if(fieldAllowed(record,'external_link'))includedFields.push('external_link');item.includedFields=[...new Set(includedFields)]
    if(!item.includedFields.length){item.category='system-excluded';item.reason='本次同步未選取任何可同步欄位；來源資料保留在本機。';continue}
    const mappingNeeds=[...mapped.needs]
    if(record.sourceStudentIdentityConflict)mappingNeeds.push('此歷史報告的學生身份與來源報名不同；請先分拆或核對該筆來源資料。')
    if(record.sourceLearningStatusRaw&&!record.sourceLearningStatus)mappingNeeds.push('原站學習狀態尚未辨識；請展開來源證據確認實際選項。')
    if(record.sourceFieldConflicts?.length&&!record.sourceConflictAcknowledged)mappingNeeds.push('列表與報告編輯頁的欄位內容不同；請核對原文後再匯入。')
    if(globalThis.edulogFieldMappings.splitClassNotes(record.data?.class_notes||'').invalid)mappingNeeds.push('已保存的學習狀態標記重複或內容不符，請重新核對內部紀錄。')
    item.mappingNeeds = mappingNeeds
    if (!target.id) { needs(item,'enrollment-unconfirmed','課程與教材可先核對；確認此筆報名的學生與 EduLog 關係後，才能保存歷史報告。',[{id:'enrollment-unconfirmed',code:'enrollment',message:'課程與教材可先核對；確認此筆報名的學生與 EduLog 關係後，才能保存歷史報告。',target:'enrollment'}]); continue }
    item.data = { enrollment_id: target.id, report_date: record.date, source_origin: 'https://corp.orangeapple.co', source_admission_id: record.enrollment_source_id, source_key: sourceKey, identity_status: 'verified', source_report_id: record.source_id, external_link: `https://corp.orangeapple.co/dt_admissions/${record.enrollment_source_id}/reports/${record.source_id}/edit`,
      source_fields: (record.sourceFields || []).filter(f => (!f.internal || options.includeInternal || record.syncFieldOverrides?.class_notes===true)&&fieldAllowed(record,f.key)).filter(f => ['attendance_status','absence_reason','lesson_id','progress_start','progress_end','is_completed','class_participation','classroom_behavior','content','contact_notes','class_notes','sourceLessonLabel','progress_letter'].includes(f.key)).map(f => ({key:f.key,label:f.label || f.key,text:String(f.value ?? '')})),
      source_evidence: (record.sourceEvidence || []).slice(-50).map(e => ({source_path:e.sourcePath,table:e.table,row:e.row,captured_at:e.capturedAt})),
    }
    if(item.existing?.source_evidence?.length)item.data.source_evidence=[...item.existing.source_evidence,...item.data.source_evidence.filter(e=>!item.existing.source_evidence.some(old=>old.source_path===e.source_path&&old.table===e.table&&old.row===e.row))].slice(-50)
    for (const field of teachingFields.filter(f => f !== 'external_link' && f !== 'class_notes' && fieldAllowed(record,f))) if (mapped.data[field] !== undefined && (mapped.data[field] !== '' || ['content','contact_notes','absence_reason'].includes(field))) item.data[field] = mapped.data[field]
    if ((options.includeInternal||record.syncFieldOverrides?.class_notes===true) && fieldAllowed(record,'class_notes') && (record.sourceInternalNotes||record.sourceLearningStatus||record.sourceLearningStatusRaw)) item.data.class_notes=globalThis.edulogFieldMappings.composeClassNotes(record.sourceLearningStatus,record.sourceInternalNotes,record.sourceLearningStatusRaw&&!record.sourceLearningStatus?record.sourceLearningStatusRaw:'')
    const dateCandidates = (routes.get(target.id) || []).filter(o => o.occurrence_date === record.date)
    const linkedRoute = item.existing?.linked_report_id
      ? (routes.get(target.id) || []).find(route => route.report?.id === item.existing.linked_report_id)
      : null
    const candidates = item.existing?.linked_report_id ? (linkedRoute ? [linkedRoute] : []) : dateCandidates
    item.candidates = candidates
    const lessonId = targetLessonId
    const lesson = options.lessons?.find(entry => entry.id === lessonId)
    const currentLessonEntry = matchingLessonEntry(linkedRoute?.report, target, lessonId)
    if (lessonId) item.lessonSyncTarget = {
      enrollment_id: target.id,
      enrollment_name: target.name || '',
      course_id: target.courseId,
      lesson_id: lessonId,
      lesson_name: lesson?.title || lesson?.name || record.sourceLessonLabel || record.sourceCourseLabel || lessonId,
      entry_id: currentLessonEntry?.id || null,
      primary: currentLessonEntry?.id === linkedRoute?.report?.primary_lesson_entry_id,
    }
    item.targetConfirmationOptions = Object.fromEntries(candidates.map(route => [route.id, occurrenceConfirmation(route, target, lessonId)]))
    let chosen
    if (item.existing?.linked_report_id) {
      const changed = [...teachingFields,'source_fields'].some(f => Object.hasOwn(item.data,f) && JSON.stringify(item.data[f]) !== JSON.stringify(item.existing[f]))
      chosen=linkedRoute
      // Matching source/history alone does not prove that the bound lesson is
      // still identical. Expose its real conflicts in the normal review editor.
      const chosenLessonEntry=matchingLessonEntry(chosen?.report,target,lessonId)
      const requiresReconfirmation=Boolean(chosen&&(chosen.occurrence_date!==record.date||(lessonId&&!chosenLessonEntry)))
      const confirmedTarget=record.historyOccurrenceId===chosen?.id&&record.historyOccurrenceConfirmation===item.targetConfirmationOptions[chosen?.id]
      if(requiresReconfirmation&&!confirmedTarget){item.reconfirmationRequired=true;needs(item,'linked-target-reconfirm','原站報告仍綁定同一份 EduLog 報告，但場次日期或課次報名資料已變更；請重新確認這份報告目前對應的課次後再同步。',[{id:'linked-target-reconfirm',code:'linked-target-reconfirm',message:'原站報告仍綁定同一份 EduLog 報告，但場次日期或課次報名資料已變更；請重新確認這份報告目前對應的課次後再同步。',target:'occurrence'}]);continue}
      item.reconfirmedTarget=requiresReconfirmation
      const comparison={...(chosen?.report||{})}
      if(lessonId){for(const field of lessonProgressFields)delete comparison[field];if(chosenLessonEntry)Object.assign(comparison,{lesson_id:chosenLessonEntry.lesson_id,is_completed:chosenLessonEntry.is_completed,progress_letter:chosenLessonEntry.progress_letter})}
      const sameLesson=chosen?.can_write&&(!requiresReconfirmation||confirmedTarget)&&item.existing.enrollment_id===target.id&&teachingFields.filter(field=>field!=='external_link'&&Object.hasOwn(item.data,field)).every(field=>JSON.stringify(item.data[field])===JSON.stringify(comparison[field]))
      if (!changed&&sameLesson&&!mappingNeeds.length) { item.category='linked'; item.reason='Already saved and linked; no duplicate will be created.'; continue }
      if(!chosen){needs(item,'linked-report-unavailable','The linked EduLog report could not be read. Recheck this enrollment before syncing.',[{id:'linked-report-unavailable',code:'report-read',message:'The linked EduLog report could not be read. Recheck this enrollment before syncing.',target:'report'}]);continue}
      item.boundExisting=true
    } else if (record.historyOccurrenceId) chosen = candidates.find(o => o.id === record.historyOccurrenceId)
    else {
      chosen = candidates.find(o => o.report?.source_report_id === record.source_id)
      const assigned = chosen || record.historyOnly ? null : assignments.get(item.key)
      if (assigned?.code) { needs(item,assigned.code,assigned.message,[{id:assigned.code,code:assigned.code,message:assigned.message,target:assigned.code==='occurrence-mismatch'?'occurrence':'class'}]); continue }
      if (assigned?.occurrence) chosen = assigned.occurrence
    }
    if(chosen?.ambiguous_report){needs(item,'ambiguous-report-target','此課次包含多份可能的報告；請先在 EduLog 核對報告目標，避免同步到錯誤紀錄。',[{id:'ambiguous-report-target',code:'ambiguous-report-target',message:'此課次包含多份可能的報告；請先在 EduLog 核對報告目標，避免同步到錯誤紀錄。',target:'occurrence'}]);continue}
    if(lessonId){const syncEntry=matchingLessonEntry(chosen?.report,target,lessonId),lessonName=lesson?.title||lesson?.name||record.sourceLessonLabel||record.sourceCourseLabel||lessonId;item.lessonSyncTarget={enrollment_id:target.id,enrollment_name:target.name||'',course_id:target.courseId,lesson_id:lessonId,lesson_name:lessonName,entry_id:syncEntry?.id||null,primary:syncEntry?.id===chosen?.report?.primary_lesson_entry_id};const primaryEntry=chosen?.report?.lesson_entries?.find(entry=>entry.id===chosen.report.primary_lesson_entry_id);if(primaryEntry){const labels=chosen.report.lesson_entry_labels?.find(entry=>entry.id===primaryEntry.id);item.primaryLessonEntry={...primaryEntry,lesson_name:labels?.lesson_name||(primaryEntry.lesson_id===lessonId?lessonName:primaryEntry.lesson_id),enrollment_name:labels?.enrollment_name||(primaryEntry.enrollment_id===target.id?target.name||'':'報名 '+primaryEntry.enrollment_id)}}else item.primaryLessonEntry=item.lessonSyncTarget}
    if (mappingNeeds.length) { const issues=mappingNeeds.map((message,index)=>{const field=record.sourceFields?.find(f=>message.includes(f.label));const target=field?.key?`field:${field.key}`:message.includes('學生身份')?'enrollment':message.includes('列表與報告')?'source-conflict':message.includes('學習狀態標記')?'internal':'source';return{id:`mapping:${field?.key||index}`,code:'mapping',message,target,fieldKey:field?.key}});needs(item,'mapping',`${mappingNeeds.join('；')}。選擇確認、重讀或略過後再同步。`,issues);continue }
    item.sourceData={...item.data}
    item.comparisonReport=item.boundExisting?chosen?.report:(record.historyOnly?item.existing:(chosen?.report||item.existing))
    if(lessonId&&chosen?.report){item.comparisonReport={...chosen.report};for(const field of lessonProgressFields)delete item.comparisonReport[field];const entry=matchingLessonEntry(chosen.report,target,lessonId);if(entry)Object.assign(item.comparisonReport,{lesson_id:entry.lesson_id,is_completed:entry.is_completed,progress_letter:entry.progress_letter})}
    if(item.comparisonReport)for(const field of ['content','contact_notes','class_notes']){const merge=record.historyMerge?.[field];if(merge?.signature===mergeSignature(item.sourceData?.[field],item.comparisonReport?.[field])&&typeof merge.text==='string')item.data[field]=merge.text}
    item.conflicts = teachingFields.filter(f => Object.hasOwn(item.sourceData,f) && item.comparisonReport?.[f] != null && (item.boundExisting || item.comparisonReport[f] !== '') && JSON.stringify(item.sourceData[f]) !== JSON.stringify(item.comparisonReport[f]))
    item.mergeClearNeeds=[]
    for(const field of ['content','contact_notes','class_notes']){const merge=record.historyMerge?.[field],expected=mergeSignature(item.sourceData?.[field],item.comparisonReport?.[field]);if(merge?.signature===expected&&merge.text===''&&record.historyMergeClearConfirmed?.[field]!==mergeClearToken(merge)){item.mergeClearNeeds.push(field);if(!item.conflicts.includes(field))item.conflicts.push(field)}}
    item.conflictSignature = JSON.stringify({item:key,occurrence:record.historyOnly&&!item.boundExisting?null:(chosen?.id||null),reportVersion:item.comparisonReport?.version??null,historyVersion:item.existing?.version??null,fields:item.conflicts.map(field=>[field,item.sourceData?.[field]??item.data?.[field],item.data?.[field],item.comparisonReport?.[field],record.historyFieldDecisions?.[field],record.syncFieldOverrides?.[field]])})
    item.staleReviewFields=(record.staleReviewFields||[]).filter(field=>teachingFields.includes(field))
    for(const field of item.staleReviewFields)if(!item.conflicts.includes(field))item.conflicts.push(field)
    // Re-sync: an untouched EduLog report takes the source; EduLog edits with an
    // unchanged source are kept; only edits on both sides need a decision.
    const synced = item.comparisonReport?.source_report_id === record.source_id ? item.comparisonReport : null
    if (synced) {
      const untouched = synced.source_synced_version != null && synced.version === synced.source_synced_version
      // Fields without a sync baseline compare with the current EduLog value.
      const baseline = synced.source_synced_fields || {}, differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b)
      const sourceChanged = item.includedFields.some(field => Object.hasOwn(item.sourceData, field) && (Object.hasOwn(baseline, field) ? differs(item.sourceData[field], baseline[field]) : synced[field] != null && differs(item.sourceData[field], synced[field])))
      item.syncState = untouched ? 'untouched' : sourceChanged ? 'both-changed' : 'edulog-changed'
      if (untouched) { item.autoOverwrite = item.includedFields.filter(field => Object.hasOwn(item.data, field)); item.conflicts = item.conflicts.filter(field => item.staleReviewFields.includes(field)); item.mergeClearNeeds = [] }
      else if (!sourceChanged && !item.staleReviewFields.length && !record.historyOnly) { item.category = 'linked'; item.reason = 'EduLog 已修改，原站自上次同步後沒有變更；保留 EduLog 內容。'; continue }
    }
    if(item.staleReviewFields.length){item.conflictSignature=JSON.stringify({item:key,occurrence:record.historyOnly&&!item.boundExisting?null:(chosen?.id||null),reportVersion:item.comparisonReport?.version??null,historyVersion:item.existing?.version??null,fields:item.conflicts.map(field=>[field,item.sourceData?.[field]??item.data?.[field],item.data?.[field],item.comparisonReport?.[field],record.historyFieldDecisions?.[field],record.syncFieldOverrides?.[field]])})}
    if(record.historyOnly&&item.boundExisting){needs(item,'bound-history-reconcile','此歷史已綁定原課次；需核對並同步相同整理結果，不能只更新歷史。',[{id:'bound-history-reconcile',code:'linked-report',message:'此歷史已綁定原課次；需核對並同步相同整理結果，不能只更新歷史。',target:'history-only'}]);continue}
    if(item.mergeClearNeeds.length){needs(item,'merge-clear','混合結果會清空欄位，請明確確認後再保存。',item.mergeClearNeeds.map(field=>({id:'merge-clear:'+field,code:'merge-clear',message:field+' 的混合結果為空白；請確認是否清空。',target:'conflict:'+field,fieldKey:field})));continue}
    if (item.conflicts.length && !(record.historyConflictConfirmed&&record.historyConflictSignature===item.conflictSignature)) { if(item.syncState==='both-changed'){const issues=item.conflicts.map(field=>({id:'conflict:'+field,code:'both-changed',message:field+' 在原站與 EduLog 自上次同步後都有修改；請選擇保留 EduLog、採用原站或混合。',target:'conflict:'+field,fieldKey:field}));needs(item,'both-changed','原站與 EduLog 自上次同步後都有修改；請逐欄選擇。',issues);continue} const issues=item.conflicts.map(field=>({id:'conflict:'+field,code:'conflict',message:(item.staleReviewFields?.includes(field)?'預覽失效後此欄位需要重新確認：':'')+field+' 有不同內容；可保留 EduLog 或明確選擇整理結果。',target:'conflict:'+field,fieldKey:field}));needs(item,'report-conflict','既有報告有不同內容或預覽失效後需要重新確認；請逐欄核對後再保存。',issues); continue }
    if (record.historyOnly) { item.reason = 'History only is selected; the lesson report will not change.'; continue }
    if (candidates.length > 1 && !chosen) { needs(item,'occurrence','There are multiple valid lesson occurrences on this date. Choose one or save history only.',[{id:'occurrence',code:'occurrence',message:'There are multiple valid lesson occurrences on this date. Choose one or save history only.',target:'occurrence'}]); continue }
    if (!chosen || !chosen.can_write) { if(item.boundExisting){needs(item,'linked-report-unavailable','已綁定的課次報告目前無法更新；已保留來源，請重新核對原課次與權限。',[{id:'linked-report-unavailable',code:'report-write',message:'已綁定的課次報告目前無法更新；已保留來源，請重新核對原課次與權限。',target:'report'}]);continue}if (chosen) item.reason = '無目標課次報告寫入權限，先保存歷史。'; continue }
    if (!teachingFields.some(f => !['external_link','class_notes'].includes(f) && Object.hasOwn(item.data,f))) { item.reason = '尚無已確認的教學欄位，保留來源證據。'; continue }
    item.occurrence = chosen
    item.category = 'bind'; item.reason = `${chosen.class_name} · ${chosen.occurrence_date} · 有效名單已核對，報名關係不變。`
  }
  for(const item of items) {
    const sameDay=items.filter(i=>i!==item&&i.target?.id===item.target?.id&&i.record.date===item.record.date&&i.data&&i.category!=='skipped')
    if(item.category==='bind'&&sameDay.some(i=>i.occurrence?.id===item.occurrence.id&&!i.record.historyOnly)){needs(item,'same-occurrence','同日多份來源報告可能綁到同一課次；請選一份綁定，其餘先存歷史。',[{id:'same-occurrence',code:'occurrence',message:'同日多份來源報告可能綁到同一課次；請選一份綁定，其餘先存歷史。',target:'occurrence'}])}
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
