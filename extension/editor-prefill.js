// A focused EduLog report preview inside the verified native source editor.
// The shadow root keeps its controls and styles separate from the provider DOM.
(() => {
  if (!globalThis.edulogRuntime || !globalThis.edulogSourceIntegration || !document?.documentElement) return
  const adapter = globalThis.edulogSourceIntegration
  let host = null, root = null, form = null, target = null, report = null, generation = 0, observer
  let nativeForm, layout, anchor, modal, settingsUrl, capabilities = {}, saving = false, suspended = false, containers = []
  const groups = new Map(), drafts = new Map()
  function formContext(){if(!modal)return;const header=modal.querySelector('.modal-header');if(!header)return;let context=header.querySelector('.edulog-prefill-context');if(!context){context=make('p',undefined,'edulog-prefill-context');context.dataset.edulogOwned='';context.setAttribute('aria-live','polite');header.append(context)}context.textContent=`原站目標：${target?.studentName||form?.title||'學生待確認'} · ${form?.date||'日期待確認'} · ${target?.courseName||'課程待確認'}${report?` ｜ EduLog ${report.occurrence_date}${report.occurrence_date!==form?.date||report.enrollment_id!==target?.enrollmentId?'（範本）':''}`:''}`}
  function preserveView(){const focused=root?.activeElement;return{action:form?.action,scroll:host?.scrollTop||0,nativeScroll:nativeForm?.parentElement?.scrollTop||0,windowY:window.scrollY,control:focused?.dataset.key?`[data-key="${CSS.escape(focused.dataset.key)}"]`:focused?.name?`[name="${CSS.escape(focused.name)}"]`:null,start:focused?.selectionStart,end:focused?.selectionEnd,questions:root?.querySelector('.questions')?.open,dateEdit:root?.querySelector('.date-edit')?.open,identityOpen:root?.querySelector('.identity-question')?.open,dateDraft:root?.querySelector('[name=confirmed-source-date]')?.value,identitySearch:root?.querySelector('[name=target-student-search]')?.value}}
  function restoreView(state){if(!host||state.action!==form?.action)return;if(state.questions&&state.control)root.querySelector('.questions').open=true;const dateEdit=root.querySelector('.date-edit');if(dateEdit&&state.dateEdit)dateEdit.open=true;const identity=root.querySelector('.identity-question');if(identity&&state.identityOpen)identity.open=true;for(const [name,value] of [['confirmed-source-date',state.dateDraft],['target-student-search',state.identitySearch]]){const input=root.querySelector(`[name=${name}]`);if(input&&value!==undefined)input.value=value}const control=state.control&&root.querySelector(state.control);control?.focus({preventScroll:true});if(control&&state.start!=null&&(control.tagName==='TEXTAREA'||['text','search'].includes(control.type))){try{control.setSelectionRange(state.start,state.end)}catch{/* Date fields do not expose text selection. */}}host.scrollTop=state.scroll;if(nativeForm?.parentElement)nativeForm.parentElement.scrollTop=state.nativeScroll;window.scrollTo({top:state.windowY,behavior:'instant'})}
  const make = (tag, text, className) => { const item=document.createElement(tag); if(text!==undefined)item.textContent=text; if(className)item.className=className; return item }
  const safeText = value => {
    if (typeof value !== 'string') return ''
    if (!/<\/?[a-z][^>]*>/i.test(value)) return value
    const parsed = new DOMParser().parseFromString(value, 'text/html')
    parsed.querySelectorAll('script,style,svg,iframe,object').forEach(item=>item.remove())
    parsed.querySelectorAll('br').forEach(item=>item.replaceWith('\n'))
    parsed.querySelectorAll('p,div,li').forEach(item=>item.append('\n'))
    return parsed.body.textContent.replace(/\n{3,}/g,'\n\n').trim()
  }
  async function request(operation, details = {}) {
    const response = await globalThis.edulogRuntime.send({ type:'integration-inline-prefill', operation, formId:form?.formId, fingerprint:form?.fingerprint, ...details })
    if (response?.error) { const error = new Error(response.error.message || 'EduLog 預填功能暫時無法使用。'); Object.assign(error,response.error); throw error }
    return response?.data
  }
  function status(message, error = false) {
    const node=root?.querySelector('[role=status]')
    if(node){node.textContent=message;node.dataset.error=String(error)}
    const local=root?.querySelector('.apply-feedback');if(local){local.textContent=message;local.dataset.error=String(error)}
  }
  function setup() {
    if (host?.isConnected) return
    nativeForm=adapter.getForm(document)
    if (!nativeForm) return
    form=null; target=null; report=null
    host=document.createElement('aside'); host.className='edulog-editor-assistant';host.dataset.edulogOwned=''; host.setAttribute('aria-label','EduLog 報告預覽與預填');
    root=host.attachShadow({mode:'open'})
    root.innerHTML=`<style>
      :host{all:initial;color:#172033;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;display:block;min-width:0;overflow-wrap:anywhere}
      [hidden]{display:none!important}
      *{box-sizing:border-box}section{border:1px solid #cbd5e1;border-left:4px solid #2449bb;border-radius:10px;background:#f8fafc;padding:14px;min-width:0}
      header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}h2{font-size:16px;margin:0}p{margin:7px 0;color:#475569;overflow-wrap:anywhere}
      button,input,select{font:inherit}button{min-height:44px;padding:8px 12px;border:1px solid #b9c6db;border-radius:7px;background:white;color:#172033;cursor:pointer;touch-action:manipulation}
      button.primary{background:#2449bb;border-color:#2449bb;color:white}button:hover{filter:brightness(.96)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
      input,select,textarea{font:inherit;width:100%;min-width:0;min-height:44px;padding:8px 10px;border:1px solid #aab8cc;border-radius:7px;background:white;color:#172033}textarea{min-height:110px;resize:vertical;line-height:1.6}
      label{display:block;font-weight:600;margin:10px 0 4px}small{display:block;color:#475569;font-size:14px;overflow-wrap:anywhere;white-space:pre-wrap}
      [role=status]{padding:9px 10px;background:#eef4ff;border-radius:6px;min-height:38px}[role=status][data-error=true]{background:#fff1f2;color:#9f1239}
      .list{display:grid;gap:8px;margin-top:8px}.choice{text-align:left;display:grid;gap:2px;width:100%}.choice[aria-pressed=true]{border-color:#2449bb;background:#eef4ff}
      .report{display:grid;gap:4px;padding:10px;background:white;border:1px solid #dbe3ee;border-radius:7px;margin:10px 0;overflow-wrap:anywhere}
      .field{padding:10px 0;border-top:1px solid #dbe3ee}.check{display:flex;align-items:center;gap:9px;min-height:44px;margin:0}.check input{width:18px;height:18px;flex:none}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.actions button{flex:1 1 160px}.apply-feedback{font-size:14px;padding:10px;background:#eff6ff;border-radius:6px}.apply-feedback[data-error=true]{color:#9f1239;background:#fff1f2}
      details{margin-top:10px}summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600}.muted{font-size:14px}.question{padding:12px;background:#fffbeb;border-left:3px solid #b45309}.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.comparison small{padding:8px;background:white}.field-group{border:0;padding:0;margin:0}.field-group legend{font-weight:700;padding:12px 0}a{color:#1e40af;min-height:44px;display:inline-block;padding:8px 0;overflow-wrap:anywhere}.help{font-size:14px;color:#92400e}
      @media(max-width:480px){.comparison{grid-template-columns:1fr}}
      @media(max-width:560px){section{padding:11px}header{align-items:flex-start}.actions button{flex:1 1 100%}}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
    </style><section><header><div><h2>EduLog 報告預覽</h2><p class="target">正在查詢已記住的學生與日期…</p></div><button class="refresh" type="button">重新核對</button></header><p role="status" aria-live="polite" aria-atomic="true">正在驗證擴充套件連線…</p><div class="result"></div><div class="actions"><button class="connect" type="button" hidden>開啟 EduLog 連線設定</button></div></section>`
    const section=root.querySelector('section'),header=root.querySelector('header')
    header.querySelector('h2').textContent='EduLog 報告助手'
    const collapse=make('button','收合助手');collapse.type='button';header.append(collapse)
    const body=make('div');body.className='assistant-body';while(header.nextSibling)body.append(header.nextSibling);section.append(body)
    const questions=make('details');questions.className='questions';questions.append(make('summary','1 · 補足目標資訊'),make('div',undefined,'question-body'));body.querySelector('.result').before(questions)
    const candidates=make('details');candidates.className='candidates';candidates.open=true;candidates.append(make('summary','2 · 選擇 EduLog 報告'));body.querySelector('.result').before(candidates);candidates.append(body.querySelector('.result'))
    const review=make('details');review.className='review';review.hidden=true;review.append(make('summary','3 · 核對與套用欄位'),make('div',undefined,'fields-result'));candidates.after(review)
    anchor=document.createComment('EduLog native form position');nativeForm.before(anchor);layout=make('div',undefined,'edulog-editor-layout');layout.dataset.view='assistant';layout.dataset.collapsed='false'
    const modalBody=nativeForm.closest('.modal-body');containers=[]
    if(modalBody)for(let parent=anchor.parentElement;parent&&parent!==modalBody;parent=parent.parentElement){containers.push({node:parent,value:parent.getAttribute('data-edulog-prefill-container')});parent.setAttribute('data-edulog-prefill-container','')}
    const tabs=make('div',undefined,'edulog-editor-tabs');tabs.setAttribute('aria-label','報告編輯區')
    for(const [view,title] of [['assistant','EduLog 預填'],['native','原站表單']]){const b=make('button',title);b.type='button';b.dataset.view=view;b.addEventListener('click',()=>setView(view));tabs.append(b)}
    const nativePane=make('div',undefined,'edulog-editor-native');nativePane.append(nativeForm);layout.append(tabs,nativePane,host);anchor.after(layout);modal=nativeForm.closest('.modal');modal?.setAttribute('data-edulog-prefill','');setView('assistant')
    collapse.addEventListener('click',()=>{const closed=layout.dataset.collapsed!=='true';layout.dataset.collapsed=String(closed);body.hidden=closed;modal?.toggleAttribute('data-edulog-prefill',!closed);collapse.textContent=closed?'展開 EduLog 助手':'收合助手'})
    root.querySelector('.refresh').addEventListener('click',()=>void lookup())
    root.querySelector('.connect').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{await globalThis.edulogRuntime.send({type:'open-integration-workspace',flow:'prefill'})}catch(error){status(error.message||'無法開啟整合工作台。',true)}finally{if(button.isConnected)button.disabled=false}})
    void lookup()
  }
  function reportLabel(item){return `${item.student_name || '學生'} · ${item.occurrence_date || '日期待確認'} · ${item.course_name || '課程'} · ${item.completeness?.isMissing?'報告未齊備':'報告已齊備'}`}
  function setView(view){if(!layout)return;layout.dataset.view=view;layout.querySelectorAll('button[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)))}
  function action(label,fn,cls){const b=make('button',label,cls);b.type='button';b.addEventListener('click',fn);return b}
  function verifiedLink(parent,label,url){try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return;const a=make('a',`${label} ↗`);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a)}catch{/* Missing URLs remain unavailable. */}}
  function frontend(path){try{const u=new URL(settingsUrl),suffix='/dashboard/settings';if(!u.pathname.endsWith(suffix)||!['http:','https:'].includes(u.protocol))return null;u.pathname=u.pathname.slice(0,-suffix.length)+path;u.search='';u.hash='';return u.href}catch{return null}}
  function questionUI(){
    const box=root.querySelector('.question-body'),stage=root.querySelector('.questions');box.replaceChildren();stage.open=!form.date||!target
    stage.querySelector('summary').textContent=form.date&&target?`1 · 目標已核對 · ${form.date}`:'1 · 補足目標資訊'
    const summary=make('div',undefined,'report');summary.append(make('strong',`原站報名 #${form.admissionId} · ${form.date||'日期待確認'}`),make('small',target?`${target.studentName||'學生'} · ${target.courseName||'課程'} · ${target.className||'班級'}`:'尚無有效 EduLog 報名對應，可先查看報告範本。'))
    if(form.dateInfo?.raw?.length){const raw=make('details');raw.append(make('summary','查看原站日期資料'),make('p',form.dateInfo.raw.join(' ／ ')));summary.append(raw)}
    if(form.supplement)summary.append(make('small','補充資訊：使用者確認（本次報告使用，不建立永久身份對應）'))
    verifiedLink(summary,'查看原站報告',form.sourceReportUrl);box.append(summary)
    const q=make('div',undefined,'question');q.append(make('strong',form.date?'修改上課日期':'需要您確認：完整上課日期'),make('p',form.dateInfo?.reason||'日期影響精確配對與套用前核對；不會修改原站。','muted'))
    const input=make('input');input.type='date';input.name='confirmed-source-date';input.autocomplete='off';input.value=form.date||'';const label=make('label','這份原站報告的完整上課日期');label.append(input);q.append(label)
    let conflict
    if(form.dateInfo?.conflict){conflict=make('input');conflict.type='checkbox';const l=make('label',undefined,'check');l.append(conflict,make('span','我已核對矛盾的來源日期，確認使用此日期'));q.append(l)}
    const b=action('確認上課日期',()=>{if(!input.value){status('請選擇完整上課日期。',true);input.focus();return}void supplement({date:input.value,conflictAcknowledged:conflict?.checked===true},b)},'primary');q.append(b,action('稍後處理',()=>{stage.open=false;status('可繼續查看候選，套用前仍需確認完整日期。')}));if(form.date){const edit=make('details',undefined,'date-edit');edit.append(make('summary','修改已確認的上課日期'),q);box.append(edit)}else box.append(q)
    const identities=make('details',undefined,'identity-question');identities.open=Boolean(form.date&&!target);identities.append(make('summary',target?'修改當次學生／報名':'需要您確認：當次學生／報名'))
    const student=make('input');student.type='search';student.name='target-student-search';student.autocomplete='off';student.maxLength=80;const lab=make('label','搜尋既有 EduLog 學生');lab.append(student);identities.append(lab)
    const feedback=make('p','姓名不自動合併；選擇只用於本次報告。','muted');feedback.setAttribute('aria-live','polite');const results=make('div',undefined,'list');let serial=0,timer
    const search=async cursor=>{const id=++serial,scope=generation;feedback.textContent='正在查詢學生…';try{const data=await request('identity-search',{query:{resource:'students',search:student.value.trim(),cursor}});if(id!==serial||scope!==generation||!identities.isConnected)return;if(!cursor)results.replaceChildren();for(const item of data.items||[])results.append(action(`${item.name} · #${item.id.slice(0,8)}`,()=>void enrollments(item)));feedback.textContent=`本頁找到 ${data.items?.length||0} 位學生。`;if(data.next_cursor)results.append(action('載入更多學生',()=>void search(data.next_cursor)))}catch(e){if(id===serial)feedback.textContent=e.message}}
    const enrollments=async (s,cursor)=>{const id=++serial,scope=generation;feedback.textContent=`正在讀取 ${s.name} 的報名…`;try{const data=await request('identity-search',{query:{resource:'enrollments',student_id:s.id,cursor}});if(id!==serial||scope!==generation||!identities.isConnected)return;if(!cursor)results.replaceChildren();for(const item of data.items||[]){const b=action(`${s.name} · ${item.course_name||'課程'} · ${item.class_session?.name||'班級'} · #${item.id.slice(0,8)}`,()=>void supplement({enrollmentId:item.id},b),'primary');results.append(b)}feedback.textContent=data.items?.length?'選擇與原站表單對應的報名（本次確認）。':'沒有可讀取的報名；可搜尋其他學生或使用範本。';if(data.next_cursor)results.append(action('載入更多報名',()=>void enrollments(s,data.next_cursor)))}catch(e){if(id===serial)feedback.textContent=e.message}}
    student.addEventListener('input',()=>{serial++;clearTimeout(timer);timer=setTimeout(()=>void search(),300)});identities.append(action('查詢學生',()=>void search()),feedback,results);box.append(identities)
    box.append(action('開啟工作台確認並記住對應',()=>void edulogRuntime.send({type:'open-integration-workspace',flow:'import'}).catch(e=>status(e.message,true))))
  }
  async function supplement(input,b){if(saving||b.disabled)return;const scope=generation;saving=true;b.disabled=true;status('正在保存當次確認資訊…');try{const data=await request('supplement',{input});if(scope!==generation||!host?.isConnected)return;form=data.form;saving=false;await lookup()}catch(e){if(scope===generation)status(e.message,true)}finally{saving=false;if(b.isConnected)b.disabled=false}}
  function addGroup(parent,key,title,items,open){const details=make('details');details.open=open;const note=make('p',items.length?`找到 ${items.length} 份。`:key==='exact'?'當天沒有相符報告。':'展開後載入候選。','muted');note.setAttribute('aria-live','polite');const list=make('div',undefined,'list'),more=action('載入更多',()=>void loadGroup(key,true));more.hidden=true;details.append(make('summary',title),note,list,more);parent.append(details);groups.set(key,{details,list,note,more,items,cursor:null,busy:false,loaded:key==='exact'});paintGroup(key);details.addEventListener('toggle',()=>{const g=groups.get(key);if(g&&details.open&&!g.loaded&&capabilities.nearest_report_candidates)void loadGroup(key)})}
  function paintGroup(key){const g=groups.get(key);if(!g)return;g.list.replaceChildren();for(const item of g.items){if(key==='same-course'&&item.enrollment_id===target?.enrollmentId&&form.date&&item.occurrence_date===form.date)continue;const b=action('',()=>void selectReport(item),'choice');b.setAttribute('aria-pressed',String(report?.id===item.id));b.append(make('span',reportLabel(item)),make('small',`${item.class_name||'班級未提供'} · ${item.lesson_name||'教材未提供'} · 報名 #${String(item.enrollment_id||'').slice(0,8)}`));if(Number.isFinite(item.date_difference))b.append(make('small',item.date_difference===0?'目標日當天':`目標日${item.date_difference<0?'前':'後'} ${Math.abs(item.date_difference)} 天`));g.list.append(b)}g.more.hidden=!g.cursor}
  async function loadGroup(key,more=false){const g=groups.get(key);if(!g||g.busy)return;g.busy=true;g.more.disabled=true;const scope=generation;g.note.textContent='正在查詢候選…';try{const data=await request('candidates',{query:{group:key,cursor:more?g.cursor:undefined}});if(scope!==generation||groups.get(key)!==g)return;g.items=[...new Map([...(more?g.items:[]),...(data.reports||[])].map(r=>[r.id,r])).values()];g.cursor=data.next_cursor;g.loaded=true;g.more.textContent='載入更多';paintGroup(key);const count=g.list.children.length;g.note.textContent=count?`已載入 ${count} 份${g.cursor?'，還有更多':''}。`:g.cursor?'這一頁沒有其他候選；可載入下一頁。':'目前沒有其他可讀取的報告。'}catch(e){if(scope===generation){g.note.textContent=e.message;g.loaded=false;g.more.hidden=false;g.more.textContent='重試'}}finally{g.busy=false;if(scope!==generation&&groups.get(key)===g){g.note.textContent='查詢已因選擇變更而停止，請重新載入候選。';g.loaded=false;g.more.hidden=false;g.more.textContent='重試'}if(g.more.isConnected)g.more.disabled=false}}
  function renderList(items,cursor=null) {
    const box=root.querySelector('.result');box.replaceChildren();groups.clear()
    if(target) box.append(make('p',`目標：${target.studentName || `學生 ${target.studentId?.slice(0,8)||'待確認'}`} · ${target.className || '班級名稱未提供'} · ${target.courseName || '課程名稱未提供'} · 報名 ${target.enrollmentId.slice(0,8)} · ${form.date || '日期待確認'}`,'muted'))
    box.append(make('p',form.date?`依距離目標日 ${form.date} 排序；不同日期或報名的內容只作範本。`:'日期尚未確認：暫以原站時區（台北）的今天排序。補足日期後不會自動改選報告。','muted'))
    addGroup(box,'exact','當天相符',items,true)
    groups.get('exact').cursor=cursor;paintGroup('exact')
    if(target){addGroup(box,'same-course','同學生、同課程的其他報告',[],!items.length);addGroup(box,'other-course','同學生、其他課程',[],false);if(!items.length&&capabilities.nearest_report_candidates)void loadGroup('same-course')}
    if(target&&!capabilities.nearest_report_candidates)box.append(make('p','請將伺服器升級至 1000123，才能使用依目標日排序的新版候選。','help'))
    renderSearch(box)
  }
  function renderSearch(parent) {
    const details=make('details'),summary=make('summary','搜尋其他學生或日期的報告');details.append(summary)
    const label=make('label','學生、課程或日期關鍵字'),input=make('input');input.type='search';input.maxLength=80;input.autocomplete='off';label.append(input);details.append(label)
    const dates=make('div');dates.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px'
    const fromWrap=make('label','開始日期'),from=make('input');from.type='date';fromWrap.append(from)
    const toWrap=make('label','結束日期'),to=make('input');to.type='date';toWrap.append(to);dates.append(fromWrap,toWrap);details.append(dates)
    const button=make('button','搜尋可讀取報告');button.type='button';details.append(button)
    const feedback=make('p','','muted'),list=make('div',undefined,'list'),more=make('button','載入更多');more.type='button';more.hidden=true;feedback.setAttribute('aria-live','polite');details.append(feedback,list,more)
    let serial=0,cursor,timer
    const run=async next=>{const id=++serial,scope=generation;button.disabled=true;more.disabled=true;feedback.textContent='正在搜尋可讀取報告…';try{const data=await request('search',{query:{search:input.value.trim(),date_from:from.value||undefined,date_to:to.value||undefined,cursor:next?cursor:undefined}});if(id!==serial||scope!==generation||!details.isConnected)return;if(!next)list.replaceChildren();for(const item of data.reports||[])list.append(action(reportLabel(item),()=>void selectReport(item),'choice'));cursor=data.next_cursor;more.hidden=!cursor;feedback.textContent=`本頁找到 ${data.reports?.length||0} 份。其他學生或日期的報告只作範本。`}catch(e){if(id===serial)feedback.textContent=e.message}finally{if(button.isConnected){button.disabled=false;more.disabled=false}}}
    input.addEventListener('input',()=>{serial++;clearTimeout(timer);timer=setTimeout(()=>void run(false),300)});button.addEventListener('click',()=>void run(false));more.addEventListener('click',()=>void run(true));parent.append(details)
  }
  function suggestion(field, selected) {
    const value=selected[field.key]
    if(field.type==='text')return typeof value==='string'?safeText(value):''
    if(field.key==='attendance_status'){
      const label=value==='present'?'出席':value==='absent'?'不出席':value==='pending'?'待確認':''
      return field.options.find(option=>option.label.trim()===label)?.value||''
    }
    if(['class_participation','classroom_behavior'].includes(field.key)&&Number.isFinite(value))return field.options.find(option=>Number(option.value)===value*2)?.value||''
    if(field.key==='is_completed'){
      if(typeof value!=='boolean')return ''
      const pattern=value?/^(?:完整完成|已完成|完成|已結課|是|yes|completed)$/i:/^(?:未完成|尚未完成|未結課|否|no|incomplete)$/i
      return field.options.find(option=>pattern.test(option.label.trim()))?.value||''
    }
    if(field.key==='lesson_id'&&selected.lesson_name){const matches=field.options.filter(o=>o.label.trim()===selected.lesson_name.trim());return matches.length===1?matches[0].value:''}
    if(['progress_start','progress_end'].includes(field.key)&&typeof selected.progress_letter==='string'){const parts=selected.progress_letter.split('-'),label=field.key==='progress_start'?parts[0]:parts.at(-1);return field.options.find(o=>o.label.trim()===label)?.value||''}
    return ''
  }
  async function selectReport(item) {
    if(saving)return
    const serial=++generation;status('正在讀取所選報告內容…')
    try{
      const full=await request('detail',{reportId:item.id})
      if(serial!==generation||!host?.isConnected)return
      if(!full)throw new Error('所選報告已無法讀取，請重新搜尋。')
      report=full;formContext();renderFields(full);for(const key of groups.keys())paintGroup(key)
    }catch(error){if(serial===generation){if(/連接並驗證|請先連接/.test(error.message))root.querySelector('.connect').hidden=false;status(error.message,true)}}
  }
  function renderFields(selected) {
    const box=root.querySelector('.fields-result');box.replaceChildren();root.querySelector('.review').hidden=false;root.querySelector('.review').open=true;root.querySelector('.candidates').open=false
    root.querySelector('.candidates summary').textContent=`2 · 已選擇報告 · ${selected.occurrence_date||'日期待確認'}`
    const mismatch=!target||!form.date||Boolean(target.enrollmentId&&selected.enrollment_id!==target.enrollmentId)||(selected.student_id&&target.studentId&&selected.student_id!==target.studentId)||(form.date&&selected.occurrence_date!==form.date)
    const identity=make('div',undefined,'report');identity.append(make('strong',reportLabel(selected)))
    identity.append(make('p',mismatch?'範本的學生或日期與原站表單不同。套用前需勾選確認；只會複製欄位，不改變身份對應。':'學生與日期符合目前表單。'))
    if(selected.updated_at)identity.append(make('small',`EduLog 更新時間：${new Date(selected.updated_at).toLocaleString()}`))
    const reportUrl=frontend(`/dashboard/reports/${selected.enrollment_id}`)
    if(reportUrl)verifiedLink(identity,'查看 EduLog 報名與報告',reportUrl);else identity.append(make('small','尚無可靠前端網址；請重新檢查連線。'))
    if(selected.external_link)verifiedLink(identity,'查看原站報告連結',selected.external_link)
    box.append(identity)
    if(target)box.append(make('p',`目前原站目標：${target.studentName||`學生 ${target.studentId?.slice(0,8)||'待確認'}`} · ${target.className||'班級名稱未提供'} · ${target.courseName||'課程名稱未提供'} · 報名 ${target.enrollmentId.slice(0,8)} · ${form.date||'日期待確認'}`,'muted'))
    const fields=make('div')
    const draftKey=`${form.action||form.reportId}:${selected.id}:${selected.version}`,draft=drafts.get(draftKey)||{}
    const sections=new Map([['attendance_status','出席'],['absence_reason','出席'],['lesson_id','課程與進度'],['is_completed','課程與進度'],['progress_start','課程與進度'],['progress_end','課程與進度'],['class_participation','課堂評量'],['classroom_behavior','課堂評量'],['content','評語與聯絡'],['contact_notes','評語與聯絡'],['class_notes','內部紀錄']]),fieldsets=new Map()
    for(const sourceField of form.fields){
      const card=make('div',undefined,'field'),label=make('label',undefined,'check'),check=make('input');check.type='checkbox';check.disabled=sourceField.disabled||sourceField.internal;check.checked=!sourceField.disabled&&!sourceField.internal&&!sourceField.value&&Boolean(suggestion(sourceField,selected));
      label.append(check,make('span',`套用${sourceField.label}${sourceField.internal?'（內部紀錄，預設不套用）':''}`));card.append(label)
      const comparison=make('div',undefined,'comparison');comparison.append(make('small',`原站目前：\n${sourceField.options?.find(option=>option.value===sourceField.value)?.label||sourceField.value||'空白'}`))
      const sourceReportValue=sourceField.key==='lesson_id'?contextLesson(selected):sourceField.key==='is_completed'?typeof selected.is_completed==='boolean'?(selected.is_completed?'課程已完成':'課程未完成'):'未填寫':sourceField.key==='progress_start'||sourceField.key==='progress_end'?selected.progress_letter||'未填章節':selected[sourceField.key]
      comparison.append(make('small',`EduLog：\n${sourceReportValue==null||sourceReportValue===''?'未填寫':safeText(String(sourceReportValue))}`));card.append(comparison)
      const input=make(sourceField.type==='text'?'textarea':'select');input.dataset.value='';input.dataset.key=sourceField.key;input.disabled=sourceField.disabled
      input.name=`edulog-prefill-${sourceField.key}`;input.autocomplete='off'
      if(sourceField.type==='text'){input.value=suggestion(sourceField,selected)}else{input.append(new Option(suggestion(sourceField,selected)?'已對應建議；請核對':'請人工選擇來源欄位選項',''));for(const option of sourceField.options||[])input.append(new Option(option.label||option.value,option.value));input.value=suggestion(sourceField,selected)}
      const valueLabel=make('label',`預填${sourceField.label}`);valueLabel.append(input);card.append(valueLabel)
      if(sourceField.type!=='text'&&!suggestion(sourceField,selected))card.append(make('p',sourceField.key==='lesson_id'?'需要您確認教材：原站選項未能唯一對應，請核對來源原文及實際選項。':'需要您確認選項：EduLog 值缺漏或無已驗證對應，請選擇實際原站選項。','help'))
      if(sourceField.disabled)card.append(make('p','原站欄位目前停用，請先在原站完成連動操作，再重新核對。','help'))
      if(sourceField.value){const overwriteLabel=make('label',undefined,'check'),overwrite=make('input');overwrite.type='checkbox';overwrite.dataset.overwrite='';overwriteLabel.append(overwrite,make('span','我確認覆寫目前原站內容'));card.append(overwriteLabel)}
      check.dataset.include=''
      if(draft[sourceField.key]){input.value=draft[sourceField.key].value;check.checked=!sourceField.disabled&&draft[sourceField.key].include;const overwrite=card.querySelector('[data-overwrite]');if(overwrite)overwrite.checked=draft[sourceField.key].overwrite}
      const group=sections.get(sourceField.key)||'其他欄位';if(!fieldsets.has(group)){const set=make('fieldset',undefined,'field-group');set.append(make('legend',group));fields.append(set);fieldsets.set(group,set)}fieldsets.get(group).append(card)
    }
    const matchConfirm=make('label',undefined,'check'),confirm=make('input');confirm.type='checkbox';confirm.dataset.mismatch='';confirm.hidden=!mismatch;matchConfirm.append(confirm,make('span','我已核對，確認使用其他學生或日期的報告作為範本'));if(mismatch)box.append(matchConfirm)
    box.append(fields)
    const internal= form.fields.find(field=>field.internal)
    if(internal){const allowed=make('label',undefined,'check'),check=make('input');check.type='checkbox';check.dataset.internal='';allowed.append(check,make('span','我另外確認允許複製內部紀錄'));box.append(allowed);const row=fields.querySelector(`[data-key="${CSS.escape(internal.key)}"]`)?.closest('.field');if(row){const include=row.querySelector('[data-include]');if(include)include.disabled=internal.disabled}}
    const actions=make('div',undefined,'actions'),apply=make('button','套用已勾選欄位','primary');apply.type='button';actions.append(apply);box.append(actions)
    box.append(make('p','請核對所選欄位；原站確認與送出仍由老師操作。','apply-feedback'))
    apply.addEventListener('click',()=>void applyFields(selected,apply))
    const update=()=>{const cards=[...fields.querySelectorAll('.field')],chosen=cards.filter(c=>c.querySelector('[data-include]').checked),overwrites=chosen.filter(c=>c.querySelector('[data-overwrite]')?.checked).length;apply.textContent=`套用 ${chosen.length} 個欄位${overwrites?`（覆寫 ${overwrites}）`:''}`;apply.disabled=!form.date||saving;const state={};for(const c of cards){const input=c.querySelector('[data-value]');state[input.dataset.key]={value:input.value,include:c.querySelector('[data-include]').checked,overwrite:c.querySelector('[data-overwrite]')?.checked===true}}drafts.set(draftKey,state)}
    fields.addEventListener('input',update);fields.addEventListener('change',update);update()
    if(!form.date)box.append(make('p','可預覽與編輯預填草稿；套用前請先在第 1 步確認完整上課日期。','help'))
    status('請檢查學生、日期及每個欄位；原站表單不會自動送出。')
  }
  function contextLesson(selected){return selected.lesson_name|| (selected.lesson_id?`教材識別碼 ${String(selected.lesson_id).slice(0,8)}（請核對原站選項）`:'未填教材')}
  async function applyFields(selected,button){
    if(button.disabled||saving)return
    const serial=generation;button.disabled=true;saving=true
    try {
    const current=await adapter.readForm(document)
    if(serial!==generation||!host?.isConnected)return
    if(current.formId!==form.formId||current.fingerprint!==form.fingerprint){status('原站表單內容已改變，請重新核對後再預填。',true);return}
    if(!form.date){status('請先確認完整上課日期。',true);return}
    const identityMismatch=!target||Boolean(target.enrollmentId&&selected.enrollment_id!==target.enrollmentId)||(selected.student_id&&target.studentId&&selected.student_id!==target.studentId)||(form.date&&selected.occurrence_date!==form.date)
    if(identityMismatch&&!root.querySelector('[data-mismatch]')?.checked){status('請先確認範本學生或日期與目前表單不同。',true);return}
    const fields=[]
    for(const card of root.querySelectorAll('.field')){
      const include=card.querySelector('[data-include]'),control=card.querySelector('[data-value]'),overwrite=card.querySelector('[data-overwrite]'),definition=form.fields.find(field=>field.key===control?.dataset.key)
      if(!include?.checked||!definition||definition.disabled)continue
      if(definition.internal&&!root.querySelector('[data-internal]')?.checked){status('內部紀錄需要另外確認。',true);return}
      if(definition.value&&definition.value!==control.value&&!overwrite?.checked){status(`「${definition.label}」已有原站內容，請確認是否覆寫。`,true);return}
      if(definition.type!=='text'&&!definition.options.some(option=>option.value===control.value&&!option.disabled)){status(`請人工選擇有效的「${definition.label}」原站選項。`,true);return}
      fields.push({key:definition.key,value:control.value,overwrite:overwrite?.checked===true,includeInternal:definition.internal})
    }
    if(!fields.length){status('請至少勾選一個要套用的欄位。',true);return}
    status('正在核對版本並套用欄位…')
    const result=await request('apply',{input:{reportId:selected.id,version:selected.version,targetEnrollmentId:target?.enrollmentId||null,identityConfirmed:identityMismatch&&root.querySelector('[data-mismatch]')?.checked===true,fields}})
    if(serial!==generation||!host?.isConnected)return
    status(`已套用 ${result.applied} 個欄位，待人工送出。請檢查原生表單內容。${result.recordSaved===false?'本機工作紀錄暫時未保存，請勿重複套用。':''}`,result.recordSaved===false)
    const after=await adapter.readForm(document);if(serial!==generation||!host?.isConnected)return;form=after
    const outcome=make('details');outcome.append(make('summary','4 · 查看已套用欄位（待人工送出）'))
    for(const item of fields){const actual=after.fields.find(f=>f.key===item.key);outcome.append(make('p',`${actual?.label||item.key}：${actual?.value===item.value?'已確認套用':'請在原站核對結果'} · ${actual?.options?.find(o=>o.value===actual.value)?.label||actual?.value||'空白'}`))}
    outcome.append(action('切換至原站表單檢查',()=>setView('native')));root.querySelector('.fields-result').append(outcome);button.dataset.applied='true';button.textContent='已套用；請檢查原站'
    } catch(error){if(serial===generation)status(error.message,true)}finally{saving=false;if(button.isConnected&&!button.dataset.applied)button.disabled=false}
  }
  async function lookup(){
    if(saving)return
    const serial=++generation
    const view=preserveView()
    status('正在驗證連線並查詢這位學生當天的報告…')
    try{
      const current=await adapter.readForm(document)
      if(serial!==generation||!host?.isConnected)return
      form=current
      const result=await request('lookup',{formId:form.formId,fingerprint:form.fingerprint})
      if(serial!==generation||!host?.isConnected)return
      form=result.form;target=result.target;settingsUrl=result.settingsUrl;capabilities=result.capabilities||{};root.querySelector('.target').textContent=`${target?.studentName||form.title||'原站報告'} · ${form.date||'日期待確認'}${form.supplement?' · 使用者確認':''}`;questionUI()
      formContext()
      if(!result.connected){root.querySelector('.connect').hidden=false;status('請先連接 EduLog，配對完成後再重新核對。',true);renderList([]);return}
      root.querySelector('.connect').hidden=true
      if(result.reason)status(result.reason,!target)
      else status(result.reports.length===1?'找到一份相符報告。':`已查詢同一日期報告：${result.reports.length} 份。`)
      renderList(result.reports||[],result.next_cursor)
      if(report){const selected=await request('detail',{reportId:report.id});if(serial!==generation||!host?.isConnected)return;if(!selected)throw new Error('所選報告已無法讀取；目前預填草稿仍保留。');const changed=selected.version!==report.version;if(changed){const key=`${form.action||form.reportId}:${report.id}:`;const old=drafts.get(key+report.version);if(old)drafts.set(key+selected.version,old)}report=selected;formContext();renderFields(report);restoreView(view);if(changed)status('EduLog 報告已更新；已保留預填草稿，請重新核對後再套用。')}
      else if(result.reports?.length===1&&form.date&&target&&!target.userConfirmed)await selectReport(result.reports[0])
      if(serial===generation)restoreView(view)
    }catch(error){if(serial===generation){if(/連接並驗證|請先連接/.test(error.message))root.querySelector('.connect').hidden=false;status(error.message,true)}}
  }
  function teardown(){generation++;if(layout&&nativeForm){anchor?.after(nativeForm);layout.remove();anchor?.remove()}for(const {node,value} of containers){if(value===null)node.removeAttribute('data-edulog-prefill-container');else node.setAttribute('data-edulog-prefill-container',value)}containers=[];modal?.querySelector('.edulog-prefill-context')?.remove();modal?.removeAttribute('data-edulog-prefill');host=root=nativeForm=layout=anchor=modal=form=target=report=null;groups.clear();saving=false}
  function sync(){if(suspended)return;const current=adapter.getForm(document);if(host?.isConnected&&nativeForm===current)return;teardown();if(current)setup()}
  observer=new MutationObserver(records=>{if(records.some(record=>{
    const node=record.target.nodeType===1?record.target:record.target.parentElement
    if(node?.closest('[data-edulog-owned],.edulog-editor-layout'))return false
    const changed=[...record.addedNodes,...record.removedNodes].filter(n=>n.nodeType===1&&!n.matches('[data-edulog-owned],.edulog-editor-layout'))
    return changed.length&&(node?.closest('.modal,#remote_modal')||changed.some(n=>n.matches('.modal,#remote_modal')||n.querySelector('.modal,#remote_modal')))
  }))sync()})
  observer.observe(document.documentElement,{childList:true,subtree:true})
  document.addEventListener('turbo:before-cache',()=>{suspended=true;teardown()})
  for(const name of ['turbo:render','turbo:load'])document.addEventListener(name,()=>{suspended=false;sync()})
  sync()
})()
