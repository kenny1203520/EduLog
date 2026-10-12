import { teachingFields } from './history-sync.js'

const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right)
function unchangedLinkedOccurrence(item,row,routes){
  const history=item.existing
  if(!history?.id||row.target_id!==history.id||!history.linked_report_id||history.enrollment_id!==item.target?.id||history.report_date!==item.record.date||history.source_key!==item.sourceKey)return null
  const occurrence=(routes.get(item.target.id)||[]).find(candidate=>candidate.report?.id===history.linked_report_id)
  if(!occurrence?.can_write||occurrence.occurrence_date!==history.report_date)return null
  const fields=teachingFields.filter(field=>Object.hasOwn(item.data,field))
  if(fields.some(field=>!same(item.data[field],history[field])))return null
  if(!same(item.data.source_fields,history.source_fields))return null
  if(fields.filter(field=>field!=='external_link').some(field=>!same(item.data[field],occurrence.report[field])))return null
  return occurrence
}

/** Build every patch before touching a live row. Failed validation is atomic. */
export function prepareStaleReviewBatchRefresh(work,items,routes=new Map()){
  const updates=[],issues=[],bindings=[...(work.historyBindings||[])],seen=new Set()
  for(const stale of work.staleReviewRows||[]){
    const identity=JSON.stringify([stale.batchKey,stale.source_id]);if(seen.has(identity))continue;seen.add(identity)
    if((work.staleReviewPending||[]).some(pending=>pending.kind==='history_report'&&pending.source_id===stale.source_id))continue
    const batch=work.batches?.find(candidate=>candidate.key===stale.batchKey)
    if(batch&&(work.batches.indexOf(batch)<(work.done||0)||(work.appliedBatchKeys||[]).includes(batch.key)))throw Object.assign(new Error(globalThis.edulogUi?.t('work.reviewSubmittedImmutable')||'此批次已有提交檢查點，不能修改原內容；請先查看已保存結果。'),{code:'STALE_SUBMITTED_BATCH_IMMUTABLE'})
    if(work.status==='outcome_unknown'||(work.unknownBatchKey&&work.unknownBatchKey===batch?.key))throw Object.assign(new Error(globalThis.edulogUi?.t('work.reviewUnknownCheckpoint')||'此批次結果尚未確認；請先核對原工作檢查點。'),{code:'IMPORT_STATUS_UNKNOWN'})
    const row=batch?.rows?.find(candidate=>candidate.record?.kind==='history_report'&&candidate.source_id===stale.source_id),item=items.find(candidate=>candidate.key===stale.source_id)
    const linked=item?.category==='linked'&&item.data?unchangedLinkedOccurrence(item,row||{},routes):null
    if(!row||!item||!item.data||(!['history','bind'].includes(item.category)&&!linked)){
      issues.push({source_id:stale.source_id,batchKey:stale.batchKey,reason:!row?'batch-missing':!item?'report-missing':item.category==='linked'?'linked-unverified':item.issueCode||item.category,targets:item?.issues?.map(issue=>({target:issue.target,field:issue.fieldKey}))||[]})
      continue
    }
    const next=structuredClone(row),index=bindings.findIndex(binding=>binding.itemKey===item.key),binding=index<0?null:bindings[index]
    next.record.data=structuredClone(item.data);next.overwrite=[...(item.record.historyOverwrite||[])]
    const occurrence=linked||item.occurrence
    if((item.category==='bind'||linked)&&occurrence){
      const body={key:binding?.body?.key||row.history_reconciliation?.key||crypto.randomUUID(),class_occurrence_id:occurrence.id,overwrite:[...next.overwrite],include_internal:work.includeInternalNotes,include_fields:[...(item.includedFields||[])]}
      next.history_reconciliation={...body}
      const value={...(binding||{}),historyId:row.target_id,itemKey:item.key,expectedFields:Object.fromEntries(teachingFields.filter(field=>Object.hasOwn(item.data,field)).map(field=>[field,item.data[field]])),occurrence,body,status:'pending',atomic:true}
      if(index<0)bindings.push(value);else bindings[index]=value
    }else{delete next.history_reconciliation;if(index>=0)bindings.splice(index,1)}
    updates.push({row,next})
  }
  if(issues.length)throw Object.assign(new Error('Reports still need review'),{code:'STALE_REPORT_REVIEW_REQUIRED',reviewIssues:issues,fields:Object.fromEntries(issues.map(issue=>[`reports.${issue.source_id}`,['REVIEW_REQUIRED']]))})
  return ()=>{for(const {row,next} of updates){delete row.history_reconciliation;Object.assign(row,next)}work.historyBindings=bindings;work.staleReviewIssues=[]}
}
