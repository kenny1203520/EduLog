import { ref, watch, type Ref } from 'vue'
import { EnrollmentHistoryService as service } from '@/services/EnrollmentHistoryService'
import type { EnrollmentHistoryReport, HistoryOccurrenceCandidate, HistoryBindingPreview } from '@/models/EnrollmentHistoryReport'

/** Keep history reads, binding revisions and late-response guards out of presentation components. */
export function useEnrollmentHistory(scope: Ref<{student_id?:string;enrollment_id?:string}>) {
  const rows=ref<EnrollmentHistoryReport[]>([]),loading=ref(false),message=ref(''),cursor=ref<string|null>(null)
  const selected=ref<EnrollmentHistoryReport|null>(null),candidates=ref<HistoryOccurrenceCandidate[]>([]),candidateCursor=ref<string|null>(null)
  const occurrence=ref(''),preview=ref<HistoryBindingPreview|null>(null),overwrite=ref<string[]>([]),includeInternal=ref(false)
  let generation=0,key=crypto.randomUUID()
  async function load(more=false) {
    const serial=++generation;loading.value=true;message.value='正在讀取歷史紀錄…'
    try {const page=await service.list(scope.value,more?cursor.value||undefined:undefined);if(serial!==generation)return
      rows.value=more?[...rows.value,...page.items]:page.items;cursor.value=page.next_cursor;message.value=`已載入 ${rows.value.length} 份歷史紀錄。`
    } catch(error){if(serial===generation)message.value=`歷史紀錄讀取失敗：${(error as Error).message}。請重試；舊伺服器需部署 1000126。`}
    finally{if(serial===generation)loading.value=false}
  }
  async function choose(row:EnrollmentHistoryReport,more=false) {
    const serial=++generation;selected.value=row;loading.value=true
    if(!more){preview.value=null;occurrence.value='';overwrite.value=[];includeInternal.value=false;key=crypto.randomUUID()}
    try{const page=await service.candidates(row.id,more?candidateCursor.value||undefined:undefined);if(serial!==generation)return
      candidates.value=more?[...candidates.value,...page.items]:page.items;candidateCursor.value=page.next_cursor
      message.value=candidates.value.length?'請核對合法課次；綁定不會變更原報名。':'沒有可綁定課次；已保存歷史，不影響名單或出席統計。'
    }catch(error){if(serial===generation)message.value=(error as Error).message}finally{if(serial===generation)loading.value=false}
  }
  async function bind(apply=false) {
    if(!selected.value||!occurrence.value||loading.value)return
    const row=selected.value,serial=++generation;loading.value=true
    try{if(!apply)key=crypto.randomUUID();const result=await service.bind(apply?'bind-apply':'bind-preview',row,occurrence.value,key,overwrite.value,includeInternal.value);if(serial!==generation)return
      if(apply){rows.value=rows.value.filter(r=>r.id!==row.id);selected.value=null;preview.value=null;message.value='已綁定課次報告，保留原報名關係；未選取的差異保留 EduLog 原值。'}
      else{preview.value=result;message.value='請核對摘要，再確認綁定。'}
    }catch(error){if(serial===generation)message.value=`操作未完成：${(error as Error).message}。請重新讀取核對。`}finally{if(serial===generation)loading.value=false}
  }
  watch([overwrite,includeInternal,occurrence],()=>{preview.value=null},{deep:true})
  watch(scope,()=>{selected.value=null;candidates.value=[];void load()},{immediate:true})
  return {rows,loading,message,cursor,selected,candidates,candidateCursor,occurrence,preview,overwrite,includeInternal,load,choose,bind}
}
