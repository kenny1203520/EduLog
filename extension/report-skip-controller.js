import { fingerprintReport, skipReviewReason } from './report-skip-decisions.js'

export function createReportSkipController(hooks) {
  const recordsFor = owner => owner.snapshot.records.filter(r=>r.kind==='report')
  const targetContext = record => {
    const target=hooks.targets().get(record.enrollment_source_id)||null
    if(!target)return null
    const routes=hooks.routes?.().get(target.id)||[]
    const classSessionId=routes.filter(row=>row.occurrence_date===record.date).map(row=>({id:row.id||null,class_session_id:row.class_session_id||null})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))
    return {...target,classSessionId}
  }
  const fingerprint = record => fingerprintReport(record,{includeInternal:hooks.getWork()?.includeInternalNotes===true,instance:hooks.instance(),target:targetContext(record)})
  async function resolve(owner=hooks.getWork()) {
    if(!owner||owner!==hooks.getWork()||!owner.history?.lastSourceReadAt)return 0
    const records=recordsFor(owner).filter(r=>r.sourceReadStatus!=='failed'&&(r.skipDecisionResolvedAt||0)<owner.history.lastSourceReadAt&&(r.source_id&&!r.identityUnverified&&hooks.capable()||r.sourceSkipped||r.skipDecision?.status==='local-skip'||r.skipDecision?.status==='review'))
    let count=0
    const identified=records.filter(r=>r.source_id&&!r.identityUnverified&&hooks.capable()),payloadByRecord=new Map()
    for(const record of records){const fp=await fingerprint(record);if(owner!==hooks.getWork())return count;payloadByRecord.set(record,fp)}
    const decisions=new Map()
    for(let offset=0;offset<identified.length;offset+=50){if(owner!==hooks.getWork())return count
      const batch=identified.slice(offset,offset+50),items=batch.map(record=>({source_admission_id:String(record.enrollment_source_id),source_report_id:String(record.source_id),...payloadByRecord.get(record)}))
      const result=await hooks.api('report-decisions-resolve',{target_instance:hooks.instance(),source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',items})
      if(owner!==hooks.getWork())return count
      for(const row of result.items||[])decisions.set(`${row.source_admission_id}:${row.source_report_id}`,row)
    }
    for(const record of records){const fp=payloadByRecord.get(record),decision=decisions.get(`${record.enrollment_source_id}:${record.source_id}`),prior=record.skipDecision;record.skipDecisionResolvedAt=owner.history.lastSourceReadAt;count++
      if(decision?.status==='skipped'){record.sourceSkipped=true;record.skipDecision={status:'skip',revision:decision.revision,confirmedAt:decision.confirmed_at,expiresAt:decision.expires_at,fingerprint:fp.content_fingerprint,contextFingerprint:fp.context_fingerprint,fieldFingerprints:fp.field_fingerprints}}
      else if(decision?.status==='review'){record.sourceSkipped=false;record.skipDecision={status:'review',reason:skipReviewReason(decision),changedFields:decision.changed_fields||[],expired:decision.expired===true,confirmedAt:decision.confirmed_at,revision:decision.revision,fingerprint:fp.content_fingerprint,contextFingerprint:fp.context_fingerprint,fieldFingerprints:fp.field_fingerprints}}
      else if(record.sourceSkipped||prior?.status==='local-skip'||prior?.status==='review'&&prior.reason==='legacy'){
        const expired=prior?.expiresAt&&new Date(prior.expiresAt).getTime()<=Date.now(),contextChanged=prior?.contextFingerprint&&prior.contextFingerprint!==fp.context_fingerprint,contentChanged=prior?.fingerprint&&prior.fingerprint!==fp.content_fingerprint
        if(prior?.status==='local-skip'&&!expired&&!contextChanged&&!contentChanged){record.sourceSkipped=true;record.skipDecision={...prior,fieldFingerprints:fp.field_fingerprints}}
        else{record.sourceSkipped=false;const old=prior?.fieldFingerprints||{};record.skipDecision={status:'review',reason:contextChanged?'context_changed':contentChanged?'content_changed':expired?'expired':'legacy',changedFields:Object.keys(fp.field_fingerprints).filter(key=>old[key]&&old[key]!==fp.field_fingerprints[key]),expired:Boolean(expired),confirmedAt:prior?.confirmedAt,fingerprint:fp.content_fingerprint,contextFingerprint:fp.context_fingerprint,fieldFingerprints:fp.field_fingerprints}}
      }else if(decision?.status==='none'&&prior?.status==='review'&&prior.reason!=='legacy')record.skipDecision=undefined
    }
    if(count&&owner===hooks.getWork()){hooks.recompute();await hooks.save()}
    return count
  }
  async function setSkip(item,active) {
    const owner=hooks.getWork(),record=owner?.snapshot.records.find(r=>r.kind==='report'&&hooks.identity(r)===item.key)||item.record
    if(!owner||!record)return false
    const fp=await fingerprint(record),identified=Boolean(record.source_id&&!record.identityUnverified),prior=record.skipDecision
    if(identified&&hooks.capable()){
      const response=await hooks.api('report-decisions-confirm',{target_instance:hooks.instance(),source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',items:[{source_admission_id:String(record.enrollment_source_id),source_report_id:String(record.source_id),...fp,action:active?'skip':'clear',expected_revision:prior?.revision||null}]})
      if(owner!==hooks.getWork())return false
      const decision=response.items?.[0]
      record.skipDecision=active?{status:'skip',revision:decision?.revision,confirmedAt:decision?.confirmed_at,expiresAt:decision?.expires_at,fingerprint:fp.content_fingerprint,contextFingerprint:fp.context_fingerprint,fieldFingerprints:fp.field_fingerprints}:undefined
    } else record.skipDecision=active?{status:'local-skip',confirmedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*86400000).toISOString(),fingerprint:fp.content_fingerprint,contextFingerprint:fp.context_fingerprint,fieldFingerprints:fp.field_fingerprints}:undefined
    record.sourceSkipped=active
    return hooks.changed()
  }
  async function refreshContext(owner=hooks.getWork()) {
    if(!owner||owner!==hooks.getWork())return 0
    let changed=0
    for(const record of recordsFor(owner).filter(r=>r.skipDecision?.status==='skip')){
      const fp=await fingerprint(record);if(owner!==hooks.getWork())return changed
      if(record.skipDecision.contextFingerprint&&record.skipDecision.contextFingerprint!==fp.context_fingerprint){record.sourceSkipped=false;record.skipDecision={...record.skipDecision,status:'review',reason:'context_changed',fingerprint:fp.content_fingerprint,contextFingerprint:fp.context_fingerprint,fieldFingerprints:fp.field_fingerprints};changed++}
    }
    return changed
  }
  async function continueSkipping(items) {
    const owner=hooks.getWork();if(!owner||!Array.isArray(items)||!items.length)return false
    const selected=items.map(item=>({item,record:owner.snapshot.records.find(r=>r.kind==='report'&&hooks.identity(r)===item.key)})).filter(entry=>entry.record)
    const identified=selected.filter(({record})=>record.source_id&&!record.identityUnverified&&hooks.capable())
    try {
      for(let offset=0;offset<identified.length;offset+=50){
        if(owner!==hooks.getWork())return false
        const batch=identified.slice(offset,offset+50),fingerprints=await Promise.all(batch.map(({record})=>fingerprint(record)))
        if(owner!==hooks.getWork())return false
        const response=await hooks.api('report-decisions-confirm',{target_instance:hooks.instance(),source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',items:batch.map(({record},index)=>({source_admission_id:String(record.enrollment_source_id),source_report_id:String(record.source_id),...fingerprints[index],action:'skip',expected_revision:record.skipDecision?.revision||null}))})
        if(owner!==hooks.getWork())return false
        for(let index=0;index<batch.length;index++){const {record}=batch[index],fp=fingerprints[index],decision=response.items?.[index];record.sourceSkipped=true;record.skipDecision={status:'skip',revision:decision?.revision,confirmedAt:decision?.confirmed_at,expiresAt:decision?.expires_at,fingerprint:fp.content_fingerprint,contextFingerprint:fp.context_fingerprint,fieldFingerprints:fp.field_fingerprints}}
      }
      for(const {record} of selected.filter(({record})=>!identified.some(entry=>entry.record===record))){const fp=await fingerprint(record);record.sourceSkipped=true;record.skipDecision={status:'local-skip',confirmedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*86400000).toISOString(),fingerprint:fp.content_fingerprint,contextFingerprint:fp.context_fingerprint,fieldFingerprints:fp.field_fingerprints}}
      if(owner!==hooks.getWork())return false
      return hooks.changed()
    } catch { return false }
  }
  return { resolve, refreshContext, setSkip, continueSkipping }
}
