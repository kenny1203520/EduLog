const interruptionCodes = new Set(['READ_CANCELLED','SOURCE_CLOSED','SOURCE_CHANGED','SOURCE_SCRIPT_UNAVAILABLE','EXTENSION_CONTEXT_INVALIDATED'])

// Checkpoints belong to a work, never to the currently visible editor.
export async function readHistoryWork(work, hooks, retryPath) {
  const history=work.history
  history.issues ||= []; history.reportCount ||= 0; history.checkpoints ||= {}
  if(history.queue && history.paths[history.next]) {
    history.checkpoints[history.paths[history.next]] ||= { records:history.queue, next:history.nextReport||0 }
    delete history.queue; delete history.nextReport
  }
  const assertCurrent=()=>{if(!hooks.current()){const error=new Error('來源或工作已切換；已讀取的檢查點保留。');error.code='READ_CANCELLED';throw error}}
  const persist=async()=>{assertCurrent();await hooks.save();assertCurrent()}
  const read=async(action,extra)=>{assertCurrent();const data=await hooks.source(action,{workId:work.id,...extra});assertCurrent();return data}
  const paths=retryPath?[retryPath]:history.paths.slice(history.next)
  if(retryPath)delete history.checkpoints[retryPath]
  work.status='collecting';await persist()
  try {
    for(const historyPath of paths) {
      if(hooks.paused())break
      let checkpoint=history.checkpoints[historyPath]
      if(checkpoint?.complete){if(!retryPath)history.next++;await persist();continue}
      if(!checkpoint) {
        try {
          const records=await read('history',{historyPath})
          checkpoint=history.checkpoints[historyPath]={records,next:0}
          history.issues=history.issues.filter(r=>!(r.listFailed&&r.admissionPath===historyPath));await persist()
        } catch(error) {
          if(interruptionCodes.has(error.code))throw error
          history.issues=history.issues.filter(r=>!(r.listFailed&&r.admissionPath===historyPath))
          history.issues.push({evidenceKey:historyPath,listFailed:true,admissionPath:historyPath,reason:error.message})
          if(!retryPath)history.next++;await persist();continue
        }
      }
      while(checkpoint.next<checkpoint.records.length&&!hooks.paused()) {
        const record=checkpoint.records[checkpoint.next]
        if(record.date&&(record.date<work.dateFrom||record.date>work.dateTo)){checkpoint.next++;await persist();continue}
        hooks.progress(`正在讀取報名 #${record.enrollment_source_id} 的報告；已讀取 ${history.reportCount} 份。`)
        let incoming=record
        if(record.source_id) {
          try {incoming=await read('history-report',{historyPath,input:{reportId:record.source_id,evidenceKey:record.evidenceKey}});history.reportCount++}
          catch(error){if(interruptionCodes.has(error.code))throw error;incoming={...record,sourceReadStatus:'failed',needs:[error.message]}}
        }
        history.issues=history.issues.filter(r=>r.evidenceKey!==incoming.evidenceKey)
        if(!incoming.date||incoming.sourceReadStatus==='failed')history.issues.push(incoming)
        work.snapshot.records=hooks.merge(work.snapshot.records,[incoming])
        if(!incoming.source_id)history.reportCount++
        checkpoint.next++;await persist()
        hooks.progress(`已讀取 ${history.reportCount} 份報告；已檢查 ${checkpoint.next}／${checkpoint.records.length} 筆本生歷史紀錄。`)
      }
      if(hooks.paused())break
      checkpoint.complete=true
      delete checkpoint.records
      if(!retryPath)history.next++;await persist()
    }
    work.status=hooks.paused()||history.next<history.paths.length?'paused-extraction':'collected';delete work.collectionError;await persist()
  }catch(error){
    if(hooks.current()){work.status='paused-extraction';work.collectionError=error.message;await persist()}
  }
}
