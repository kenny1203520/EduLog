// EduLog report assistant inside the verified native source editor: a compact card above the site's
// form. It opens the EduLog editor in the side panel; a report sent back from there (回填) is written
// straight into the site form, replacing what differs, and the filled fields are marked. The teacher
// still checks the form and submits it with the site's own button. A report picked on the card itself
// is listed field by field for review first.
// The shadow root keeps its controls and styles separate from the provider DOM.
(() => {
  if (!globalThis.edulogRuntime || !globalThis.edulogSourceIntegration || !document?.documentElement) return
  // UI wording goes through the shared phrasebook (zh-TW / zh-CN / en); data stays in params.
  const tx = (text, params = {}) => globalThis.edulogUi?.tx(text, params) ?? String(text).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
  const adapter = globalThis.edulogSourceIntegration
  let host = null, root = null, form = null, target = null, report = null, generation = 0, observer
  let nativeForm, modal, settingsUrl, capabilities = {}, saving = false, suspended = false
  let fieldRules=[]
  // The assistant mounts only for a verified EduLog connection; otherwise the native editor stays untouched.
  const COLLAPSE_KEY='edulogAssistantCollapsed'
  let blockedForm=null, pendingForm=null, accessSerial=0, expandAssistant=null
  let stopLocale
  const drafts = new Map()
  const SECTIONS=new Map([['attendance_status','出席'],['absence_reason','出席'],['lesson_id','課程與進度'],['is_completed','課程與進度'],['progress_start','課程與進度'],['progress_end','課程與進度'],['class_participation','課堂評量'],['classroom_behavior','課堂評量'],['content','評語與聯絡'],['contact_notes','評語與聯絡'],['learning_status','學習狀態'],['class_notes','內部紀錄']])
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
    let timer
    let response
    try {
      response = await Promise.race([
        globalThis.edulogRuntime.send({ type:'integration-inline-prefill', operation, formId:form?.formId, fingerprint:form?.fingerprint, ...details }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(tx('EduLog 助手查詢超過 30 秒。請檢查連線後重新核對。'))), 30000) }),
      ])
    } finally { clearTimeout(timer) }
    if (response?.error) { const error = new Error(response.error.message || tx('EduLog 預填功能暫時無法使用。')); Object.assign(error,response.error); throw error }
    if (!response || !Object.hasOwn(response, 'data')) throw new Error(tx('擴充功能背景程序沒有回傳有效結果。請重新載入擴充功能並刷新此報告頁。'))
    return response?.data
  }
  function status(message, error = false) {
    const node=root?.querySelector('[role=status]')
    if(node){node.textContent=message;node.dataset.error=String(error)}
  }
  // One visible stage at a time: loading → date | unsynced | ready → waiting → review → applied.
  function stage(name){const section=root?.querySelector('section');if(section)section.dataset.state=name}
  function setup({ collapsed = false } = {}) {
    if (host?.isConnected) return
    nativeForm=adapter.getForm(document)
    if (!nativeForm) return
    form=null; target=null; report=null
    host=document.createElement('aside'); host.className='edulog-editor-assistant';host.dataset.edulogOwned=''; host.setAttribute('aria-label',tx('EduLog 報告助手'))
    root=host.attachShadow({mode:'open'})
    root.innerHTML=`<style>
      :host{color:var(--edulog-text-strong,#172033);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;display:block;min-width:0;overflow-wrap:anywhere}
      [hidden]{display:none!important}*{box-sizing:border-box}
      section{border:1px solid var(--edulog-border,#cbd5e1);border-radius:var(--edulog-radius,10px);background:var(--edulog-surface,#fff);box-shadow:0 1px 2px rgb(15 23 42/.06);min-width:0;overflow:hidden}
      header{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;background:var(--edulog-surface-subtle,#f8fafc);border-bottom:1px solid var(--edulog-border-soft,#e2e8f0)}
      :host([data-collapsed=true]) header{border-bottom:0}
      .mark{flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--edulog-primary,#2449bb);color:#fff;font-weight:700;font-size:14px}
      .heading{flex:1;min-width:0}h2{font-size:15px;line-height:1.3;margin:0}.target{margin:0;font-size:13px;color:var(--edulog-text-muted,#475569);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      button,input,select,textarea{font:inherit}button{min-height:44px;padding:8px 14px;border:1px solid var(--edulog-border-strong,#b9c6db);border-radius:var(--edulog-radius-sm,7px);background:var(--edulog-surface,#fff);color:inherit;cursor:pointer;touch-action:manipulation}
      button:hover:not(:disabled){background:var(--edulog-surface-muted,#f1f5f9)}button:disabled{opacity:.55;cursor:not-allowed}
      button.primary{background:var(--edulog-primary,#2449bb);border-color:var(--edulog-primary,#2449bb);color:var(--edulog-text-on-primary,#fff);font-weight:600}button.primary:hover:not(:disabled){filter:brightness(1.08);background:var(--edulog-primary,#2449bb)}
      button.ghost{border-color:transparent;background:transparent;color:var(--edulog-text-secondary,#334155)}header button{min-width:44px;padding:8px 10px;font-size:14px}
      button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid var(--edulog-focus-ring,#2563eb);outline-offset:2px}
      input,select,textarea{width:100%;min-width:0;min-height:44px;padding:8px 10px;border:1px solid var(--edulog-border-input,#aab8cc);border-radius:var(--edulog-radius-sm,7px);background:var(--edulog-surface,#fff);color:inherit}textarea{min-height:120px;resize:vertical;line-height:1.6}
      .assistant-body{padding:12px 14px 14px;display:grid;gap:10px}p{margin:0}.muted{font-size:14px;color:var(--edulog-text-muted,#475569)}
      [role=status]{font-size:14px;padding:8px 10px;border-radius:var(--edulog-radius-sm,7px);background:var(--edulog-status-info-soft,#eef4ff);color:var(--edulog-status-info-text,#1e3a8a)}[role=status]:empty{display:none}[role=status][data-error=true]{background:var(--edulog-status-danger-soft,#fff1f2);color:var(--edulog-status-danger-text,#9f1239)}
      .actions{display:flex;flex-wrap:wrap;gap:8px}.actions button{flex:1 1 180px}
      .chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:2px 10px;border-radius:999px;background:var(--edulog-status-neutral-soft,#f1f5f9);color:var(--edulog-status-neutral-text,#334155)}.chip[data-tone=ok]{background:var(--edulog-status-ok-soft,#ecfdf3);color:var(--edulog-status-ok-text,#166534)}
      .waiting{display:flex;align-items:center;gap:10px;font-size:14px;padding:10px 12px;border-radius:var(--edulog-radius-sm,7px);background:var(--edulog-primary-soft,#eef2ff)}
      .pulse{flex:none;width:10px;height:10px;border-radius:50%;background:var(--edulog-primary-bright,#3b5bdb);animation:pulse 1.6s ease-in-out infinite}@keyframes pulse{50%{opacity:.35;transform:scale(.8)}}
      section:not([data-state=waiting]) .waiting{display:none}
      section:is([data-state=date],[data-state=review],[data-state=applied]) .editor-step{display:none!important}
      .question{display:grid;gap:8px;padding:12px;border-radius:var(--edulog-radius-sm,7px);background:var(--edulog-status-warn-soft,#fffbeb);border-left:3px solid var(--edulog-status-warn,#b45309)}
      label{display:block;font-weight:600}.check{display:flex;align-items:center;gap:10px;min-height:44px;font-weight:400;cursor:pointer}.check input{width:20px;height:20px;min-height:0;flex:none;margin:0;accent-color:var(--edulog-primary,#2449bb)}
      .review-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px}.review-head h3{margin:0;font-size:15px}
      .changes{display:grid;border:1px solid var(--edulog-border-soft,#e2e8f0);border-radius:var(--edulog-radius-sm,7px)}
      .field{display:grid;gap:6px;padding:8px 12px 10px;border-top:1px solid var(--edulog-border-soft,#e2e8f0)}.field:first-child{border-top:0}
      .field[data-kind=overwrite]{background:var(--edulog-status-warn-soft,#fffbeb)}.field .name{font-weight:600}
      .tag{font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--edulog-status-warn,#b45309);color:#fff}.tag[data-tone=info]{background:var(--edulog-status-neutral,#64748b)}
      .diff{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1.4fr);align-items:start;gap:8px;font-size:14px;padding-left:30px}
      .old{color:var(--edulog-text-muted,#64748b);text-decoration:line-through;text-decoration-color:rgb(100 116 139/.6)}.old[data-empty=true]{text-decoration:none;font-style:italic}.arrow{color:var(--edulog-text-subtle,#94a3b8)}
      .new{white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.field-body{padding-left:30px;display:grid;gap:6px}
      details{min-width:0}summary{min-height:44px;display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px;color:var(--edulog-text-secondary,#334155)}
      .same{font-size:14px}.same ul{margin:0;padding-left:20px;color:var(--edulog-text-muted,#475569)}.help{font-size:13px;color:var(--edulog-status-warn-text,#92400e)}
      .outcome{display:grid;gap:4px;font-size:14px;padding:10px 12px;border-radius:var(--edulog-radius-sm,7px);background:var(--edulog-status-ok-soft,#ecfdf3)}.outcome [data-ok=false]{color:var(--edulog-status-warn-text,#92400e)}
      .more{border-top:1px solid var(--edulog-border-soft,#e2e8f0);padding-top:2px}.more-body{display:grid;gap:10px;padding:4px 0}.list{display:grid;gap:6px}.list button{text-align:left}
      .field-mapping-memory{font-size:14px}.field-mapping-actions{display:flex;flex-wrap:wrap;gap:8px}.field-mapping-status{font-size:13px;color:var(--edulog-status-ok-text,#166534)}
      a{color:var(--edulog-primary,#1e40af);min-height:44px;display:inline-flex;align-items:center}
      @media(max-width:560px){.diff{grid-template-columns:1fr;padding-left:0}.diff .arrow{display:none}.field-body{padding-left:0}.actions button{flex:1 1 100%}}
      @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
    </style><section data-state="loading"><header><span class="mark" aria-hidden="true">E</span><div class="heading"><h2>${tx('EduLog 報告助手')}</h2><p class="target">${tx('正在查詢已記住的學生與日期…')}</p></div><button class="refresh ghost" type="button">${tx('重新核對')}</button><button class="collapse ghost" type="button">${tx('收合助手')}</button></header>
      <div class="assistant-body"><p role="status" aria-live="polite" aria-atomic="true">${tx('正在驗證擴充套件連線…')}</p><div class="date-step" hidden></div><div class="editor-step" hidden></div><div class="waiting" aria-hidden="true"><span class="pulse"></span><span>${tx('等待 EduLog 回填…')}</span></div><div class="review" hidden></div><div class="actions sync-actions"><button class="sync-class primary" type="button" hidden>${tx('同步本班')}</button></div><details class="more"><summary>${tx('更多選項')}</summary><div class="more-body"></div></details></div></section>`
    if(globalThis.edulogUi){const style=document.createElement('style');style.textContent=globalThis.edulogUi.styles;root.prepend(style);globalThis.edulogUi.text(root.querySelector('.sync-class'),'assistant.syncClass');globalThis.edulogUi.text(root.querySelector('.refresh'),'assistant.refresh');globalThis.edulogUi.text(root.querySelector('h2'),'assistant.title')}
    stopLocale=globalThis.edulogUiLegacy?.watch(root)
    const body=root.querySelector('.assistant-body'),collapse=root.querySelector('.collapse')
    // The card sits right above the site's form; the form itself is never moved or resized.
    nativeForm.before(host);modal=nativeForm.closest('.modal');modal?.setAttribute('data-edulog-prefill','')
    const applyCollapsed=(closed,persist=true)=>{host.dataset.collapsed=String(closed);body.hidden=closed;collapse.textContent=closed?tx('展開 EduLog 助手'):tx('收合助手');collapse.setAttribute('aria-expanded',String(!closed));globalThis.edulogUi?.text(collapse,closed?'assistant.expand':'assistant.collapse');if(persist)saveCollapsed(closed)}
    collapse.addEventListener('click',()=>applyCollapsed(host.dataset.collapsed!=='true'))
    expandAssistant=()=>{if(host?.dataset.collapsed==='true')applyCollapsed(false)}
    root.querySelector('.refresh').addEventListener('click',()=>void lookup())
    root.querySelector('.sync-class').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{const result=await globalThis.edulogRuntime.send({type:'open-integration-workspace',flow:'import'});if(result?.opened===false)throw new Error(result?.error?.message||tx('無法開啟整合工作台。'))}catch(error){status(error.message||tx('無法開啟整合工作台。'),true)}finally{if(button.isConnected)button.disabled=false}})
    applyCollapsed(collapsed,false)
    void lookup()
  }
  function action(label,fn,cls){const b=make('button',label,cls);b.type='button';b.addEventListener('click',fn);return b}
  function verifiedLink(parent,label,url){try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return;const a=make('a',`${label} ↗`);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a)}catch{/* Missing URLs remain unavailable. */}}
  function frontend(path){try{const u=new URL(settingsUrl),suffix='/dashboard/settings';if(!u.pathname.endsWith(suffix)||!['http:','https:'].includes(u.protocol))return null;u.pathname=u.pathname.slice(0,-suffix.length)+path;u.search='';u.hash='';return u.href}catch{return null}}
  function targetLine(){return [target?.studentName||form?.title||tx('學生待確認'),target?.className,form?.date||tx('日期待確認')].filter(Boolean).join(' · ')}
  // The date question: shown on its own while the date is missing, otherwise kept under 更多選項.
  function dateQuestion(){
    const q=make('div',undefined,'question');q.append(make('strong',form.date?tx('修改上課日期'):tx('需要您確認：完整上課日期')),make('p',form.dateInfo?.reason||tx('日期影響精確配對與套用前核對；不會修改原站。'),'muted'))
    const input=make('input');input.type='date';input.name='confirmed-source-date';input.autocomplete='off';input.value=form.date||'';const label=make('label',tx('這份原站報告的完整上課日期'));label.append(input);q.append(label)
    let conflict
    if(form.dateInfo?.conflict){conflict=make('input');conflict.type='checkbox';const l=make('label',undefined,'check');l.append(conflict,make('span',tx('我已核對矛盾的來源日期，確認使用此日期')));q.append(l)}
    if(form.dateInfo?.raw?.length)q.append(make('p',tx('原站日期資料：{value}',{value:form.dateInfo.raw.join(' ／ ')}),'muted'))
    const b=action(tx('確認上課日期'),()=>{if(!input.value){status(tx('請選擇完整上課日期。'),true);input.focus();return}void supplement({date:input.value,conflictAcknowledged:conflict?.checked===true},b)},'primary');q.append(b)
    return q
  }
  // 更多選項: change the date or the student for this report only, open the workbench, source links.
  function moreUI(){
    const box=root.querySelector('.more-body');box.replaceChildren()
    if(form.date)box.append(dateQuestion())
    const identities=make('details',undefined,'identity-question');identities.append(make('summary',target?tx('修改當次學生／報名'):tx('需要您確認：當次學生／報名')))
    const student=make('input');student.type='search';student.name='target-student-search';student.autocomplete='off';student.maxLength=80;const lab=make('label',tx('搜尋既有 EduLog 學生'));lab.append(student);identities.append(lab)
    const feedback=make('p',tx('姓名不自動合併；選擇只用於本次報告。'),'muted');feedback.setAttribute('aria-live','polite');const results=make('div',undefined,'list');let serial=0,timer
    const search=async cursor=>{const id=++serial,scope=generation;feedback.textContent=tx('正在查詢學生…');try{const data=await request('identity-search',{query:{resource:'students',search:student.value.trim(),cursor}});if(id!==serial||scope!==generation||!identities.isConnected)return;if(!cursor)results.replaceChildren();for(const item of data.items||[])results.append(action(`${item.name} · #${item.id.slice(0,8)}`,()=>void enrollments(item)));feedback.textContent=tx('本頁找到 {count} 位學生。',{count:data.items?.length||0});if(data.next_cursor)results.append(action(tx('載入更多學生'),()=>void search(data.next_cursor)))}catch(e){if(id===serial)feedback.textContent=e.message}}
    const enrollments=async (s,cursor)=>{const id=++serial,scope=generation;feedback.textContent=tx('正在讀取 {name} 的報名…',{name:s.name});try{const data=await request('identity-search',{query:{resource:'enrollments',student_id:s.id,cursor}});if(id!==serial||scope!==generation||!identities.isConnected)return;if(!cursor)results.replaceChildren();for(const item of data.items||[]){const b=action(`${s.name} · ${item.course_name||tx('課程')} · ${item.class_session?.name||tx('班級')} · #${item.id.slice(0,8)}`,()=>void supplement({enrollmentId:item.id},b),'primary');results.append(b)}feedback.textContent=data.items?.length?tx('選擇與原站表單對應的報名（本次確認）。'):tx('沒有可讀取的報名；可搜尋其他學生或使用範本。');if(data.next_cursor)results.append(action(tx('載入更多報名'),()=>void enrollments(s,data.next_cursor)))}catch(e){if(id===serial)feedback.textContent=e.message}}
    student.addEventListener('input',()=>{serial++;clearTimeout(timer);timer=setTimeout(()=>void search(),300)});identities.append(action(tx('查詢學生'),()=>void search()),feedback,results);box.append(identities)
    const links=make('div',undefined,'actions');links.append(action(tx('開啟工作台確認並記住對應'),()=>void edulogRuntime.send({type:'open-integration-workspace',flow:'import'}).catch(e=>status(e.message,true))));box.append(links)
    if(form.supplement)box.append(make('p',tx('補充資訊：使用者確認（本次報告使用，不建立永久身份對應）'),'muted'))
    verifiedLink(box,tx('查看原站報告'),form.sourceReportUrl)
  }
  async function supplement(input,b){if(saving||b.disabled)return;const scope=generation;saving=true;b.disabled=true;status(tx('正在保存當次確認資訊…'));try{const data=await request('supplement',{input});if(scope!==generation||!host?.isConnected)return;form=data.form;saving=false;await lookup()}catch(e){if(scope===generation)status(e.message,true)}finally{saving=false;if(b.isConnected)b.disabled=false}}
  // Ready: one primary action that opens the EduLog editor beside this window. A single report already
  // saved for this date can also be reviewed here directly.
  function renderEditorStep(reports) {
    const box=root.querySelector('.editor-step');box.replaceChildren();box.hidden=!target
    if(!target)return
    const sameDay=reports.filter(item=>item.enrollment_id===target.enrollmentId&&item.occurrence_date===form.date)
    const chip=make('span',sameDay.length?tx('EduLog 已有這天的報告。'):tx('EduLog 還沒有這天的報告；開啟後可在 EduLog 建立。'),'chip');chip.dataset.tone=sameDay.length?'ok':'neutral'
    const actions=make('div',undefined,'actions'),open=action(tx('在 EduLog 編輯（側邊欄）'),()=>void openEditor(open),'primary');open.dataset.openEditor='';actions.append(open)
    if(sameDay.length===1)actions.append(action(tx('直接回填這天的 EduLog 報告'),()=>void selectReport(sameDay[0])))
    box.append(make('p',undefined,'muted'),actions);box.firstChild.append(chip)
  }
  async function openEditor(button){
    if(button.disabled)return
    if(!form?.date){status(tx('請先確認完整上課日期。'),true);return}
    // The request goes out within this click: the browser opens the side panel only for a user action.
    const opened=request('open-editor')
    button.disabled=true;status(tx('正在開啟 EduLog 編輯器…'))
    try{
      const result=await opened
      if(result?.reason==='no-target'){status(tx('此學生尚未同步到 EduLog。同步本班後即可在 EduLog 編輯。'));root.querySelector('.sync-class').hidden=false;return}
      button.textContent=tx('重新開啟 EduLog 側邊欄');stage('waiting')
      status(result?.access===false?tx('請在側邊欄允許存取 EduLog 網站，才能使用你的 EduLog 登入。'):tx('EduLog 已在側邊欄開啟。編輯完成後按「回填到原站」，EduLog 的內容會直接填入下方表單，再由你按原站按鈕送出。'))
    }catch(error){status(error.message,true)}finally{if(button.isConnected)button.disabled=false}
  }
  function suggestion(field, selected) {
    const value=globalThis.edulogFieldMappings.suggest(field,selected,fieldRules)
    return field.type==='text'?safeText(value):value
  }
  async function loadFieldRules(serial){
    fieldRules=[]
    if(target&&capabilities.field_mapping_memory){
      try{const data=await request('field-resolve');if(serial===generation)fieldRules=data.items||[]}
      catch(e){if(serial===generation)status(tx('欄位記憶暫時無法讀取：{message} 可先核對已驗證建議。',{message:e.message}),true)}
    }
  }
  async function selectReport(item) {
    if(saving)return
    const serial=++generation;status(tx('正在讀取所選報告內容…'))
    try{
      let full=await request('detail',{reportId:item.id,kind:item.kind})
      if(serial!==generation||!host?.isConnected)return
      if(!full)throw new Error(tx('所選報告已無法讀取，請在 EduLog 確認後重新回填。'))
      full={...item,...full}
      await loadFieldRules(serial);if(serial!==generation||!host?.isConnected)return;report=full;renderFields(full)
      host.scrollIntoView?.({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
    }catch(error){if(serial===generation)status(error.message,true)}
  }
  const optionLabel=(field,value)=>field.options?.find(option=>option.value===value)?.label||value
  // The fields a report would change on the current site form; everything else is listed as the same.
  function plannedFields(selected){
    const rows=[],same=[],mappings=globalThis.edulogFieldMappings
    for(const field of form.fields){
      const proposed=suggestion(field,selected),hasReportValue=!mappings.empty(mappings.reportValue(field,selected))
      const nativeText=field.value?optionLabel(field,field.value):''
      if(mappings.equal(field,selected,fieldRules)||!hasReportValue&&!proposed||proposed&&proposed===field.value){same.push(`${tx(field.label)}：${nativeText||tx('空白')}`);continue}
      rows.push({field,proposed,hasReportValue,nativeText})
    }
    return {rows,same}
  }
  // A row 回填 can write by itself: an enabled field with a value, and for options a valid site option.
  // An empty EduLog value never clears the site.
  const fillable=({field,proposed})=>!field.disabled&&Boolean(proposed)&&(field.type==='text'||field.options.some(option=>option.value===proposed&&!option.disabled))
  const isMismatch=selected=>selected.template_only||!target||!form.date||Boolean(target.enrollmentId&&selected.enrollment_id!==target.enrollmentId)||(selected.student_id&&target.studentId&&selected.student_id!==target.studentId)||(form.date&&selected.occurrence_date!==form.date)
  // Review: only fields the report would change are listed, each as 原站 → EduLog. New content is
  // ticked; replacing content already on the site, internal notes and unmapped options start unticked,
  // so ticking such a row is the teacher's explicit confirmation.
  function renderFields(selected) {
    // A refresh re-renders the same report: keep opened text editors, focus and caret.
    const box=root.querySelector('.review'),focused=root.activeElement,prior={open:[...box.querySelectorAll('details.edit[open]')].map(d=>d.closest('.field')?.dataset.fieldKey),key:focused?.dataset?.key,start:focused?.selectionStart,end:focused?.selectionEnd}
    box.replaceChildren();box.hidden=false;stage('review')
    const mismatch=isMismatch(selected)
    const head=make('div',undefined,'review-head');head.append(make('h3',tx('回填 EduLog 報告 · {date}',{date:selected.occurrence_date||tx('日期待確認')})))
    if(selected.updated_at)head.append(make('span',tx('EduLog 更新時間：{time}',{time:new Date(selected.updated_at).toLocaleString()}),'muted'))
    box.append(head)
    if(mismatch){const warn=make('div',undefined,'question'),l=make('label',undefined,'check'),c=make('input');c.type='checkbox';c.dataset.mismatch='';l.append(c,make('span',tx('我已核對，確認使用其他學生或日期的報告作為範本')));warn.append(make('p',tx('範本的學生或日期與原站表單不同。套用前需勾選確認；只會複製欄位，不改變身份對應。')),l);box.append(warn)}
    const draftKey=`${form.action||form.reportId}:${selected.id}:${selected.version}`,draft=drafts.get(draftKey)||{}
    const changes=make('div',undefined,'changes'),{rows,same}=plannedFields(selected)
    const currentFormId=form.formId
    for(const {field:sourceField,proposed,hasReportValue,nativeText} of rows){
      const kind=sourceField.disabled?'blocked':sourceField.value?'overwrite':'new'
      const card=make('div',undefined,'field');card.dataset.fieldKey=sourceField.key;card.dataset.kind=kind
      const label=make('label',undefined,'check'),check=make('input');check.type='checkbox';check.dataset.include='';check.disabled=sourceField.disabled
      check.checked=kind==='new'&&!sourceField.internal&&Boolean(proposed)
      label.append(check,make('span',tx(sourceField.label),'name'))
      if(kind==='overwrite'){const t=make('span',tx('覆寫原站內容'),'tag');label.append(t)}
      if(sourceField.internal){const t=make('span',tx('內部紀錄'),'tag');t.dataset.tone='info';label.append(t)}
      card.append(label)
      const diff=make('div',undefined,'diff'),old=make('span',nativeText||tx('原站空白'),'old');old.dataset.empty=String(!nativeText)
      const input=make(sourceField.type==='text'?'textarea':'select');input.dataset.value='';input.dataset.key=sourceField.key;input.disabled=sourceField.disabled;input.name=`edulog-prefill-${sourceField.key}`;input.autocomplete='off';input.setAttribute('aria-label',tx('預填{label}',{label:tx(sourceField.label)}))
      const fresh=make('span',undefined,'new'),body=make('div',undefined,'field-body')
      if(sourceField.type==='text'){
        input.value=proposed;fresh.textContent=proposed||tx('（空白）')
        const edit=make('details',undefined,'edit');edit.append(make('summary',tx('編輯要填入的內容')),input);body.append(edit)
        input.addEventListener('input',()=>{fresh.textContent=input.value||tx('（空白）')})
      }else{
        input.append(new Option(proposed?tx('已對應建議；請核對'):tx('請選擇原站選項'),''));for(const option of sourceField.options||[])input.append(new Option(option.label||option.value,option.value));input.value=proposed
        fresh.append(input)
      }
      diff.append(old,make('span','→','arrow'),fresh);card.append(diff)
      if(sourceField.type!=='text'&&!proposed)body.append(make('p',sourceField.key==='lesson_id'?tx('需要您確認教材：原站選項未能唯一對應，請核對來源原文及實際選項。'):tx('需要您確認選項：EduLog 值缺漏或無已驗證對應，請選擇實際原站選項。'),'help'))
      if(sourceField.disabled)body.append(make('p',tx('原站欄位目前停用，請先在原站完成連動操作，再重新核對。'),'help'))
      if(sourceField.type!=='text'&&!hasReportValue)body.append(make('p',tx('EduLog：{value}',{value:tx('未填寫')}),'muted'))
      if(draft[sourceField.key]){input.value=draft[sourceField.key].value;check.checked=!sourceField.disabled&&draft[sourceField.key].include;if(sourceField.type==='text')fresh.textContent=input.value||tx('（空白）')}
      globalThis.edulogFieldMappingUI?.attach(body,sourceField,selected,fieldRules,{enabled:capabilities.field_mapping_memory&&Boolean(target),sourceValue:input.value,confirm:item=>request('field-confirm',{items:[item]}),isCurrent:()=>report===selected&&form.formId===currentFormId,changed:()=>{if(!check.checked){input.value=suggestion(sourceField,selected);update()}}})
      if(body.childElementCount)card.append(body)
      changes.append(card)
    }
    if(changes.childElementCount)box.append(changes);else box.append(make('p',tx('EduLog 報告與原站表單內容相同，沒有需要回填的欄位。'),'muted'))
    if(same.length){const d=make('details',undefined,'same'),list=make('ul');d.append(make('summary',tx('{count} 個欄位相同或 EduLog 未填',{count:same.length})));for(const line of same)list.append(make('li',line));d.append(list);box.append(d)}
    const actions=make('div',undefined,'actions'),apply=make('button',tx('套用已勾選欄位'),'primary');apply.type='button';apply.dataset.apply='';actions.append(apply)
    const reportUrl=frontend(`/dashboard/reports/${selected.enrollment_id}`);box.append(actions)
    const links=make('p',undefined,'muted');if(reportUrl)verifiedLink(links,tx('查看 EduLog 報名與報告'),reportUrl);if(links.childElementCount)box.append(links)
    box.append(make('p',tx('只會填入原站表單，不會自動送出；送出仍由老師操作。'),'muted'))
    apply.addEventListener('click',()=>void applyFields(selected,apply))
    const update=()=>{const cards=[...changes.querySelectorAll('.field')],chosen=cards.filter(c=>{const check=c.querySelector('[data-include]'),value=c.querySelector('[data-value]'),field=form.fields.find(f=>f.key===value?.dataset.key);return check.checked&&!check.disabled&&!field?.disabled&&value.value!==field?.value}),overwrites=chosen.filter(c=>c.dataset.kind==='overwrite').length;apply.textContent=tx('套用 {count} 個欄位',{count:chosen.length})+(overwrites?tx('（覆寫 {count}）',{count:overwrites}):'');globalThis.edulogUi?.text(apply,'assistant.apply',{count:chosen.length,overwrite:overwrites});apply.disabled=!form.date||saving||chosen.length===0;const state={};for(const c of cards){const input=c.querySelector('[data-value]');state[input.dataset.key]={value:input.value,include:c.querySelector('[data-include]').checked}}drafts.set(draftKey,state)}
    changes.addEventListener('input',update);changes.addEventListener('change',update);update()
    for(const key of prior.open){const edit=changes.querySelector(`.field[data-field-key="${CSS.escape(key||'')}"] details.edit`);if(edit)edit.open=true}
    const control=prior.key&&changes.querySelector(`[data-key="${CSS.escape(prior.key)}"]`);if(control){control.focus({preventScroll:true});if(control.tagName==='TEXTAREA'&&prior.start!=null)control.setSelectionRange(prior.start,prior.end)}
    if(!form.date)box.append(make('p',tx('可預覽與編輯預填草稿；套用前請先確認完整上課日期。'),'help'))
    status(changes.childElementCount?tx('請確認要填入的欄位；原站表單不會自動送出。'):tx('沒有需要回填的欄位。'))
  }
  function clearMarks(){for(const node of document?.querySelectorAll?.('[data-edulog-filled]')||[])node.removeAttribute('data-edulog-filled')}
  // Marks each filled site field so the teacher can see what changed before submitting.
  function markFilled(results){
    clearMarks();let first=null
    for(const {key,ok} of results){const node=adapter.fieldNodes?.(document,key)?.[0];const box=node?.closest('.form-group,.mb-3,.field,fieldset')||node?.parentElement;if(!box)continue;box.setAttribute('data-edulog-filled',ok?'ok':'check');first||=node}
    return first
  }
  function renderOutcome(results,partial,{replaced=false,skipped=[]}={}){
    const box=root.querySelector('.review'),outcome=make('div',undefined,'outcome');outcome.setAttribute('role','group')
    outcome.append(make('strong',partial?tx('部分套用：請檢查原站並重新核對'):replaced?tx('已用 EduLog 內容覆蓋原站表單，請檢查後按原站按鈕送出'):tx('已填入原站表單，請檢查後自行送出')))
    for(const {label,ok,value,before} of results){const line=make('p',before===undefined?tx('{label}：{result} · {value}',{label,result:ok?tx('已確認套用'):tx('請在原站核對結果'),value}):tx('{label}：{before} → {value}',{label,before:before||tx('空白'),value}));line.dataset.ok=String(ok);outcome.append(line)}
    if(skipped.length)outcome.append(make('p',tx('需要在原站選擇：{fields}',{fields:skipped.join('、')}),'help'))
    if(replaced)outcome.append(make('p',tx('原站尚未送出；不想保留時，關閉原站表單即可放棄這些變更。'),'muted'))
    const first=markFilled(results),actions=make('div',undefined,'actions')
    if(first)actions.append(action(tx('前往第一個已填欄位'),()=>{first.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});first.focus({preventScroll:true})},'primary'))
    actions.append(action(tx('重新核對'),()=>void lookup()))
    box.replaceChildren(outcome,actions);stage('applied')
  }
  async function applyFields(selected,button){
    if(button.disabled||saving)return
    const serial=generation;button.disabled=true;saving=true
    try {
    const current=await adapter.readForm(document)
    if(serial!==generation||!host?.isConnected)return
    if(current.formId!==form.formId||current.fingerprint!==form.fingerprint){status(tx('原站表單內容已改變，請重新核對後再預填。'),true);return}
    if(!form.date){status(tx('請先確認完整上課日期。'),true);return}
    const identityMismatch=isMismatch(selected)
    if(identityMismatch&&!root.querySelector('[data-mismatch]')?.checked){status(tx('請先確認範本學生或日期與目前表單不同。'),true);return}
    const fields=[]
    for(const card of root.querySelectorAll('.field')){
      const include=card.querySelector('[data-include]'),control=card.querySelector('[data-value]'),definition=form.fields.find(field=>field.key===control?.dataset.key)
      if(!include?.checked||!definition||definition.disabled||definition.value===control.value)continue
      if(definition.type!=='text'&&!definition.options.some(option=>option.value===control.value&&!option.disabled)){status(tx('請人工選擇有效的「{label}」原站選項。',{label:tx(definition.label)}),true);return}
      // A ticked row is the confirmation for replacing site content or copying an internal note.
      fields.push({key:definition.key,value:control.value,overwrite:Boolean(definition.value),includeInternal:definition.internal})
    }
    if(!fields.length){status(tx('請至少勾選一個要套用的欄位。'),true);return}
    status(tx('正在核對版本並套用欄位…'))
    const result=await request('apply',{input:{reportId:selected.id,kind:selected.kind,version:selected.version,targetEnrollmentId:target?.enrollmentId||null,identityConfirmed:identityMismatch&&root.querySelector('[data-mismatch]')?.checked===true,fields}})
    if(serial!==generation||!host?.isConnected)return
    status(tx('已套用 {count} 個欄位，待人工送出。請檢查原生表單內容。',{count:result.applied})+(result.recordSaved===false?tx('本機工作紀錄暫時未保存，請勿重複套用。'):''),result.recordSaved===false)
    const after=await adapter.readForm(document);if(serial!==generation||!host?.isConnected)return;form=after
    renderOutcome(fields.map(item=>{const actual=after.fields.find(f=>f.key===item.key);return{key:item.key,label:actual?.label?tx(actual.label):item.key,ok:actual?.value===item.value,value:actual?.value?optionLabel(actual,actual.value):tx('空白')}}),false)
    } catch(error){if(serial===generation){status(error.message,true);if(error.appliedFields?.length){const after=await adapter.readForm(document);if(serial!==generation||!host?.isConnected)return;form=after;renderOutcome(error.appliedFields.map(key=>{const actual=after.fields.find(f=>f.key===key);return{key,label:actual?.label?tx(actual.label):key,ok:false,value:actual?.value?optionLabel(actual,actual.value):tx('空白')}}),true)}}}finally{saving=false;if(button.isConnected)button.disabled=false}
  }
  // 回填 from the side panel: write every field that differs straight into the site form. Replacing
  // site content and copying the internal note need no extra tick here, because nothing is saved
  // until the teacher submits the site form. A report for another student or date is reviewed instead.
  const failure=(reason,message)=>Object.assign(new Error(message||reason),{reason})
  const outcomeLine=(after,key,before,ok)=>{const actual=after.fields.find(f=>f.key===key);return{key,label:actual?.label?tx(actual.label):key,ok:ok(actual),before,value:actual?.value?optionLabel(actual,actual.value):tx('空白')}}
  async function autoFill(item){
    if(saving)throw failure('BUSY',tx('上一次回填還在進行，請稍候再試。'))
    const serial=++generation,stale=()=>serial!==generation||!host?.isConnected
    status(tx('正在把 EduLog 報告填入原站表單…'))
    const detail=await request('detail',{reportId:item.id,kind:item.kind})
    if(stale())throw failure('SOURCE_CHANGED')
    if(!detail)throw failure('REPORT_UNAVAILABLE',tx('所選報告已無法讀取，請在 EduLog 確認後重新回填。'))
    const selected={...item,...detail}
    await loadFieldRules(serial);if(stale())throw failure('SOURCE_CHANGED')
    report=selected
    const current=await adapter.readForm(document);if(stale())throw failure('SOURCE_CHANGED')
    if(current.formId!==form.formId)throw failure('SOURCE_CHANGED',tx('原站表單內容已改變，請重新核對後再預填。'))
    form=current
    if(isMismatch(selected)){renderFields(selected);return {applied:0,skipped:0,review:true}}
    saving=true
    const filled=new Map();let skipped=[],partial=false
    try{
      // A chosen lesson can change other fields' options, so a second pass fills what became valid.
      for(let pass=0;pass<2;pass++){
        if(pass){const after=await adapter.readForm(document);if(stale())throw failure('SOURCE_CHANGED');form=after}
        const {rows}=plannedFields(selected),fill=rows.filter(row=>fillable(row)&&!filled.has(row.field.key))
        skipped=rows.filter(row=>!fillable(row)).map(row=>tx(row.field.label))
        if(!fill.length)break
        const fields=fill.map(({field,proposed})=>({key:field.key,value:proposed,overwrite:Boolean(field.value),includeInternal:Boolean(field.internal)}))
        try{await request('apply',{input:{reportId:selected.id,kind:selected.kind,version:selected.version,targetEnrollmentId:target?.enrollmentId||null,identityConfirmed:false,fields}})}
        catch(error){
          for(const row of fill)if(error.appliedFields?.includes(row.field.key))filled.set(row.field.key,{value:row.proposed,before:row.nativeText})
          if(pass||!error.appliedFields?.length)throw error
          partial=true;continue
        }
        partial=false
        for(const row of fill)filled.set(row.field.key,{value:row.proposed,before:row.nativeText})
        if(!skipped.length)break
      }
      const after=await adapter.readForm(document);if(stale())throw failure('SOURCE_CHANGED');form=after
      const results=[...filled].map(([key,{value,before}])=>outcomeLine(after,key,before,actual=>actual?.value===value))
      if(!results.length&&!skipped.length){const box=root.querySelector('.review');box.replaceChildren(make('p',tx('EduLog 報告與原站表單內容相同，沒有需要回填的欄位。'),'muted'));box.hidden=false;stage('review');status(tx('沒有需要回填的欄位。'));return {applied:0,skipped:0}}
      renderOutcome(results,partial,{replaced:true,skipped})
      status(skipped.length?tx('已填入 {count} 個欄位；{skipped} 個欄位需要在原站選擇。',{count:results.length,skipped:skipped.length}):tx('已填入 {count} 個欄位，請檢查原站表單後送出。',{count:results.length}))
      return {applied:results.length,skipped:skipped.length}
    }catch(error){
      if(!stale()){
        status(error.message,true)
        const after=filled.size?await adapter.readForm(document).catch(()=>null):null
        if(after&&!stale()){form=after;renderOutcome([...filled].map(([key,{before}])=>outcomeLine(after,key,before,()=>false)),true)}
      }
      throw failure(error.reason||(filled.size?'PARTIAL_APPLY':'SOURCE_CHANGED'),error.message)
    }finally{saving=false}
  }
  async function lookup(){
    if(saving)return
    const serial=++generation
    status(tx('正在驗證連線並查詢這位學生當天的報告…'))
    try{
      const current=await adapter.readForm(document)
      if(serial!==generation||!host?.isConnected)return
      form=current
      const result=await request('lookup',{formId:form.formId,fingerprint:form.fingerprint})
      if(serial!==generation||!host?.isConnected)return
      if(!result||!result.form||!Array.isArray(result.reports))throw new Error(tx('EduLog 助手未取得完整報告資料。請確認此頁網址與報告表單後重新核對。'))
      form=result.form;target=result.target;settingsUrl=result.settingsUrl;capabilities=result.capabilities||{}
      root.querySelector('.target').textContent=targetLine()+(form.supplement?tx(' · 使用者確認'):'')
      moreUI()
      const dateStep=root.querySelector('.date-step');dateStep.replaceChildren();dateStep.hidden=Boolean(form.date);if(!form.date)dateStep.append(dateQuestion())
      await loadFieldRules(serial);if(serial!==generation||!host?.isConnected)return
      if(!result.connected){status(tx('請先連接 EduLog，配對完成後再重新核對。'),true);root.querySelector('.editor-step').hidden=true;return}
      // An unsynced student is an ordinary state, not an error: offer the class sync instead of empty steps.
      root.querySelector('.sync-class').hidden=Boolean(target)
      renderEditorStep(result.reports||[])
      if(report){const selected=await request('detail',{reportId:report.id});if(serial!==generation||!host?.isConnected)return;if(!selected)throw new Error(tx('所選報告已無法讀取；目前預填草稿仍保留。'));const changed=selected.version!==report.version;if(changed){const key=`${form.action||form.reportId}:${report.id}:`;const old=drafts.get(key+report.version);if(old)drafts.set(key+selected.version,old)}report={...report,...selected};renderFields(report);if(changed)status(tx('EduLog 報告已更新；已保留預填草稿，請重新核對後再套用。'));return}
      root.querySelector('.review').hidden=true
      stage(!form.date?'date':target?'ready':'unsynced')
      if(!target)status(tx('此學生尚未同步到 EduLog。同步本班後即可在 EduLog 編輯並回填。'))
      else if(!form.date)status(tx('請先確認完整上課日期。'))
      else status(result.reason||'')
    }catch(error){if(serial===generation)status(error.message,true)}
  }
  function teardown(){generation++;stopLocale?.();stopLocale=null;clearMarks();modal?.removeAttribute('data-edulog-prefill');host?.remove();host=root=nativeForm=modal=form=target=report=null;saving=false}
  async function readAccess(){try{const value=await globalThis.edulogRuntime.send({type:'get-edulog-integration-status'});return value?.status==='connected'&&value?.capabilities?.report_prefill===true}catch{return false}}
  async function readCollapsed(){try{return (await chrome.storage.local.get(COLLAPSE_KEY))?.[COLLAPSE_KEY]===true}catch{return false}}
  function saveCollapsed(value){try{void chrome.storage.local.set({[COLLAPSE_KEY]:value}).catch(()=>{})}catch{/* Storage is unavailable after the extension context is invalidated. */}}
  async function sync(force=false){
    if(suspended)return
    const current=adapter.getForm(document)
    if(!current){pendingForm=null;blockedForm=null;accessSerial++;teardown();return}
    if(!force&&(pendingForm===current||host?.isConnected&&nativeForm===current||blockedForm===current))return
    const serial=++accessSerial;pendingForm=current
    const [ready,collapsed]=await Promise.all([readAccess(),readCollapsed()])
    if(serial!==accessSerial)return
    pendingForm=null
    if(suspended||adapter.getForm(document)!==current)return
    // Without a verified connection the native editor stays exactly as the site shows it.
    if(!ready){teardown();blockedForm=current;return}
    blockedForm=null
    if(host?.isConnected&&nativeForm===current)return
    teardown();setup({collapsed})
  }
  try{chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.edulogExtension)void sync(true)})}catch{/* The page keeps the native editor when extension storage is unavailable. */}
  // 回填: the background forwards the report the teacher sent from the EduLog side panel. It is written
  // into the site form at once; the form is never submitted.
  globalThis.edulogRuntime.listen((message,_sender,respond)=>{
    if(message?.type!=='edulog-fill-report')return
    if(!host?.isConnected||!form||message.formId!==form.formId||typeof message.reportId!=='string'){respond({ok:false,reason:'FORM_CLOSED'});return}
    expandAssistant?.()
    void autoFill({id:message.reportId}).then(result=>respond({ok:true,...result}),error=>respond({ok:false,reason:error.reason||'REPORT_UNAVAILABLE'}))
    return true
  })
  observer=new MutationObserver(records=>{if(records.some(record=>{
    const node=record.target.nodeType===1?record.target:record.target.parentElement
    if(node?.closest('[data-edulog-owned]'))return false
    const changed=[...record.addedNodes,...record.removedNodes].filter(n=>n.nodeType===1&&!n.matches('[data-edulog-owned]'))
    return changed.length&&(node?.closest('.modal,#remote_modal')||changed.some(n=>n.matches('.modal,#remote_modal')||n.querySelector('.modal,#remote_modal')))
  }))void sync()})
  observer.observe(document.documentElement,{childList:true,subtree:true})
  document.addEventListener('turbo:before-cache',()=>{suspended=true;accessSerial++;pendingForm=blockedForm=null;teardown()})
  for(const name of ['turbo:render','turbo:load'])document.addEventListener(name,()=>{suspended=false;void sync()})
  void sync()
})()
