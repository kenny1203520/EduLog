// Navigation is derived from evidence, never from whether a step was visited.
export function workflowState(view,{work,form,report,previewCount=0,unresolved=0}={}) {
  if(view==='prefill') {
    const target=Boolean(form?.formId),review=Boolean(report&&work?.prefill),applied=work?.type==='prefill'&&work.status==='pending_confirmation'
    return {available:[true,target,review,applied],complete:[Boolean(target&&form.date),Boolean(report),applied,false],attention:[false,false,false,false]}
  }
  const own=work?.type==='import'?work:null,read=Boolean(own?.snapshot),historyDone=(!own?.history||own.history.next>=own.history.paths?.length)&&!(own?.history?.issues||[]).some(issue=>!issue.skipped)
  const preview=Boolean(own?.previewEvaluated||own?.jobId&&own?.batches?.length),submitted=(own?.done||0)>0
  const running=['applying','outcome_unknown','paused','failed','complete','partial_complete','cancelled'].includes(own?.status)
  const done=Boolean(own?.jobId&&own.done===(own.batches?.length??own.batchCount)&&['complete','partial_complete'].includes(own.status))
  return {available:[true,read,preview,submitted||running],complete:[read&&historyDone,read&&unresolved===0,done,false],attention:[read&&!historyDone,read&&unresolved>0,preview&&(own.previewDirty||previewCount===0)&&!submitted,own?.status==='partial_complete'||own?.status==='outcome_unknown'||own?.status==='failed']}
}
export function workCategory(work) {
  if(['complete','confirmed','cancelled'].includes(work.status))return 'done'
  if(['failed','partial_complete','outcome_unknown','pending_confirmation'].includes(work.status))return 'attention'
  return 'resumable'
}
const EMPTY_REMOTE_WORK = Object.freeze({ imports: Object.freeze([]), pushes: Object.freeze([]) })
export function combineWorkRecords(local=[],remote=EMPTY_REMOTE_WORK,metadata=[]) {
  const byMetadataJob=new Map(metadata.filter(item=>item.server_job_id).map(item=>[item.server_job_id,item]))
  const byMetadataId=new Map(metadata.map(item=>[item.work_id,item]))
  const usedMetadata=new Set()
  const rows=local.map(work=>{
    const meta=byMetadataId.get(work.id)||byMetadataJob.get(work.jobId)
    if(meta)usedMetadata.add(meta.work_id)
    return {local:work,remote:null,metadata:meta||null,category:workCategory(work)}
  }),byJob=new Map(rows.filter(row=>row.local.type==='import'&&row.local.jobId).map(row=>[row.local.jobId,row]))
  for(const job of remote.imports||[]) {const row=byJob.get(job.id);if(row){row.remote=job;row.metadata ||= byMetadataJob.get(job.id)||null;if(row.metadata)usedMetadata.add(row.metadata.work_id);if(workCategory(job)==='attention')row.category='attention'}else rows.push({local:null,remote:job,metadata:byMetadataJob.get(job.id)||null,category:workCategory(job)})}
  // Push records have no guaranteed local-job key. Keep them separately labelled.
  for(const push of remote.pushes||[])rows.push({local:null,push,category:workCategory(push)})
  for(const item of metadata)if(!usedMetadata.has(item.work_id)&&!item.server_job_id)rows.push({local:null,remote:null,metadata:item,category:item.archived_at?'done':'resumable'})
  return rows
}
