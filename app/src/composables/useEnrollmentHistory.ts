import { describeError, type ErrorDescription } from '@/services/errors/describeError'
import { ref, watch, type Ref } from 'vue'
import { EnrollmentHistoryService as service } from '@/services/enrollment/EnrollmentHistoryService'
import type { EnrollmentHistoryReport, HistoryOccurrenceCandidate, HistoryBindingPreview } from '@/models/EnrollmentHistoryReport'

/** Keep history reads, binding revisions and late-response guards out of presentation components. */
export function useEnrollmentHistory(scope: Ref<{student_id?:string;enrollment_id?:string}>) {
  const rows=ref<EnrollmentHistoryReport[]>([]),loading=ref(false),message=ref<{i18nKey:string;i18nParams?:Record<string, unknown>} | ErrorDescription | null>(null),cursor=ref<string|null>(null)
  const selected=ref<EnrollmentHistoryReport|null>(null),candidates=ref<HistoryOccurrenceCandidate[]>([]),candidateCursor=ref<string|null>(null)
  const occurrence=ref(''),preview=ref<HistoryBindingPreview|null>(null),overwrite=ref<string[]>([]),includeInternal=ref(false)
  const conflicts=ref<HistoryBindingPreview['conflicts']>([])
  let generation=0,key=crypto.randomUUID()
  async function load(more=false) {
    const serial=++generation;loading.value=true;message.value={i18nKey:'report.history.loading'}
    try {const page=await service.list(scope.value,more?cursor.value||undefined:undefined);if(serial!==generation)return
      rows.value=more?[...rows.value,...page.items]:page.items;cursor.value=page.next_cursor;message.value={i18nKey:'report.history.loaded',i18nParams:{count:rows.value.length}}
    } catch(error){if(serial===generation)message.value=describeError(error)}
    finally{if(serial===generation)loading.value=false}
  }
  async function choose(row:EnrollmentHistoryReport,more=false) {
    const serial=++generation;selected.value=row;loading.value=true
    if(!more){preview.value=null;conflicts.value=[];candidates.value=[];candidateCursor.value=null;occurrence.value='';overwrite.value=[];includeInternal.value=false;key=crypto.randomUUID()}
    try{const page=await service.candidates(row.id,more?candidateCursor.value||undefined:undefined);if(serial!==generation)return
      candidates.value=more?[...candidates.value,...page.items]:page.items;candidateCursor.value=page.next_cursor
      message.value=candidates.value.length?{i18nKey:'report.history.choose_occurrence'}:{i18nKey:'report.history.no_candidates'}
    }catch(error){if(serial===generation)message.value=describeError(error)}finally{if(serial===generation)loading.value=false}
  }
  async function bind(apply=false) {
    if(!selected.value||!occurrence.value||loading.value)return
    const row=selected.value,serial=++generation;loading.value=true
    try{if(!apply)key=crypto.randomUUID();const result=await service.bind(apply?'bind-apply':'bind-preview',row,occurrence.value,key,overwrite.value,includeInternal.value);if(serial!==generation)return
      if(apply){rows.value=rows.value.filter(r=>r.id!==row.id);selected.value=null;preview.value=null;message.value={i18nKey:'report.history.bound'}}
      else{preview.value=result;conflicts.value=result.conflicts;message.value={i18nKey:'report.history.preview'}}
    }catch(error){if(serial===generation)message.value=describeError(error)}finally{if(serial===generation)loading.value=false}
  }
  watch([overwrite,includeInternal,occurrence],()=>{preview.value=null},{deep:true})
  watch(occurrence,()=>{conflicts.value=[]})
  watch(scope,()=>{selected.value=null;candidates.value=[];preview.value=null;conflicts.value=[];cursor.value=null;void load()},{immediate:true})
  return {rows,loading,message,cursor,selected,candidates,candidateCursor,occurrence,preview,conflicts,overwrite,includeInternal,load,choose,bind}
}
