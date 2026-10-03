// A focused EduLog report preview inside the verified native source editor.
// The shadow root keeps its controls and styles separate from the provider DOM.
(() => {
  if (!globalThis.edulogRuntime || !globalThis.edulogSourceIntegration || !document?.documentElement) return
  const adapter = globalThis.edulogSourceIntegration
  let host = null, root = null, form = null, target = null, report = null, generation = 0, observer
  const make = (tag, text, className) => { const item=document.createElement(tag); if(text!==undefined)item.textContent=text; if(className)item.className=className; return item }
  const safeText = value => {
    if (typeof value !== 'string') return ''
    if (!/<\/?[a-z][^>]*>/i.test(value)) return value
    const parsed = new DOMParser().parseFromString(value, 'text/html')
    parsed.querySelectorAll('script,style,svg,iframe,object').forEach(item=>item.remove())
    return parsed.body.textContent.replace(/\n{3,}/g,'\n\n').trim()
  }
  async function request(operation, details = {}) {
    const response = await globalThis.edulogRuntime.send({ type:'integration-inline-prefill', operation, formId:form?.formId, fingerprint:form?.fingerprint, ...details })
    if (response?.error) throw new Error(response.error.message || 'EduLog 預填功能暫時無法使用。')
    return response?.data
  }
  function status(message, error = false) {
    const node=root?.querySelector('[role=status]')
    if(node){node.textContent=message;node.dataset.error=String(error)}
  }
  function setup() {
    if (host?.isConnected) return
    const nativeForm=adapter.getForm(document)
    if (!nativeForm) return
    form=null; target=null; report=null
    host=document.createElement('aside'); host.dataset.edulogOwned=''; host.setAttribute('aria-label','EduLog 報告預覽與預填');
    root=host.attachShadow({mode:'open'})
    root.innerHTML=`<style>
      :host{all:initial;color:#172033;font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;display:block;margin:0 0 14px;min-width:0}
      *{box-sizing:border-box}section{border:1px solid #cbd5e1;border-left:4px solid #2449bb;border-radius:10px;background:#f8fafc;padding:14px;min-width:0}
      header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}h2{font-size:16px;margin:0}p{margin:7px 0;color:#475569;overflow-wrap:anywhere}
      button,input,select{font:inherit}button{min-height:44px;padding:8px 12px;border:1px solid #b9c6db;border-radius:7px;background:white;color:#172033;cursor:pointer;touch-action:manipulation}
      button.primary{background:#2449bb;border-color:#2449bb;color:white}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
      input,select{width:100%;min-height:44px;padding:8px 10px;border:1px solid #aab8cc;border-radius:7px;background:white;color:#172033}
      label{display:block;font-weight:600;margin:10px 0 4px}small{display:block;color:#475569;font-size:13px;overflow-wrap:anywhere}
      [role=status]{padding:9px 10px;background:#eef4ff;border-radius:6px;min-height:38px}[role=status][data-error=true]{background:#fff1f2;color:#9f1239}
      .list{display:grid;gap:6px;max-height:240px;overflow:auto;margin-top:8px}.choice{text-align:left;display:grid;gap:2px;width:100%}.choice[aria-pressed=true]{border-color:#2449bb;background:#eef4ff}
      .report{display:grid;gap:4px;padding:10px;background:white;border:1px solid #dbe3ee;border-radius:7px;margin:10px 0;overflow-wrap:anywhere}
      .field{padding:10px 0;border-top:1px solid #dbe3ee}.check{display:flex;align-items:center;gap:9px;min-height:44px;margin:0}.check input{width:18px;height:18px;flex:none}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.actions button{flex:1 1 160px}
      details{margin-top:10px}summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600}.muted{font-size:13px}
      @media(max-width:560px){section{padding:11px}header{align-items:flex-start}.actions button{flex:1 1 100%}}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
    </style><section><header><div><h2>EduLog 報告預覽</h2><p class="target">正在查詢已記住的學生與日期…</p></div><button class="refresh" type="button">重新核對</button></header><p role="status" aria-live="polite" aria-atomic="true">正在驗證擴充套件連線…</p><div class="result"></div><div class="actions"><button class="connect" type="button" hidden>開啟 EduLog 連線設定</button></div></section>`
    nativeForm.before(host)
    root.querySelector('.refresh').addEventListener('click',()=>void lookup())
    root.querySelector('.connect').addEventListener('click',async event=>{event.currentTarget.disabled=true;try{await globalThis.edulogRuntime.send({type:'open-integration-workspace',flow:'prefill'})}catch(error){status(error.message||'無法開啟整合工作台。',true)}finally{if(event.currentTarget.isConnected)event.currentTarget.disabled=false}})
    void lookup()
  }
  function reportLabel(item){return `${item.student_name || '學生'} · ${item.occurrence_date || '日期待確認'} · ${item.course_name || '課程'} · ${item.completeness?.isMissing?'報告未齊備':'報告已齊備'}`}
  function renderList(items) {
    const box=root.querySelector('.result');box.replaceChildren()
    if(target) box.append(make('p',`目標：${target.studentName || `學生 ${target.studentId?.slice(0,8)||'待確認'}`} · ${target.className || '班級名稱未提供'} · ${target.courseName || '課程名稱未提供'} · 報名 ${target.enrollmentId.slice(0,8)} · ${form.date || '日期待確認'}`,'muted'))
    if(!items.length){box.append(make('p','目前條件沒有可讀取的報告。可搜尋其他學生或日期作為範本。'));renderSearch(box);return}
    const list=make('div',undefined,'list')
    for(const item of items){const button=make('button',undefined,'choice');button.type='button';button.setAttribute('aria-pressed',String(report?.id===item.id));button.append(make('span',reportLabel(item)),make('small',`報名 ${String(item.enrollment_id||'').slice(0,8)} · 更新 ${item.updated_at?new Date(item.updated_at).toLocaleString():'時間未知'}`));button.addEventListener('click',()=>void selectReport(item));list.append(button)}
    box.append(list);renderSearch(box)
  }
  function renderSearch(parent) {
    const details=make('details'),summary=make('summary','搜尋其他學生或日期的報告');details.append(summary)
    const label=make('label','學生、課程或日期關鍵字'),input=make('input');input.type='search';input.maxLength=80;input.autocomplete='off';label.append(input);details.append(label)
    const dates=make('div');dates.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px'
    const fromWrap=make('label','開始日期'),from=make('input');from.type='date';fromWrap.append(from)
    const toWrap=make('label','結束日期'),to=make('input');to.type='date';toWrap.append(to);dates.append(fromWrap,toWrap);details.append(dates)
    const button=make('button','搜尋可讀取報告');button.type='button';details.append(button)
    button.addEventListener('click',()=>void search(input.value,from.value,to.value,button));parent.append(details)
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
      const labels=value?[/完成|completed|是|yes/i]:[/未完成|未|incomplete|no/i]
      return field.options.find(option=>labels[0].test(option.label))?.value||''
    }
    return ''
  }
  async function selectReport(item) {
    const serial=++generation;report=null;status('正在讀取所選報告內容…')
    try{
      const full=await request('detail',{reportId:item.id})
      if(serial!==generation||!host?.isConnected)return
      if(!full)throw new Error('所選報告已無法讀取，請重新搜尋。')
      report=full;renderFields(full)
    }catch(error){if(serial===generation){if(/連接並驗證|請先連接/.test(error.message))root.querySelector('.connect').hidden=false;status(error.message,true)}}
  }
  function renderFields(selected) {
    const box=root.querySelector('.result');box.replaceChildren()
    const mismatch=!target||Boolean(target.enrollmentId&&selected.enrollment_id!==target.enrollmentId)||(selected.student_id&&target.studentId&&selected.student_id!==target.studentId)||(form.date&&selected.occurrence_date!==form.date)
    const identity=make('div',undefined,'report');identity.append(make('strong',reportLabel(selected)))
    identity.append(make('p',mismatch?'範本的學生或日期與原站表單不同。套用前需勾選確認；只會複製欄位，不改變身份對應。':'學生與日期符合目前表單。'))
    if(selected.updated_at)identity.append(make('small',`EduLog 更新時間：${new Date(selected.updated_at).toLocaleString()}`))
    if(selected.external_link){try{const url=new URL(selected.external_link);if(['http:','https:'].includes(url.protocol)){const link=make('a','查看 EduLog 報告 ↗');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';identity.append(link)}}catch{/* A malformed stored URL is not rendered as a link. */}}
    box.append(identity)
    if(target)box.append(make('p',`目前原站目標：${target.studentName||`學生 ${target.studentId?.slice(0,8)||'待確認'}`} · ${target.className||'班級名稱未提供'} · ${target.courseName||'課程名稱未提供'} · 報名 ${target.enrollmentId.slice(0,8)} · ${form.date||'日期待確認'}`,'muted'))
    renderSearch(box)
    const fields=make('div')
    for(const sourceField of form.fields){
      const card=make('div',undefined,'field'),label=make('label',undefined,'check'),check=make('input');check.type='checkbox';check.disabled=sourceField.disabled||sourceField.internal;check.checked=!sourceField.disabled&&!sourceField.internal&&!sourceField.value&&Boolean(suggestion(sourceField,selected));
      label.append(check,make('span',`套用${sourceField.label}${sourceField.internal?'（內部紀錄，預設不套用）':''}`));card.append(label)
      card.append(make('small',`原站目前：${sourceField.options?.find(option=>option.value===sourceField.value)?.label||sourceField.value||'空白'}`))
      const sourceReportValue=sourceField.key==='lesson_id'?contextLesson(selected):sourceField.key==='is_completed'?selected.is_completed?'課程已完成':'課程未完成':sourceField.key==='progress_start'||sourceField.key==='progress_end'?selected.progress_letter||'未填章節':selected[sourceField.key]
      card.append(make('small',`EduLog：${sourceReportValue==null||sourceReportValue===''?'未填寫':String(sourceReportValue)}`))
      const input=make(sourceField.type==='text'?'textarea':'select');input.dataset.value='';input.dataset.key=sourceField.key;input.disabled=sourceField.disabled
      if(sourceField.type==='text'){input.value=suggestion(sourceField,selected)}else{input.append(new Option(suggestion(sourceField,selected)?'已對應建議；請核對':'請人工選擇來源欄位選項',''));for(const option of sourceField.options||[])input.append(new Option(option.label||option.value,option.value));input.value=suggestion(sourceField,selected)}
      const valueLabel=make('label',`預填${sourceField.label}`);valueLabel.append(input);card.append(valueLabel)
      if(sourceField.value){const overwriteLabel=make('label',undefined,'check'),overwrite=make('input');overwrite.type='checkbox';overwrite.dataset.overwrite='';overwriteLabel.append(overwrite,make('span','我確認覆寫目前原站內容'));card.append(overwriteLabel)}
      check.dataset.include='';fields.append(card)
    }
    const matchConfirm=make('label',undefined,'check'),confirm=make('input');confirm.type='checkbox';confirm.dataset.mismatch='';confirm.hidden=!mismatch;matchConfirm.append(confirm,make('span','我已核對，確認使用其他學生或日期的報告作為範本'));if(mismatch)box.append(matchConfirm)
    box.append(fields)
    const internal= form.fields.find(field=>field.internal)
    if(internal){const allowed=make('label',undefined,'check'),check=make('input');check.type='checkbox';check.dataset.internal='';allowed.append(check,make('span','我明確選擇套用內部紀錄'));box.append(allowed);const row=fields.querySelector(`[data-key="${CSS.escape(internal.key)}"]`)?.closest('.field');if(row){const include=row.querySelector('[data-include]');if(include){include.disabled=false;include.addEventListener('change',()=>{if(include.checked)check.checked=true})}}}
    const actions=make('div',undefined,'actions'),apply=make('button','套用已勾選欄位','primary');apply.type='button';actions.append(apply);box.append(actions)
    apply.addEventListener('click',()=>void applyFields(selected,apply))
    status('請檢查學生、日期及每個欄位；原站表單不會自動送出。')
  }
  function contextLesson(selected){return selected.lesson_id?`教材識別碼 ${String(selected.lesson_id).slice(0,8)}（請核對原站選項）`:'未填教材'}
  async function applyFields(selected,button){
    if(button.disabled)return
    const serial=generation;button.disabled=true
    try {
    const current=await adapter.readForm(document)
    if(serial!==generation||!host?.isConnected)return
    if(current.formId!==form.formId||current.fingerprint!==form.fingerprint){status('原站表單內容已改變，請重新核對後再預填。',true);return}
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
    } catch(error){status(error.message,true)}finally{if(button.isConnected)button.disabled=false}
  }
  async function lookup(){
    const serial=++generation
    status('正在驗證連線並查詢這位學生當天的報告…')
    try{
      form=await adapter.readForm(document)
      const result=await request('lookup',{formId:form.formId,fingerprint:form.fingerprint})
      if(serial!==generation||!host?.isConnected)return
      form=result.form;target=result.target;root.querySelector('.target').textContent=`原站報告 ${form.reportId} · ${form.date||'日期未辨識'}${target?' · 已找到報名對應':''}`
      if(!result.connected){root.querySelector('.connect').hidden=false;status('請先連接 EduLog，配對完成後再重新核對。',true);renderList([]);return}
      root.querySelector('.connect').hidden=true
      if(result.reason)status(result.reason,!target)
      else status(result.reports.length===1?'找到一份相符報告。':`已查詢同一日期報告：${result.reports.length} 份。`)
      renderList(result.reports||[])
      if(result.reports?.length===1)await selectReport(result.reports[0])
    }catch(error){if(serial===generation){if(/連接並驗證|請先連接/.test(error.message))root.querySelector('.connect').hidden=false;status(error.message,true)}}
  }
  async function search(searchText,dateFrom,dateTo,button){
    const serial=++generation;if(button.disabled)return;button.disabled=true;status('正在搜尋有權限檢視的 EduLog 報告…')
    try{const result=await request('search',{query:{search:searchText.trim(),date_from:dateFrom||undefined,date_to:dateTo||undefined}});if(serial!==generation||!host?.isConnected)return;report=null;target=target||null;renderList(result.reports||[]);status(`找到 ${result.reports?.length||0} 份報告。其他學生或日期的內容會標示為範本。`)}
    catch(error){if(serial===generation)status(error.message,true)}finally{if(button.isConnected)button.disabled=false}
  }
  function sync(){
    const current=adapter.getForm(document)
    if(!current){host?.remove();host=null;root=null;form=null;target=null;report=null;generation++;return}
    if(host?.isConnected&&host.nextElementSibling===current)return
    host?.remove();host=null;root=null;setup()
  }
  observer=new MutationObserver(records=>{if(records.some(record=>{
    const targetNode=record.target.nodeType===1?record.target:record.target.parentElement
    if(targetNode?.closest('[data-edulog-owned]'))return false
    const changed=[...record.addedNodes,...record.removedNodes].filter(item=>item.nodeType===1&&!item.matches('[data-edulog-owned]')&&!item.closest('[data-edulog-owned]'))
    if(!changed.length)return false
    return targetNode?.closest('.modal,#remote_modal')||changed.some(item=>item.matches('.modal,#remote_modal'))
  }))sync()})
  observer.observe(document.documentElement,{childList:true,subtree:true})
  document.addEventListener('turbo:before-cache',()=>{generation++;host?.remove();host=null;root=null;form=null;target=null;report=null})
  sync()
})()
