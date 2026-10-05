const stateLabels = {bind:'可綁定課次',history:'先存歷史',needs:'需要處理',linked:'已綁定',skipped:'已略過'}
/** Retain list controls and the active draft while filters and async results change. */
export function createHistoryWorkbench(hooks) {
  const $ = id => document.getElementById(id), make = (tag,text) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; return n }
  const buttons = new Map(),studentGroups=new Map(),enrollmentGroups=new Map(); let items=[], selected='', owner, editorKey=''
  function changed() { hooks.changed() }
  function open(item) {
    const host=$('history-detail');host.replaceChildren();editorKey=item.key
    const r=item.record, title=make('h3',`${item.target?.name||r.sourceStudentName||'來源報名 #'+r.enrollment_source_id} · ${r.date||r.dateRaw||'日期待確認'}`)
    host.append(title,make('p',`${item.target?.courseName||r.sourceCourseLabel||'課程待確認'} · ${stateLabels[item.category]}`),make('p',item.reason))
    const original=make('a','查看原站完整紀錄 ↗'); original.href=`https://corp.orangeapple.co/dt_admissions/${r.enrollment_source_id}`;original.target='_blank';original.rel='noopener noreferrer';original.className='mapping-link';host.append(original)
    const evidence=make('details'),summary=make('summary','擷取原文與來源證據');evidence.className='source-evidence';evidence.append(summary)
    for(const e of r.sourceEvidence||[]) { evidence.append(make('p',`${e.sourcePath} · ${e.table} · 第 ${e.row} 列`)); for(const f of e.fields||[])evidence.append(make('p',`${f.label}：${f.text??''}`)) }
    if(!r.sourceEvidence?.length)evidence.append(make('p','此工作尚未保留擷取原文，可補讀來源資料。'))
    host.append(evidence)
    if(r.sourceFieldConflicts?.length){
      const section=make('section'),title=make('h4','列表與已儲存報告頁內容不同'),help=make('p','請查看兩邊內容。確認後會採用已儲存報告編輯頁的值；重讀可更新證據，略過不會寫入這筆。');section.className='source-conflicts';section.append(title,help)
      for(const conflict of r.sourceFieldConflicts){const row=make('div');row.append(make('strong',conflict.label),make('p',`歷史列表：${conflict.listValue||'空白'}`),make('p',`已儲存報告頁：${conflict.editValue||'空白'}`));section.append(row)}
      if(r.sourceConflictAcknowledged)section.append(make('p','已確認採用已儲存報告編輯頁內容。','field-mapping-status'))
      else{const confirm=make('button','核對後採用已儲存報告頁內容');confirm.type='button';confirm.onclick=()=>{r.sourceConflictAcknowledged=true;hooks.changed()};section.append(confirm)}
      host.append(section)
    }
    if(!r.date||r.sourceDateConflict) {
      const label=make('label','需要您確認：完整上課日期'),date=make('input'); date.type='date';date.value=r.userConfirmedDate||r.date||'';label.append(date)
      const confirm=make('button','確認日期，保留原文並重新核對');confirm.type='button'
      confirm.onclick=()=>{if(!date.value||!date.checkValidity())return date.reportValidity();r.userConfirmedDate=date.value;r.date=date.value;r.sourceDateConflict=false;hooks.recheck()};host.append(label,confirm)
    }
    if(item.candidates?.length>1) {
      const label=make('label','需要您確認：本份紀錄的目標課次'),select=make('select');select.dataset.sourceRawOptions='true';select.add(new Option('請選擇合法課次，或先存歷史',''));for(const c of item.candidates)select.add(new Option(`${c.class_name} · ${c.occurrence_date} · ${c.start_time||'時段未提供'}`,c.id));select.value=r.historyOccurrenceId||'';label.append(select);host.append(label);select.onchange=()=>{r.historyOccurrenceId=select.value;r.historyConflictConfirmed=false;hooks.recheck()}
    }
    if(item.conflicts?.length) {
      host.append(make('h4','既有報告差異 · 未勾選的欄位保留 EduLog'))
      for(const f of item.conflicts) {
        const label=make('label'),check=make('input');check.type='checkbox';check.checked=(r.historyOverwrite||[]).includes(f);label.className='check';label.append(check,make('span',`改用來源「${hooks.labels[f]||f}」：${String(item.occurrence.report[f])} → ${String(item.data[f])}`));host.append(label)
        check.onchange=()=>{r.historyOverwrite=check.checked?[...new Set([...(r.historyOverwrite||[]),f])]:(r.historyOverwrite||[]).filter(k=>k!==f);r.historyConflictConfirmed=false;hooks.changed()}
      }
      const confirm=make('button','已核對差異，依上述選擇列入摘要');confirm.type='button';confirm.onclick=()=>{r.historyConflictConfirmed=true;hooks.recheck()};host.append(confirm)
    }
    if(item.identityAmbiguous) {
      const confirm=make('button','已核對：這是同日另一份紀錄，保留兩筆歷史');confirm.type='button';confirm.onclick=()=>{r.historyDuplicateConfirmed=true;hooks.recheck()};host.append(confirm)
    }
    hooks.fields?.(host,item)
    const actions=make('div');actions.className='mapping-actions'
    const only=make('button','先存歷史，不變更課次報告');only.type='button';only.onclick=()=>{r.historyOnly=true;hooks.recheck()}
    const retry=make('button','重新核對此份紀錄');retry.type='button';retry.onclick=()=>hooks.recheck()
    const skip=make('button',r.sourceSkipped?'取消略過':'略過此份紀錄');skip.type='button';skip.onclick=()=>{r.sourceSkipped=!r.sourceSkipped;hooks.recheck()};actions.append(only,retry,skip);host.append(actions)
    for(const control of host.querySelectorAll('button,input,select,textarea,summary,a'))control.dataset.focusKey=`${control.tagName}:${control.type||''}:${control.closest('label')?.firstChild?.textContent||control.textContent.trim().slice(0,80)}`
  }
  function render(next) {
    const work=hooks.work(),restored=owner!==work?work?.historyUI:null;if(owner!==work){buttons.clear();studentGroups.clear();enrollmentGroups.clear();$('history-items').replaceChildren();owner=work;editorKey='';selected=work?.historyUI?.selected||'';for(const [id,key] of [['history-search','search'],['history-filter','filter']])$(id).value=work?.historyUI?.[key]??(key==='filter'?'needs':'')}
    items=next;const query=$('history-search').value.trim().toLowerCase(),filter=$('history-filter').value
    const keys=new Set(items.map(i=>i.key));for(const [key,button] of buttons)if(!keys.has(key)){button.remove();buttons.delete(key)}
    if(!keys.has(selected)){selected='';editorKey='';$('history-detail').textContent='選擇需要處理的項目；其餘紀錄可在同步摘要集中確認。'}
    let visible=0;const visibleStudents=new Set(),visibleEnrollments=new Set(),currentStudents=new Set(),currentEnrollments=new Set(),reportCounts=new Map(),splitAdmissions=new Set(work?.mappingView?.studentSplits||[])
    for(const item of items) {
      const r=item.record,name=String(item.target?.name||r.sourceStudentName||'').trim(),admission=String(r.enrollment_source_id||'unknown'),studentId=r.student_source_id
      const studentKey=splitAdmissions.has(admission)?`admission:${admission}`:studentId?`student:${studentId}`:name?`name:${name}`:`admission:${admission}`;currentStudents.add(studentKey)
      let student=studentGroups.get(studentKey)
      if(!student){student=make('section');student.className='history-student-group';student.dataset.studentGroup=studentKey;const heading=make('h4',name||`來源報名 #${admission}`);heading.className='history-student-heading';heading.dataset.sourceRaw='true';student.append(heading,make('span',''));student.lastElementChild.className='history-student-count';if(studentKey.startsWith('name:'))student.append(make('p','依姓名暫時分組；來源沒有可靠學生 ID，請在寫入前確認身份。','hint'));const children=make('div');children.className='history-enrollments';student.append(children);studentGroups.set(studentKey,student)}
      const course=item.target?.courseName||r.sourceCourseLabel||'課程待確認',enrollmentKey=`${studentKey}:enrollment:${admission}:${r.sourceCourseCode||course}`;currentEnrollments.add(enrollmentKey);reportCounts.set(enrollmentKey,(reportCounts.get(enrollmentKey)||0)+1)
      let enrollment=enrollmentGroups.get(enrollmentKey)
      if(!enrollment){enrollment=make('section');enrollment.className='history-enrollment-group';enrollment.dataset.enrollmentGroup=enrollmentKey;const heading=make('h5',`${course} · 報名 #${admission}`);enrollment.append(heading);const list=make('div');list.className='history-report-items';enrollment.append(list);studentGroups.get(studentKey).lastElementChild.append(enrollment);enrollmentGroups.set(enrollmentKey,enrollment)}
      if(!student.isConnected)$('history-items').append(student)
      let b=buttons.get(item.key)
      if(!b){b=make('button');b.type='button';b.className='mapping-list-item';b.onclick=()=>{const current=items.find(i=>i.key===b.dataset.key);if(!current)return;selected=current.key;editorKey='';render(items);$('history-workbench').dataset.mobileView='editor';hooks.uiChanged?.()};b.dataset.key=item.key;buttons.set(item.key,b)}
      if(b.parentElement!==enrollment.lastElementChild)enrollment.lastElementChild.append(b)
      const text=`${name} ${course} ${r.date||r.dateRaw||''} ${admission}`
      b.hidden=item.key!==selected&&((filter!=='all'&&filter!==item.category)||!text.toLowerCase().includes(query));if(!b.hidden)visible++
      b.replaceChildren(make('strong',r.date||r.dateRaw||'日期待確認'),make('span',stateLabels[item.category]));b.setAttribute('aria-current',String(item.key===selected));if(!b.hidden){visibleStudents.add(studentKey);visibleEnrollments.add(enrollmentKey)}
      if(item.key===selected&&editorKey!==selected)open(item)
    }
    for(const [key,group] of studentGroups)if(!currentStudents.has(key)){group.remove();studentGroups.delete(key)}
    for(const [key,group] of enrollmentGroups)if(!currentEnrollments.has(key)){group.remove();enrollmentGroups.delete(key)}
    for(const [key,group] of enrollmentGroups){const heading=group.querySelector('h5');if(heading)heading.textContent=`${heading.textContent.replace(/ · \d+ 份歷史$/,'')} · ${reportCounts.get(key)||0} 份歷史`}
    for(const [key,group] of studentGroups){const count=group.querySelector('.history-student-count');if(count)count.textContent=`${group.querySelectorAll('.history-enrollment-group').length} 筆報名`}
    for(const [key,group] of studentGroups)group.hidden=!visibleStudents.has(key)
    for(const [key,group] of enrollmentGroups)group.hidden=!visibleEnrollments.has(key)
    $('history-empty').hidden=visible>0
    $('history-sync-summary').textContent=Object.entries(stateLabels).map(([k,v])=>`${v} ${items.filter(i=>i.category===k).length}`).join(' · ')
    if(restored){$('history-items').scrollTop=restored.listScroll||0;$('history-editor').scrollTop=restored.editorScroll||0}
    if(work)work.historyUI={selected,search:$('history-search').value,filter:$('history-filter').value,listScroll:$('history-items').scrollTop,editorScroll:$('history-editor').scrollTop}
  }
  for(const id of ['history-search','history-filter'])$(id).addEventListener(id.endsWith('search')?'input':'change',()=>{selected='';render(items);hooks.uiChanged?.()})
  $('history-back').onclick=()=>{$('history-workbench').dataset.mobileView='list';buttons.get(selected)?.focus({preventScroll:true})}
  for(const id of ['history-items','history-editor'])$(id).addEventListener('scroll',()=>{if(owner?.historyUI)owner.historyUI[id==='history-items'?'listScroll':'editorScroll']=$(id).scrollTop})
  return {render,refreshEditor:(next=items)=>{const pane=$('history-editor'),position=pane.scrollTop,page=window.scrollY,key=document.activeElement?.dataset.focusKey,expanded=new Set([...pane.querySelectorAll('details[open]')].map(d=>d.querySelector('summary')?.textContent));editorKey='';render(next);for(const detail of pane.querySelectorAll('details'))if(expanded.has(detail.querySelector('summary')?.textContent))detail.open=true;pane.scrollTop=position;window.scrollTo(0,page);if(key)[...pane.querySelectorAll('[data-focus-key]')].find(c=>c.dataset.focusKey===key)?.focus({preventScroll:true})},items:()=>items}
}
