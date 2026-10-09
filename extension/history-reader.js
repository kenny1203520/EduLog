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
  const persist=async()=>{assertCurrent();try{await hooks.save()}catch(error){error.workspaceSaveFailure=true;throw error}assertCurrent()}
  const read=async(action,extra)=>{assertCurrent();const data=await hooks.source(action,{workId:work.id,...extra});assertCurrent();return data}
  const paths=retryPath?[retryPath]:history.paths.slice(history.next)
  if(retryPath)delete history.checkpoints[retryPath]
  work.status='collecting'
  try {
    await persist()
    for(const historyPath of paths) {
      if(hooks.paused())break
      let checkpoint=history.checkpoints[historyPath]
      if(checkpoint?.complete){if(!retryPath)history.next++;await persist();continue}
      if(!checkpoint) {
        let records
        try { records=await read('history',{historyPath}) }
        catch(error) {
          if(interruptionCodes.has(error.code)||error.workspaceSaveFailure)throw error
          history.issues=history.issues.filter(r=>!(r.listFailed&&r.admissionPath===historyPath))
          history.issues.push({evidenceKey:historyPath,listFailed:true,admissionPath:historyPath,reason:error.message})
          if(!retryPath)history.next++;await persist();continue
        }
        history.lastSourceReadAt=Math.max(Date.now(),(history.lastSourceReadAt||0)+1)
        {
          const previousEnrollments=new Map()
          for(const report of records)if(report.sourceRowType==='previous-admission'&&report.sourceAdmissionContextVerified&&report.enrollment_source_id&&report.student_source_id&&report.sourceCourseCode&&!work.snapshot.records.some(r=>r.kind==='enrollment'&&r.source_id===report.enrollment_source_id)){
            previousEnrollments.set(report.enrollment_source_id,{kind:'enrollment',source_id:report.enrollment_source_id,student_source_id:report.student_source_id,sourceStudentName:report.sourceStudentName,sourceCourseName:report.sourceCourseName,sourceCourseLabel:report.sourceCourseLabel,sourceCourseCode:report.sourceCourseCode,source_course_id:`code:${report.sourceCourseCode}`,data:{external_link:`https://corp.orangeapple.co/dt_admissions/${report.enrollment_source_id}`},sourceEvidence:report.sourceEvidence||[],needs:[]})
          }
          if(previousEnrollments.size)work.snapshot.records=hooks.merge(work.snapshot.records,[...previousEnrollments.values()])
          for(const report of records){
            const enrollment=work.snapshot.records.find(r=>r.kind==='enrollment'&&r.source_id===report.enrollment_source_id)
            if(!enrollment)continue
            if(report.student_source_id){
              if(enrollment.student_source_id&&enrollment.student_source_id!==report.student_source_id){enrollment.sourceStudentConflict=true;report.sourceStudentIdentityConflict=true;enrollment.sourceStudentIdConflictValues=[...new Set([...(enrollment.sourceStudentIdConflictValues||[enrollment.student_source_id]),report.student_source_id])];enrollment.sourceIdentityChanged=true}
              else enrollment.student_source_id=report.student_source_id
            }
            if(report.sourceStudentName){
              if(enrollment.sourceStudentName&&enrollment.sourceStudentName!==report.sourceStudentName){enrollment.sourceStudentNameConflict=true;report.sourceStudentIdentityConflict=true;enrollment.sourceStudentNameConflictValues=[...new Set([...(enrollment.sourceStudentNameConflictValues||[enrollment.sourceStudentName]),report.sourceStudentName])];enrollment.sourceIdentityChanged=true}
              else enrollment.sourceStudentName=report.sourceStudentName
            }
            if(report.sourceCourseCode){
              if(enrollment.sourceCourseCode&&enrollment.sourceCourseCode!==report.sourceCourseCode){enrollment.sourceCourseConflict=true;enrollment.sourceIdentityChanged=true}
              else {enrollment.sourceCourseCode=report.sourceCourseCode;enrollment.sourceCourseLabel=report.sourceCourseLabel||enrollment.sourceCourseLabel;enrollment.source_course_id=`code:${report.sourceCourseCode}`}
            }
            const evidence=new Map([...(enrollment.sourceEvidence||[]),...(report.sourceEvidence||[])].map(item=>[`${item.sourcePath}:${item.table}:${item.row}`,item]));enrollment.sourceEvidence=[...evidence.values()]
            report.student_source_id||=enrollment.student_source_id;report.sourceStudentName||=enrollment.sourceStudentName;report.sourceCourseCode||=enrollment.sourceCourseCode;report.sourceCourseName||=enrollment.sourceCourseName;report.sourceCourseLabel||=enrollment.sourceCourseLabel
          }
          checkpoint=history.checkpoints[historyPath]={records,next:0}
          history.issues=history.issues.filter(r=>!(r.listFailed&&r.admissionPath===historyPath));await persist()
        }
      }
      while(checkpoint.next<checkpoint.records.length&&!hooks.paused()) {
        const record=checkpoint.records[checkpoint.next]
        record.sourceHistoryPath ||= historyPath
        if(record.date&&(record.date<work.dateFrom||record.date>work.dateTo)){checkpoint.next++;await persist();continue}
        hooks.progress(`正在讀取報名 #${record.enrollment_source_id} 的報告；已讀取 ${history.reportCount} 份。`)
        let incoming=record
        if(record.source_id) {
          try {incoming=await read('history-report',{historyPath,input:{reportId:record.source_id,evidenceKey:record.evidenceKey}});history.reportCount++}
          catch(error){if(interruptionCodes.has(error.code))throw error;incoming={...record,sourceReadStatus:'failed',needs:[error.message]}}
        }
        if(incoming.sourceReadStatus!=='failed')history.lastSourceReadAt=Math.max(Date.now(),(history.lastSourceReadAt||0)+1)
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
    if(!hooks.current())return
    work.status='paused-extraction';work.collectionError=error.message
    if(error.workspaceSaveFailure){work.collectionSaveError=error.code||'WORK_SAVE_FAILED';hooks.saveFailure?.(error);throw error}
    try{await persist()}catch(saveError){work.collectionSaveError=saveError.code||'WORK_SAVE_FAILED';hooks.saveFailure?.(saveError);throw saveError}
  }
}
