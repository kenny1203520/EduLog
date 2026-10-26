<template>
  <section class="history-panel" aria-label="來源歷史教學紀錄">
    <header><div><h2>來源歷史教學紀錄</h2><p>已保存於報名。未綁定課次的紀錄不計入出席或未填報告。</p></div><button type="button" :disabled="loading" @click="load()">重新讀取</button></header>
    <p role="status" aria-live="polite">{{ message }}</p>
    <div class="history-layout" :aria-busy="loading">
      <div class="history-list"><button v-for="row in rows" :key="row.id" type="button" :aria-pressed="selected?.id===row.id" @click="choose(row)"><strong>{{ row.report_date }} · {{ row.student_name || row.course_name }}</strong><span>{{ row.course_name }} · {{ row.identity_status==='verified'?'原站報告已驗證':'只有教學證據，身份不足' }}</span></button><button v-if="cursor" :disabled="loading" @click="load(true)">載入更多歷史</button></div>
      <article v-if="selected" class="history-detail">
        <h3>{{ selected.report_date }} · {{ selected.course_name }}</h3>
        <dl><dt>出席</dt><dd>{{ ({present:'出席',absent:'未出席',pending:'待確認'} as Record<string,string>)[selected.attendance_status || ''] || '未填寫' }}</dd><dt>完成狀況</dt><dd>{{ selected.is_completed==null?'未填寫':selected.is_completed?'已完成':'未完成' }}</dd><dt>課程參與</dt><dd>{{ selected.class_participation ?? '未填寫' }}</dd><dt>課堂表現</dt><dd>{{ selected.classroom_behavior ?? '未填寫' }}</dd></dl>
        <h4>評語</h4><p class="content">{{ selected.content || '空白' }}</p><h4>聯絡欄</h4><p class="content">{{ selected.contact_notes || '空白' }}</p>
        <h4>教材與進度</h4><p>{{ selected.lesson_name || '教材未確認' }} · {{ selected.progress_letter || '進度未填寫' }}</p><details v-if="selected.class_notes"><summary>教師內部紀錄</summary><p class="content">{{ selected.class_notes }}</p></details>
        <details><summary>允許的來源原文</summary><p v-for="(field,index) in selected.source_fields" :key="index" class="content">{{ field.label }}：{{ field.text || '空白' }}</p></details>
        <a v-if="selected.external_link" :href="selected.external_link" target="_blank" rel="noopener noreferrer">查看原站報告</a>
        <label v-if="candidates.length">綁定課次<select v-model="occurrence"><option value="">請選擇並核對課次</option><option v-for="item in candidates" :key="item.id" :value="item.id">{{ item.occurrence_date }} · {{ item.class_name }} · {{ item.start_time }}–{{ item.end_time }}</option></select></label>
        <button v-if="candidateCursor" :disabled="loading" @click="choose(selected,true)">載入更多課次</button>
        <label v-if="selected.class_notes" for="edulog-enrollmenthistorypanel-16-2341"><input v-model="includeInternal" type="checkbox">另行允許內部紀錄</label>
        <div v-if="conflicts.length"><h4>綁定差異</h4><label v-for="conflict in conflicts" :key="conflict.field"><input v-model="overwrite" type="checkbox" :value="conflict.field" id="edulog-enrollmenthistorypanel-16-2341">覆寫 {{ fieldLabels[conflict.field] || conflict.field }}：{{ conflict.before }} → {{ conflict.after }}</label><p>未勾選的差異保留 EduLog 原值；變更選擇後請重新檢查。</p></div>
        <button v-if="occurrence" :disabled="loading" @click="bind(Boolean(preview))">{{ preview?'確認綁定課次報告':'檢查綁定差異' }}</button>
      </article>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useEnrollmentHistory } from '@/composables/useEnrollmentHistory'
const props=defineProps<{studentId?:string;enrollmentId?:string}>()
const scope=computed(()=>({student_id:props.studentId,enrollment_id:props.enrollmentId}))
const fieldLabels:Record<string,string>={lesson_id:'教材',is_completed:'完成狀況',progress_letter:'進度',attendance_status:'出席',absence_reason:'不出席原因',class_participation:'課程參與',classroom_behavior:'課堂表現',content:'評語',contact_notes:'聯絡欄',class_notes:'內部紀錄',external_link:'報告連結'}
const {rows,loading,message,cursor,selected,candidates,candidateCursor,occurrence,preview,conflicts,overwrite,includeInternal,load,choose,bind}=useEnrollmentHistory(scope)
</script>
<style scoped>
.history-panel{margin:24px 0;padding:20px;background:white;border:1px solid #dbe3ee;border-radius:12px;font-size:16px;color:#172033}.history-panel header{display:flex;justify-content:space-between;gap:16px}.history-panel h2,.history-panel h3{font-weight:700}.history-panel p{margin:8px 0}.history-panel button,.history-panel select,.history-panel summary,.history-panel a{min-height:44px;padding:8px 12px}.history-panel button{border:1px solid #b9c6db;border-radius:8px;text-align:left}.history-panel button:focus-visible,.history-panel select:focus-visible,.history-panel a:focus-visible,.history-panel summary:focus-visible{outline:3px solid #2563eb;outline-offset:2px}.history-layout{display:grid;grid-template-columns:minmax(220px,1fr) minmax(0,2fr);gap:20px}.history-list{display:grid;align-content:start;gap:8px}.history-list button{display:grid;gap:4px}.history-list button[aria-pressed=true]{background:#eef4ff;border-color:#2449bb}.history-list span{font-size:14px}.history-detail{min-width:0;overflow-wrap:anywhere}.history-detail dl{display:grid;grid-template-columns:1fr 2fr;gap:8px}.history-detail label{display:block;margin:12px 0}.history-detail select{display:block;max-width:100%;border:1px solid #b9c6db}.content{white-space:pre-wrap}.history-detail input{margin-right:8px}@media(max-width:767px){.history-layout{grid-template-columns:1fr}.history-panel{padding:14px}.history-panel header{flex-wrap:wrap}}
</style>
