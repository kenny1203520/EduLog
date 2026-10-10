import { mappedReport } from './import-field-mappings.js'
import { mergeClearToken, mergeSignature } from './history-merge.js'
import './field-mappings.js'

export const teachingFields = ['lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link']
export const historyIdentity = r => `${r.enrollment_source_id}:${r.historyKey || (r.source_id ? `report:${r.source_id}` : r.evidenceKey || '')}`

// This planner consumes permission-filtered, fully paginated server results.
// It never creates a class occurrence or infers a transfer from a class name.
export function planHistory(records, enrollmentTargets, archives, routes, options = {}) {
  const items = [], seen = new Map(), fieldAllowed=(record,key)=>{const globalKey=key.startsWith('progress_')?'progress_letter':key;const configured=options.syncFields?.[globalKey]!==false;const reportConfigured=record.syncFieldOverrides?.[globalKey];return (reportConfigured===undefined?configured:reportConfigured)&&(globalKey!=='class_notes'||options.includeInternal||record.syncFieldOverrides?.class_notes===true)}
  const needs = (item, code, reason, details = []) => {
    item.category = 'needs'; item.reason = reason
    item.issues = details.length ? details : [{id:code,code,message:reason,target:'source'}]
  }
  for (const record of records.filter(r => r.kind === 'report')) {
    const key = historyIdentity(record), target = enrollmentTargets.get(record.enrollment_source_id)
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
    if (record.skipDecision?.status === 'review') { const reason=record.skipDecision.reason||'content_changed'; const message=reason==='expired'?'先前略過已超過 30 天，請重新確認。':reason==='context_changed'?'先前略過時的學生、報名或目標對應已改變，請重新確認。':reason==='legacy'?'舊工作中的略過沒有版本資料，請重新確認。':'來源內容與上次略過時不同，請確認是否繼續略過。'; needs(item,'previously-skipped',message,[{id:'previously-skipped',code:'previously-skipped',message,target:'skip-decision'}]); continue }
    if (record.sourceSkipped) { item.category = 'skipped'; item.reason = '已確認略過。'; continue }
    if (!target) { needs(item,'enrollment','請先確認這筆來源報名的學生與課程',[{id:'enrollment',code:'enrollment',message:'請先確認這筆來源報名的學生與課程',target:'enrollment'}]); continue }
    if (!record.date || record.sourceDateConflict) { needs(item,'date','需要您確認完整日期；矛盾日期不能直接保存',[{id:'date',code:'date',message:'需要您確認完整日期；矛盾日期不能直接保存',target:'date'}]); continue }
    if (record.sourceReadStatus === 'failed') { needs(item,'source-read','報告編輯頁尚未完整讀取，請重試或略過',[{id:'source-read',code:'source-read',message:'報告編輯頁尚未完整讀取，請重試或略過',target:'source'}]); continue }
    if (!record.historyKey && !record.source_id && !record.evidenceKey) { needs(item,'evidence','來源證據不足，請補讀紀錄',[{id:'evidence',code:'evidence',message:'來源證據不足，請補讀紀錄',target:'source'}]); continue }
    const previous = (target.id ? archives.get(target.id) || [] : []).filter(h => h.source_admission_id === record.enrollment_source_id)
    const sourceKey = record.historyKey || (record.source_id ? `report:${record.source_id}` : `evidence:${record.evidenceKey}`)
    item.sourceKey = sourceKey; item.existing = previous.find(h => h.source_key === sourceKey)
    if(item.existing&&item.existing.report_date!==record.date){needs(item,'saved-date-conflict','來源日期與已保存歷史不同；請核對原站與 EduLog，保留舊紀錄。',[{id:'saved-date-conflict',code:'date',message:'來源日期與已保存歷史不同；請核對原站與 EduLog，保留舊紀錄。',target:'date'}]);continue}
    const mapped = mappedReport(record, target.courseId, options.lessons || [])
    for(const field of teachingFields)if(!fieldAllowed(record,field))delete mapped.data[field]
    const includedFields=teachingFields.filter(field=>fieldAllowed(record,field)&&field!=='class_notes'&&field!=='external_link'&&Object.hasOwn(mapped.data,field));if(fieldAllowed(record,'class_notes')&&options.includeInternal&&Object.hasOwn(mapped.data,'class_notes'))includedFields.push('class_notes');if(record.source_id&&!record.identityUnverified&&fieldAllowed(record,'external_link'))includedFields.push('external_link');item.includedFields=[...new Set(includedFields)]
    if(!item.includedFields.length){item.category='system-excluded';item.reason='本次同步未選取任何可同步欄位；來源資料保留在本機。';continue}
    const mappingNeeds=[...mapped.needs]
    if(record.sourceStudentIdentityConflict)mappingNeeds.push('此歷史報告的學生身份與來源報名不同；請先分拆或核對該筆來源資料。')
    if(record.sourceLearningStatusRaw&&!record.sourceLearningStatus)mappingNeeds.push('原站學習狀態尚未辨識；請展開來源證據確認實際選項。')
    if(record.sourceFieldConflicts?.length&&!record.sourceConflictAcknowledged)mappingNeeds.push('列表與報告編輯頁的欄位內容不同；請核對原文後再匯入。')
    if(globalThis.edulogFieldMappings.splitClassNotes(record.data?.class_notes||'').invalid)mappingNeeds.push('已保存的學習狀態標記重複或內容不符，請重新核對內部紀錄。')
    item.mappingNeeds = mappingNeeds
    if (!target.id) { needs(item,'enrollment-unconfirmed','課程與教材可先核對；確認此筆報名的學生與 EduLog 關係後，才能保存歷史報告。',[{id:'enrollment-unconfirmed',code:'enrollment',message:'課程與教材可先核對；確認此筆報名的學生與 EduLog 關係後，才能保存歷史報告。',target:'enrollment'}]); continue }
    item.data = { enrollment_id: target.id, report_date: record.date, source_origin: 'https://corp.orangeapple.co', source_admission_id: record.enrollment_source_id, source_key: sourceKey, identity_status: record.source_id && !record.identityUnverified ? 'verified' : 'evidence_only',
      source_fields: (record.sourceFields || []).filter(f => (!f.internal || options.includeInternal || record.syncFieldOverrides?.class_notes===true)&&fieldAllowed(record,f.key)).filter(f => ['attendance_status','absence_reason','lesson_id','progress_start','progress_end','is_completed','class_participation','classroom_behavior','content','contact_notes','class_notes','sourceLessonLabel','progress_letter'].includes(f.key)).map(f => ({key:f.key,label:f.label || f.key,text:String(f.value ?? '')})),
      source_evidence: (record.sourceEvidence || []).slice(-50).map(e => ({source_path:e.sourcePath,table:e.table,row:e.row,captured_at:e.capturedAt})),
    }
    if (item.data.identity_status === 'verified' && fieldAllowed(record,'external_link')) { item.data.source_report_id = record.source_id; item.data.external_link = `https://corp.orangeapple.co/dt_admissions/${record.enrollment_source_id}/reports/${record.source_id}/edit` }
    if(item.existing?.source_evidence?.length)item.data.source_evidence=[...item.existing.source_evidence,...item.data.source_evidence.filter(e=>!item.existing.source_evidence.some(old=>old.source_path===e.source_path&&old.table===e.table&&old.row===e.row))].slice(-50)
    for (const field of teachingFields.filter(f => f !== 'external_link' && f !== 'class_notes' && fieldAllowed(record,f))) if (mapped.data[field] !== undefined && (mapped.data[field] !== '' || ['content','contact_notes','absence_reason'].includes(field))) item.data[field] = mapped.data[field]
    if ((options.includeInternal||record.syncFieldOverrides?.class_notes===true) && fieldAllowed(record,'class_notes') && (record.sourceInternalNotes||record.sourceLearningStatus||record.sourceLearningStatusRaw)) item.data.class_notes=globalThis.edulogFieldMappings.composeClassNotes(record.sourceLearningStatus,record.sourceInternalNotes,record.sourceLearningStatusRaw&&!record.sourceLearningStatus?record.sourceLearningStatusRaw:'')
    if (!item.existing && previous.some(h => h.report_date === record.date && (item.data.identity_status === 'evidence_only' || h.identity_status === 'evidence_only')) && !record.historyDuplicateConfirmed) { item.identityAmbiguous=true; needs(item,'duplicate-history','同日已有身份不足的歷史；請核對內容改變或同日另一筆，不自動產生第二份。',[{id:'duplicate-history',code:'identity',message:'同日已有身份不足的歷史；請核對內容改變或同日另一筆，不自動產生第二份。',target:'identity'}]); continue }
    const candidates = (routes.get(target.id) || []).filter(o => o.occurrence_date === record.date)
    item.candidates = candidates
    let chosen
    if (item.existing?.linked_report_id) {
      const changed = [...teachingFields,'source_fields'].some(f => Object.hasOwn(item.data,f) && JSON.stringify(item.data[f]) !== JSON.stringify(item.existing[f]))
      if (!changed) { item.category='linked'; item.reason='Already saved and linked; no duplicate will be created.'; continue }
      chosen=(routes.get(target.id)||[]).find(route=>route.report?.id===item.existing.linked_report_id)
      if(!chosen){needs(item,'linked-report-unavailable','The linked EduLog report could not be read. Recheck this enrollment before syncing.',[{id:'linked-report-unavailable',code:'report-read',message:'The linked EduLog report could not be read. Recheck this enrollment before syncing.',target:'report'}]);continue}
      item.boundExisting=true
    } else chosen = record.historyOccurrenceId ? candidates.find(o => o.id === record.historyOccurrenceId) : candidates.length === 1 ? candidates[0] : undefined
    if (mappingNeeds.length) { const issues=mappingNeeds.map((message,index)=>{const field=record.sourceFields?.find(f=>message.includes(f.label));const target=field?.key?`field:${field.key}`:message.includes('學生身份')?'enrollment':message.includes('列表與報告')?'source-conflict':message.includes('學習狀態標記')?'internal':'source';return{id:`mapping:${field?.key||index}`,code:'mapping',message,target,fieldKey:field?.key}});needs(item,'mapping',`${mappingNeeds.join('；')}。選擇確認、重讀或略過後再同步。`,issues);continue }
    item.sourceData={...item.data}
    item.comparisonReport=item.boundExisting?chosen?.report:(record.historyOnly?item.existing:(chosen?.report||item.existing))
    if(item.comparisonReport)for(const field of ['content','contact_notes','class_notes']){const merge=record.historyMerge?.[field];if(merge?.signature===mergeSignature(item.sourceData?.[field],item.comparisonReport?.[field])&&typeof merge.text==='string')item.data[field]=merge.text}
    item.conflicts = teachingFields.filter(f => Object.hasOwn(item.sourceData,f) && item.comparisonReport?.[f] != null && (item.boundExisting || item.comparisonReport[f] !== '') && JSON.stringify(item.sourceData[f]) !== JSON.stringify(item.comparisonReport[f]))
    item.mergeClearNeeds=[]
    for(const field of ['content','contact_notes','class_notes']){const merge=record.historyMerge?.[field],expected=mergeSignature(item.sourceData?.[field],item.comparisonReport?.[field]);if(merge?.signature===expected&&merge.text===''&&record.historyMergeClearConfirmed?.[field]!==mergeClearToken(merge)){item.mergeClearNeeds.push(field);if(!item.conflicts.includes(field))item.conflicts.push(field)}}
    item.conflictSignature = JSON.stringify({item:key,occurrence:record.historyOnly&&!item.boundExisting?null:(chosen?.id||null),reportVersion:item.comparisonReport?.version??null,historyVersion:item.existing?.version??null,fields:item.conflicts.map(field=>[field,item.sourceData?.[field]??item.data?.[field],item.data?.[field],item.comparisonReport?.[field],record.historyFieldDecisions?.[field],record.syncFieldOverrides?.[field]])})
    if(record.historyOnly&&item.boundExisting){needs(item,'bound-history-reconcile','此歷史已綁定原課次；需核對並同步相同整理結果，不能只更新歷史。',[{id:'bound-history-reconcile',code:'linked-report',message:'此歷史已綁定原課次；需核對並同步相同整理結果，不能只更新歷史。',target:'history-only'}]);continue}
    if(item.mergeClearNeeds.length){needs(item,'merge-clear','混合結果會清空欄位，請明確確認後再保存。',item.mergeClearNeeds.map(field=>({id:'merge-clear:'+field,code:'merge-clear',message:field+' 的混合結果為空白；請確認是否清空。',target:'conflict:'+field,fieldKey:field})));continue}
    if (item.conflicts.length && !(record.historyConflictConfirmed&&record.historyConflictSignature===item.conflictSignature)) { needs(item,'report-conflict','既有歷史或課次報告有不同內容，請逐欄核對後再保存。',item.conflicts.map(field=>({id:'conflict:'+field,code:'conflict',message:field+' 有不同內容；可保留 EduLog 或明確選擇整理結果。',target:'conflict:'+field,fieldKey:field}))); continue }
    if (record.historyOnly) { item.reason = 'History only is selected; the lesson report will not change.'; continue }
    if (candidates.length > 1 && !chosen) { needs(item,'occurrence','There are multiple valid lesson occurrences on this date. Choose one or save history only.',[{id:'occurrence',code:'occurrence',message:'There are multiple valid lesson occurrences on this date. Choose one or save history only.',target:'occurrence'}]); continue }
    if (!chosen || !chosen.can_write) { if(item.boundExisting){needs(item,'linked-report-unavailable','已綁定的課次報告目前無法更新；已保留來源，請重新核對原課次與權限。',[{id:'linked-report-unavailable',code:'report-write',message:'已綁定的課次報告目前無法更新；已保留來源，請重新核對原課次與權限。',target:'report'}]);continue}if (chosen) item.reason = '無目標課次報告寫入權限，先保存歷史。'; continue }
    if (!teachingFields.some(f => !['external_link','class_notes'].includes(f) && Object.hasOwn(item.data,f))) { item.reason = '尚無已確認的教學欄位，保留來源證據。'; continue }
    item.occurrence = chosen
    item.category = 'bind'; item.reason = `${chosen.class_name} · ${chosen.occurrence_date} · 有效名單已核對，報名關係不變。`
  }
  for(const item of items) {
    const sameDay=items.filter(i=>i!==item&&i.target?.id===item.target?.id&&i.record.date===item.record.date&&i.data&&i.category!=='skipped')
    if(item.data?.identity_status==='evidence_only'&&sameDay.length&&!item.record.historyDuplicateConfirmed){item.identityAmbiguous=true;needs(item,'duplicate-same-day','同日有多筆且無可靠報告 ID；請確認是不同紀錄，或略過重複項目。',[{id:'duplicate-same-day',code:'identity',message:'同日有多筆且無可靠報告 ID；請確認是不同紀錄，或略過重複項目。',target:'identity'}])}
    else if(item.category==='bind'&&sameDay.some(i=>i.occurrence?.id===item.occurrence.id&&!i.record.historyOnly)){needs(item,'same-occurrence','同日多份來源報告可能綁到同一課次；請選一份綁定，其餘先存歷史。',[{id:'same-occurrence',code:'occurrence',message:'同日多份來源報告可能綁到同一課次；請選一份綁定，其餘先存歷史。',target:'occurrence'}])}
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
