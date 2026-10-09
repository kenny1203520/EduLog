import {comparison,decisionResult,semanticValue} from './review-ui.js'
const stateLabels = {bind:'可綁定課次',history:'先存歷史',needs:'需要處理',linked:'已綁定',skipped:'已略過',unfilled:'尚未填寫', 'other-admission':'其他報名（未納入）','system-excluded':'系統排除'}
const stateKeys = {bind:'work.historyBind',history:'work.historyOnly',needs:'work.historyNeeds',linked:'work.historyLinked',skipped:'work.historySkipped',unfilled:'work.historyUnfilled','other-admission':'work.historyOtherAdmission','system-excluded':'work.historySystemExcluded'}
/** Retain list controls and the active draft while filters and async results change. */
export function createHistoryWorkbench(hooks) {
  const $ = id => document.getElementById(id), make = (tag,text) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; return n }
  const boundedScroll=(pane,value)=>{const requested=Math.max(0,Number(value)||0),max=pane.scrollHeight||pane.clientHeight?Math.max(0,pane.scrollHeight-pane.clientHeight):Number.MAX_SAFE_INTEGER;return Math.min(requested,max)}
  const localized=(node,key,fallback,params)=>globalThis.edulogUi?globalThis.edulogUi.text(node,key,params):(node.textContent=String(fallback).replace(/\{([^}]+)\}/g,(_,name)=>params?.[name]??''))
  const stateLabel=category=>globalThis.edulogUi?.t(stateKeys[category])||stateLabels[category]||category
  function ensureAutoExclusions(){let details=$('history-auto-exclusions');if(details)return details;details=make('details');details.id='history-auto-exclusions';details.className='history-auto-exclusions';const summary=make('summary');summary.id='history-auto-exclusions-summary';details.append(summary);const count=make('p');count.id='history-auto-exclusions-count';count.setAttribute('role','status');count.setAttribute('aria-live','polite');details.append(count);const help=make('p');localized(help,'work.historyAutoExcludedHelp','這些來源列不會送出，也不需要逐筆確認；來源內容更新後重新讀取即可重新分類。');details.append(help);$('history-workbench').before(details);return details}
  const buttons = new Map(),skipChecks=new Map(),skipSelection=new Set(),studentGroups=new Map(),enrollmentGroups=new Map(),issueCursors=new Map(),reviewedIssues=new Map(); let items=[], selected='', owner, editorKey=''
  const currentRecord=item=>hooks.record?.(item)||item.record
  const currentItem=item=>hooks.item?.(item.key)||items.find(candidate=>candidate.key===item.key)||item
  const conflictSignature=(item,record)=>JSON.stringify({item:item.key,occurrence:item.occurrence?.id,reportVersion:item.occurrence?.report?.version??null,fields:item.conflicts.map(field=>[field,item.data?.[field],item.occurrence?.report?.[field],record.historyFieldDecisions?.[field],record.syncFieldOverrides?.[field]])})
  const listPane=()=> $('history-items').closest('aside')||$('history-items')
  function changed() { hooks.changed() }
  function focusIssue(item,issue) {
    const host=$('history-detail'), target=issue?.target||''
    if(target==='enrollment') {
      document.querySelector('[data-review-pane="identity"]')?.click()
      const identity=document.getElementById('identity-review');if(identity)identity.open=true
      document.querySelector('[data-mapping-section="admissions"]')?.click()
      document.querySelector('#mapping-workbench')?.scrollIntoView?.({block:'start'})
      const choice=[...document.querySelectorAll('[id^="enrollment-"]')].find(control=>control.id===`enrollment-${item.record.enrollment_source_id}`)
      choice?.focus({preventScroll:true});return
    }
    if(target==='internal') {const control=document.getElementById('include-internal-notes');control?.focus({preventScroll:true});control?.scrollIntoView?.({block:'center'});return}
    if(target.startsWith('field:')) {
      const key=target.slice(6),review=host.querySelector('.import-field-review');if(review){review.open=true;const row=[...review.querySelectorAll('[data-review-field]')].find(n=>n.dataset.reviewField===key);if(row){row.querySelector('select')?.focus({preventScroll:true});return}review.querySelector('button')?.click();return}
    }
    const selector=target.startsWith('conflict:')?`[data-issue-target="${target}"]`:target?`[data-issue-target="${target}"]`:''
    const control=selector&&host.querySelector(selector)
    if(control){control.focus({preventScroll:true});control.scrollIntoView?.({block:'center'});return}
    if(target==='source')host.querySelector('button[data-focus-key*="重新核對"]')?.focus({preventScroll:true})
  }
  function renderIssues(container,item) {
    if(!container)return
    const issues=item.category==='needs'?(item.issues?.length?item.issues:[{id:'reason',message:item.reason,target:'source'}]):[]
    const prior=reviewedIssues.get(item.key)||new Map(),active=new Set(issues.map(issue=>issue.id||issue.code||issue.target||'reason'))
    for(const issue of issues)prior.set(issue.id||issue.code||issue.target||'reason',issue)
    reviewedIssues.set(item.key,prior)
    if(!prior.size){container.replaceChildren();return}
    let title=container.querySelector('h4');if(!title){title=make('h4');container.prepend(title)}
    if(globalThis.edulogUi)globalThis.edulogUi.text(title,issues.length?'work.remainingIssues':'work.reviewComplete',{count:issues.length});else title.textContent=issues.length?`待處理問題 · ${issues.length} 項`:'已核對，待同步'
    // Keep resolved rows in place for the selected report: async review must not
    // collapse content under the cursor or clamp the page's scroll position.
    for(const [id,issue] of prior){let row=[...container.children].find(node=>node.dataset.issueId===id);if(!row){row=make('div');row.className='history-review-issue';row.dataset.issueId=id;row.append(make('p',issue.message||item.reason),make('button'));row.lastChild.type='button';container.append(row)}const go=row.lastChild,resolved=!active.has(id);row.dataset.resolved=String(resolved);go.disabled=resolved;go.dataset.focusKey=`issue:${id}`;if(resolved&&globalThis.edulogUi)globalThis.edulogUi.text(go,'work.reviewed');else go.textContent=resolved?'已核對':'前往處理';go.onclick=()=>focusIssue(item,issue)}
  }
  function selectItem(item,issue) {
    selected=item.key;editorKey='';render(items);$('history-workbench').dataset.mobileView='editor';hooks.uiChanged?.();if(issue)focusIssue(item,issue)
  }
  function selectNextIssue() {
    let item=items.find(candidate=>candidate.key===selected)
    if(!item||item.category!=='needs'||!item.issues?.length){item=items.find(candidate=>candidate.category==='needs');if(!item)return;issueCursors.set(item.key,0)}
    else issueCursors.set(item.key,((issueCursors.get(item.key)??-1)+1)%item.issues.length)
    selectItem(item,item.issues[issueCursors.get(item.key)||0])
  }
  function selectNextReport() {
    const pending=items.filter(item=>item.category==='needs');if(!pending.length)return
    const start=pending.findIndex(item=>item.key===selected),item=pending[(start+1+pending.length)%pending.length];selectItem(item,item.issues?.[0])
  }
  function open(item) {
    const host=$('history-detail');host.replaceChildren();editorKey=item.key
    const r=item.record, title=make('h3',`${item.target?.name||r.sourceStudentName||'來源報名 #'+r.enrollment_source_id} · ${r.date||r.dateRaw||'日期待確認'}`)
    const state=make('p',`${item.target?.courseName||r.sourceCourseLabel||'課程待確認'} · ${stateLabel(item.category)}`);state.dataset.historyState=''
    const reason=make('p',item.reason);reason.dataset.historyReason=''
    host.append(title,state,reason)
    const issueList=make('section');issueList.className='history-report-issues';issueList.dataset.historyIssues='';host.append(issueList);renderIssues(issueList,item)
    const original=make('a','查看原站完整紀錄 ↗'); original.href=`https://corp.orangeapple.co/dt_admissions/${r.enrollment_source_id}`;original.target='_blank';original.rel='noopener noreferrer';original.className='mapping-link';original.dataset.issueTarget='source';host.append(original)
    const evidence=make('details'),summary=make('summary','擷取原文與來源證據');evidence.className='source-evidence';evidence.dataset.reviewKey=`source-evidence:${item.key}`;evidence.append(summary)
    for(const e of r.sourceEvidence||[]) { evidence.append(make('p',`${e.sourcePath} · ${e.table} · 第 ${e.row} 列`)); for(const f of e.fields||[])evidence.append(make('p',`${f.label}：${f.text??''}`)) }
    if(!r.sourceEvidence?.length)evidence.append(make('p','此工作尚未保留擷取原文，可補讀來源資料。'))
    host.append(evidence)
    if(['unfilled','other-admission','system-excluded'].includes(item.category)){const status=make('p');status.className='history-auto-row-status';localized(status,item.category==='unfilled'?'work.unfilledNoSync':item.category==='other-admission'?'work.otherAdmissionNoSync':'work.systemExcludedNoSync',item.reason);host.append(status);for(const [index,control] of [...host.querySelectorAll('button,input,select,textarea,summary,a')].entries())control.dataset.focusKey||=`${item.key}:${index}:${control.tagName}`;return}
    if(r.sourceFieldConflicts?.length){
      const section=make('section'),title=make('h4','列表與已儲存報告頁內容不同'),help=make('p','請查看兩邊內容。確認後會採用已儲存報告編輯頁的值；重讀可更新證據，略過不會寫入這筆。');section.className='source-conflicts';section.append(title,help)
      for(const conflict of r.sourceFieldConflicts){const row=make('div');row.append(make('strong',conflict.label),make('p',`歷史列表：${conflict.listValue||'空白'}`),make('p',`已儲存報告頁：${conflict.editValue||'空白'}`));section.append(row)}
      if(r.sourceConflictAcknowledged)section.append(make('p','已確認採用已儲存報告編輯頁內容。','field-mapping-status'))
      else{const confirm=make('button','核對後採用已儲存報告頁內容');confirm.type='button';confirm.dataset.issueTarget='source-conflict';confirm.onclick=async()=>{currentRecord(item).sourceConflictAcknowledged=true;confirm.disabled=true;const saved=await hooks.changed();if(confirm.isConnected){confirm.disabled=saved;const status=make('p');status.className='field-mapping-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');localized(status,saved?'work.reportSaved':'work.reportSaveFailed',saved?'已確認並保存草稿。':'保存失敗，請重試。');confirm.insertAdjacentElement('afterend',status)}};section.append(confirm)}
      host.append(section)
    }
    if(!r.date||r.sourceDateConflict) {
      const label=make('label','需要您確認：完整上課日期'),date=make('input'); date.type='date';date.dataset.issueTarget='date';date.value=r.userConfirmedDate||r.date||'';label.append(date)
      const confirm=make('button','確認日期並重新核對此份紀錄');confirm.type='button';confirm.dataset.issueTarget='date-confirm'
      confirm.onclick=async()=>{if(!date.value||!date.checkValidity())return date.reportValidity();const live=currentRecord(item);live.userConfirmedDate=date.value;live.date=date.value;live.sourceDateConflict=false;if(await hooks.changed())hooks.recheck(item.key)};host.append(label,confirm)
    }
    if(item.candidates?.length>1) {
      const label=make('label','需要您確認：本份紀錄的目標課次'),select=make('select');select.dataset.issueTarget='occurrence';select.dataset.sourceRawOptions='true';select.add(new Option('請選擇合法課次，或先存歷史',''));for(const c of item.candidates)select.add(new Option(`${c.class_name} · ${c.occurrence_date} · ${c.start_time||'時段未提供'}`,c.id));select.value=r.historyOccurrenceId||'';label.append(select);host.append(label);select.onchange=()=>{const live=currentRecord(item);live.historyOccurrenceId=select.value;live.historyConflictConfirmed=false;live.historyConflictSignature='';hooks.changed()}
    }
    if(item.conflicts?.length) {
      host.append(make('h4','既有報告差異 · 未勾選的欄位保留 EduLog'))
      for(const f of item.conflicts) {
        const source=()=>hooks.diffValue?.(f,item.data[f])??semanticValue(f,item.data[f]),target=()=>hooks.diffValue?.(f,item.occurrence.report[f])??semanticValue(f,item.occurrence.report[f])
        const card=comparison(document,{label:hooks.labels[f]||f,source:item.data[f],target:item.occurrence.report[f],sourceDisplay:source,targetDisplay:target,text:['content','contact_notes','class_notes'].includes(f)})
        const label=make('label','處理方式'),choice=make('select');choice.dataset.issueTarget=`conflict:${f}`;choice.add(new Option('保留 EduLog','keep'));choice.add(new Option('採用來源','source'));choice.add(new Option('不同步此欄位','skip'));choice.value=r.syncFieldOverrides?.[f]===false?'skip':(r.historyOverwrite||[]).includes(f)?'source':'keep';label.append(choice);card.append(label);decisionResult(card,choice.value==='source'?source:target,choice.value);host.append(card)
        choice.onchange=()=>{const live=currentRecord(item),decision=choice.value;live.historyFieldDecisions||={};live.historyFieldDecisions[f]=decision;live.syncFieldOverrides||={};live.syncFieldOverrides[f]=decision!=='skip';live.historyOverwrite=(live.historyOverwrite||[]).filter(key=>key!==f);if(decision==='source')live.historyOverwrite.push(f);live.historyConflictConfirmed=false;live.historyConflictSignature='';decisionResult(card,decision==='source'?source:target,decision);hooks.changed()}
      }
      const confirm=make('button','已核對差異，依上述選擇列入摘要');confirm.type='button';confirm.dataset.issueTarget='conflict-confirm';confirm.onclick=async()=>{const live=currentRecord(item),latest=currentItem(item);live.historyConflictConfirmed=true;live.historyConflictSignature=latest.conflictSignature||conflictSignature(latest,live);confirm.disabled=true;let feedback=confirm.nextElementSibling;if(!feedback||!feedback.matches('[data-confirm-feedback]')){feedback=make('p');feedback.dataset.confirmFeedback='';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');confirm.insertAdjacentElement('afterend',feedback)}localized(feedback,'work.conflictSaving','已記錄選擇，正在計入摘要並保存草稿…');const saved=await hooks.changed();if(!confirm.isConnected)return;localized(feedback,saved?'work.conflictSaved':'work.conflictSaveFailed',saved?'已核對並保存草稿；可於同步摘要再次確認。':'保存失敗，選擇仍保留；請重試保存。');localized(confirm,saved?'work.conflictConfirmed':'work.conflictRetry',saved?'已核對並保存草稿':'重試保存核對結果');confirm.disabled=false;if(saved)confirm.dataset.confirmed='true'};host.append(confirm)
    }
    if(item.identityAmbiguous) {
      const confirm=make('button','已核對：這是同日另一份紀錄，保留兩筆歷史');confirm.type='button';confirm.dataset.issueTarget='identity';confirm.onclick=async()=>{currentRecord(item).historyDuplicateConfirmed=true;confirm.disabled=true;const saved=await hooks.changed();if(saved){confirm.textContent='已確認並保存草稿';confirm.disabled=true}else{confirm.disabled=false;confirm.textContent='保存失敗，重試確認'}};host.append(confirm)
    }
    const sourceKeys=[...new Set((r.sourceFields||[]).map(field=>field.key.startsWith('progress_')?'progress_letter':field.key).filter(key=>['lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link'].includes(key)))];if(r.sourceInternalNotes||r.sourceLearningStatus||r.sourceLearningStatusRaw)sourceKeys.push('class_notes');if(r.source_id)sourceKeys.push('external_link')
    if(sourceKeys.length){const sync=make('details'),head=make('summary','本報告同步欄位 · 可單獨略過'),body=make('div');sync.dataset.reviewKey=`sync-fields:${item.key}`;sync.append(head,body);for(const key of [...new Set(sourceKeys)]){const label=make('label'),check=make('input');check.type='checkbox';check.checked=r.syncFieldOverrides?.[key]??hooks.defaults?.()[key]!==false;label.className='check';label.append(check,make('span',`${hooks.fieldLabel?.(key)||key} · 同步此欄位`));body.append(label);check.onchange=()=>{const live=currentRecord(item);live.syncFieldOverrides||={};live.syncFieldOverrides[key]=check.checked;if(key==='class_notes'&&check.checked){const internal=document.getElementById('include-internal-notes');if(internal)internal.checked=true}hooks.changed()}}host.append(sync)}
    hooks.fields?.(host,item)
    const actions=make('div');actions.className='mapping-actions'
    const only=make('button','先存歷史，不變更課次報告');only.type='button';only.onclick=async()=>{currentRecord(item).historyOnly=true;only.disabled=true;const saved=await hooks.changed();only.disabled=!saved;only.textContent=saved?'已選擇先存歷史':'保存失敗，重試'}
    const retry=make('button','重新核對此份紀錄');retry.type='button';retry.onclick=()=>hooks.recheck(item.key)
    if(r.skipDecision?.status==='review'){const reminder=make('p');reminder.className='history-skip-reminder';reminder.setAttribute('role','status');reminder.setAttribute('aria-live','polite');const key=r.skipDecision.reason==='expired'?'work.skipExpired':r.skipDecision.reason==='context_changed'?'work.skipContextChanged':r.skipDecision.reason==='legacy'?'work.skipLegacy':'work.skipChanged';localized(reminder,key,'此報告先前已略過，現在需要重新確認。');host.append(reminder);if(r.skipDecision.changedFields?.length)host.append(make('p',`已知變動欄位：${r.skipDecision.changedFields.map(f=>hooks.fieldLabel?.(f)||f).join('、')}`))}
    const skip=make('button');skip.type='button';localized(skip,r.skipDecision?.status==='review'?'work.continueSkipping':r.sourceSkipped?'work.cancelSkipping':'work.skipReport',r.skipDecision?.status==='review'?'繼續略過':r.sourceSkipped?'取消略過':'略過此份紀錄');skip.onclick=async()=>{const live=currentRecord(item),active=!live.sourceSkipped;skip.disabled=true;let saved=false;try{saved=hooks.skip?await hooks.skip(item,active):(live.sourceSkipped=active,await hooks.changed())}catch{}skip.disabled=false;localized(skip,saved?(live.sourceSkipped?'work.skipSaved':'work.resumeReview'):'work.skipSaveFailed',saved?(live.sourceSkipped?'已確認略過':'恢復核對'):'保存失敗，重試')};actions.append(only,retry,skip);host.append(actions)
    for(const [index,control] of [...host.querySelectorAll('button,input,select,textarea,summary,a')].entries())control.dataset.focusKey||=`${item.key}:${control.dataset.issueTarget||control.dataset.reviewKey||control.name||control.closest('[data-review-field]')?.dataset.reviewField||index}:${control.tagName}`
  }
  function renderBatchReview() {
    const host=$('history-batch-review');if(!host)return
    const conflicts=items.filter(item=>item.conflicts?.length)
    if(!conflicts.length){host.hidden=true;if(host.dataset.signature){host.replaceChildren();host.dataset.signature=''}return}
    const signature=JSON.stringify(conflicts.map(item=>[item.key,item.conflicts,item.conflicts.map(field=>[item.data?.[field],item.occurrence?.report?.[field]])]))
    if(host.dataset.signature===signature){host.hidden=false;return}host.hidden=false;host.replaceChildren();host.dataset.signature=signature
    const details=make('details'),summary=make('summary',`批次核對差異 · ${new Set(conflicts.map(item=>item.key)).size} 份報告`);details.append(summary,make('p','按欄位查看來源與 EduLog 差異；決策只套用於本次工作，可再逐份調整。'))
    const fields=[...new Set(conflicts.flatMap(item=>item.conflicts))]
    for(const field of fields){const affected=conflicts.filter(item=>item.conflicts.includes(field)),section=make('section');section.className='history-batch-field';section.append(make('h4',`${hooks.fieldLabel?.(field)||field} · ${affected.length} 份`));
      for(const item of affected){const row=comparison(document,{label:`${item.target?.name||item.record.sourceStudentName||'學生未辨識'} · ${item.record.date||'日期待確認'}`,source:item.data[field],target:item.occurrence?.report?.[field],sourceDisplay:()=>hooks.diffValue?.(field,item.data[field])??semanticValue(field,item.data[field]),targetDisplay:()=>hooks.diffValue?.(field,item.occurrence?.report?.[field])??semanticValue(field,item.occurrence?.report?.[field]),text:['content','contact_notes','class_notes'].includes(field)});row.classList.add('history-batch-diff');section.append(row)}
      const label=make('label','本次工作決策'),choice=make('select');choice.add(new Option('選擇批次處理方式',''));choice.add(new Option('採用來源內容','source'));choice.add(new Option('保留 EduLog','keep'));choice.add(new Option('不同步此欄位','skip'));label.append(choice);const apply=make('button',`套用至 ${affected.length} 份報告`);apply.type='button';apply.disabled=true;const status=make('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');choice.onchange=()=>apply.disabled=!choice.value;apply.onclick=async()=>{const decision=choice.value;for(const item of affected){const r=currentRecord(item);r.historyFieldDecisions||={};r.historyFieldDecisions[field]=decision;r.historyOverwrite||=[];r.historyOverwrite=r.historyOverwrite.filter(key=>key!==field);if(decision==='source')r.historyOverwrite.push(field);r.syncFieldOverrides||={};r.syncFieldOverrides[field]=decision!=='skip';r.historyConflictConfirmed=false;r.historyConflictSignature='';if(item.conflicts.every(key=>r.historyFieldDecisions[key])){r.historyConflictConfirmed=true;r.historyConflictSignature=conflictSignature(item,r)}}apply.disabled=true;localized(status,'work.batchSaving',`正在保存套用至 ${affected.length} 份報告的本次決定…`,{count:affected.length});render(items);const saved=await hooks.changed();localized(status,saved?'work.batchSaved':'work.conflictSaveFailed',saved?`已套用並保存至 ${affected.length} 份報告；僅限本次工作。`:'保存失敗；選擇仍保留，請重試保存。',{count:affected.length});apply.disabled=false};section.append(label,apply,status);details.append(section)}
    host.append(details)
  }
  function renderSkipBatch(){let host=$('history-skip-batch');if(!host){host=make('section');host.id='history-skip-batch';host.className='history-skip-batch';host.setAttribute('aria-live','polite');$('history-workbench').insertAdjacentElement('beforebegin',host)}const selectedItems=items.filter(item=>skipSelection.has(item.key)&&item.record.skipDecision?.status==='review');if(!selectedItems.length){host.hidden=true;host.replaceChildren();return}host.hidden=false;host.replaceChildren();const text=make('p',globalThis.edulogUi?.t('work.skipBatchSelected',{count:selectedItems.length})||`已選取 ${selectedItems.length} 份先前略過報告。`),action=make('button',globalThis.edulogUi?.t('work.skipBatchConfirm')||'繼續略過所選報告');action.type='button';action.dataset.action='confirm-skipped-batch';action.onclick=async()=>{action.disabled=true;action.setAttribute('aria-busy','true');const saved=hooks.skipMany?await hooks.skipMany(selectedItems):false;if(saved){for(const item of selectedItems)skipSelection.delete(item.key);render(items)}else{action.disabled=false;action.removeAttribute('aria-busy');let status=host.querySelector('[role=status]');if(!status){status=make('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');host.append(status)}localized(status,'work.skipBatchFailed','保存失敗，所選項目仍保留；請重試。')}};host.append(text,action)}
  function render(next) {
    const work=hooks.work(),restored=owner!==work?work?.historyUI:null;if(owner!==work){buttons.clear();skipChecks.clear();skipSelection.clear();studentGroups.clear();enrollmentGroups.clear();reviewedIssues.clear();$('history-items').replaceChildren();owner=work;editorKey='';selected=work?.historyUI?.selected||'';for(const [id,key] of [['history-search','search'],['history-filter','filter'],['history-reason','reason']])if($(id))$(id).value=work?.historyUI?.[key]??(key==='filter'?'needs':key==='reason'?'all':'')}
    items=next;for(const category of ['unfilled','other-admission','system-excluded'])if(!$('history-filter').querySelector(`option[value="${category}"]`))$('history-filter').add(new Option(stateLabel(category),category));renderBatchReview();const query=$('history-search').value.trim().toLowerCase(),filter=$('history-filter').value,reasonFilter=$('history-reason')?.value||'all'
    const autoCategories=new Set(['unfilled','other-admission','system-excluded']),keys=new Set(items.map(i=>i.key));for(const [key,button] of buttons)if(!items.some(i=>i.key===key)){button.closest('.history-report-entry')?.remove();buttons.delete(key);skipChecks.delete(key);skipSelection.delete(key)}
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
       if(!b){const entry=make('div');entry.className='history-report-entry';const toggle=make('label');toggle.className='history-skip-toggle';const check=make('input');check.type='checkbox';check.className='history-skip-select';check.setAttribute('aria-label',globalThis.edulogUi?.t('work.skipBatchSelect')||'選取先前略過報告以批次確認');check.onchange=()=>{if(check.checked)skipSelection.add(item.key);else skipSelection.delete(item.key);renderSkipBatch()};toggle.append(check);entry.append(toggle);b=make('button');b.type='button';b.className='mapping-list-item';b.onclick=()=>{const current=items.find(i=>i.key===b.dataset.key);if(!current)return;selected=current.key;editorKey='';render(items);$('history-workbench').dataset.mobileView='editor';hooks.uiChanged?.()};b.dataset.key=item.key;entry.append(b);buttons.set(item.key,b);skipChecks.set(item.key,check)}
      const entry=b.closest('.history-report-entry');if(entry?.parentElement!==enrollment.lastElementChild)enrollment.lastElementChild.append(entry)
      const text=`${name} ${course} ${r.date||r.dateRaw||''} ${admission}`
      const matchesReason=reasonFilter==='all'||(item.issues||[]).some(issue=>{const target=issue.target||'';return reasonFilter==='identity'?['enrollment','identity'].includes(target):target.startsWith(reasonFilter)})
      b.hidden=item.key!==selected&&((filter!=='all'&&filter!==item.category)||(!autoCategories.has(item.category)&&!matchesReason)||!text.toLowerCase().includes(query));if(entry)entry.hidden=b.hidden;if(!b.hidden)visible++
      b.replaceChildren(make('strong',r.date||r.dateRaw||'日期待確認'),make('span',stateLabel(item.category)));if(item.category==='needs')b.append(make('span',`${item.issues?.length||1} 項需處理`));b.setAttribute('aria-current',String(item.key===selected));if(!b.hidden){visibleStudents.add(studentKey);visibleEnrollments.add(enrollmentKey)}
       const check=skipChecks.get(item.key);if(check){const selectable=item.record.skipDecision?.status==='review';check.hidden=!selectable||b.hidden;check.disabled=!selectable;check.checked=skipSelection.has(item.key);check.title=selectable?(globalThis.edulogUi?.t('work.skipBatchSelect')||'Select previously skipped report for batch confirmation'):'';if(!selectable)skipSelection.delete(item.key);if(entry){entry.hidden=b.hidden;entry.dataset.selectable=String(selectable&&!b.hidden);const toggle=check.closest('.history-skip-toggle');if(toggle)toggle.hidden=check.hidden}}
      if(item.key===selected&&editorKey!==selected)open(item)
    }
    for(const [key,group] of studentGroups)if(!currentStudents.has(key)){group.remove();studentGroups.delete(key)}
    for(const [key,group] of enrollmentGroups)if(!currentEnrollments.has(key)){group.remove();enrollmentGroups.delete(key)}
    for(const [key,group] of enrollmentGroups){const heading=group.querySelector('h5');if(heading)heading.textContent=`${heading.textContent.replace(/ · \d+ 份歷史$/,'')} · ${reportCounts.get(key)||0} 份歷史`}
    for(const [key,group] of studentGroups){const count=group.querySelector('.history-student-count');if(count)count.textContent=`${group.querySelectorAll('.history-enrollment-group').length} 筆報名`}
    for(const [key,group] of studentGroups)group.hidden=!visibleStudents.has(key)
    for(const [key,group] of enrollmentGroups)group.hidden=!visibleEnrollments.has(key)
    $('history-empty').hidden=visible>0
    renderSkipBatch()
    $('history-sync-summary').textContent=Object.entries(stateLabels).map(([k,v])=>`${stateLabel(k)} ${items.filter(i=>i.category===k).length}`).join(' · ')
    const exclusions=ensureAutoExclusions(),exclusionCounts=Object.fromEntries(['unfilled','other-admission','system-excluded'].map(category=>[category,items.filter(item=>item.category===category).length])),exclusionTotal=Object.values(exclusionCounts).reduce((a,b)=>a+b,0),summary=$('history-auto-exclusions-summary'),count=$('history-auto-exclusions-count')
    if(summary)localized(summary,'work.historyAutoExcluded','未列入同步的來源列 · {count} 份',{count:exclusionTotal})
    if(count){count.replaceChildren();for(const category of ['unfilled','other-admission','system-excluded']){const button=make('button');button.type='button';button.className='history-exclusion-filter';localized(button,'work.historyExclusionFilter','{label}：{count} 份',{label:stateLabel(category),count:exclusionCounts[category]});button.disabled=!exclusionCounts[category];button.onclick=()=>{$('history-filter').value=category;selected='';render(items);$('history-search').focus({preventScroll:true})};count.append(button)}if(!exclusionTotal)count.textContent=globalThis.edulogUi?.t('work.historyNoAutoExcluded')||'沒有尚未填寫、其他報名或系統排除項目。'}
    const priorChanged=items.filter(i=>i.record.skipDecision?.status==='review'&&['content_changed','context_changed','legacy'].includes(i.record.skipDecision.reason)).length,priorExpired=items.filter(i=>i.record.skipDecision?.status==='review'&&i.record.skipDecision.reason==='expired').length,priorStable=items.filter(i=>['skip','local-skip'].includes(i.record.skipDecision?.status)).length
    if(priorChanged+priorExpired+priorStable)$('history-sync-summary').textContent+=` · ${globalThis.edulogUi?.t('work.skipSummary',{changed:priorChanged,expired:priorExpired,stable:priorStable})||`先前略過：內容變動 ${priorChanged} 份、期限已到 ${priorExpired} 份、維持略過 ${priorStable} 份`}`
    const pending=items.filter(item=>item.category==='needs'),issueCount=pending.reduce((count,item)=>count+(item.issues?.length||1),0),ready=items.filter(item=>item.category==='bind'||item.category==='history').length
    $('history-action-count').textContent=`待處理報告 ${pending.length} 份 · 問題 ${issueCount} 項 · 可同步 ${ready} 份`
    if(globalThis.edulogUi){globalThis.edulogUi.text($('history-action-count'),'work.actionSummary',{reports:pending.length,issues:issueCount,ready});globalThis.edulogUi.text($('review-action-summary'),'work.actionSummary',{reports:pending.length,issues:issueCount,ready})}
    $('history-next-issue').disabled=issueCount===0;$('history-next-report').disabled=pending.length===0
    if(restored){const list=listPane(),editor=$('history-editor');list.scrollTop=boundedScroll(list,restored.listScroll);editor.scrollTop=boundedScroll(editor,restored.editorScroll)}
    if(work)work.historyUI={selected,search:$('history-search').value,filter:$('history-filter').value,reason:reasonFilter,listScroll:listPane().scrollTop,editorScroll:$('history-editor').scrollTop}
  }
  for(const id of ['history-search','history-filter','history-reason'])$(id)?.addEventListener(id.endsWith('search')?'input':'change',()=>{selected='';render(items);hooks.uiChanged?.()})
  $('history-back').onclick=()=>{$('history-workbench').dataset.mobileView='list';buttons.get(selected)?.focus({preventScroll:true})}
  $('history-next-issue').onclick=selectNextIssue;$('history-next-report').onclick=selectNextReport
  for(const [pane,key] of [[listPane(),'listScroll'],[$('history-editor'),'editorScroll']])pane.addEventListener('scroll',()=>{if(owner?.historyUI)owner.historyUI[key]=pane.scrollTop})
  function capture(){const pane=$('history-editor');return {position:pane.scrollTop,page:window.scrollY,key:document.activeElement?.dataset.focusKey,expanded:new Set([...pane.querySelectorAll('details[open]')].map(d=>d.dataset.reviewKey).filter(Boolean))}}
  return {render,capture,selectedKey:()=>selected,setSkip:fn=>{hooks.skip=fn},setSkipMany:fn=>{hooks.skipMany=fn},updateStatus:(next=items)=>{render(next);const item=items.find(i=>i.key===selected),host=$('history-detail');if(!item||editorKey!==selected)return;const state=host.querySelector('[data-history-state]'),reason=host.querySelector('[data-history-reason]');if(state)state.textContent=`${item.target?.courseName||item.record.sourceCourseLabel||'課程待確認'} · ${stateLabel(item.category)}`;if(reason)reason.textContent=item.reason;renderIssues(host.querySelector('[data-history-issues]'),item)},refreshEditor:(next=items,saved=capture())=>{const pane=$('history-editor');editorKey='';render(next);for(const detail of pane.querySelectorAll('details'))if(detail.dataset.reviewKey&&saved.expanded.has(detail.dataset.reviewKey))detail.open=true;pane.scrollTop=boundedScroll(pane,saved.position);const pageMax=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);window.scrollTo(0,Math.min(Math.max(0,Number(saved.page)||0),pageMax));if(saved.key)[...pane.querySelectorAll('[data-focus-key]')].find(c=>c.dataset.focusKey===saved.key)?.focus({preventScroll:true})},items:()=>items}
}
