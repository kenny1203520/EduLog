// Reused in the shadow assistant and trusted workbench. Never auto-confirms rules.
(() => {
  const make = (doc,tag,text) => { const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n }
  const choices = (field,report,extra=[]) => {
    const m=globalThis.edulogFieldMappings
    if(field.key==='attendance_status')return Object.entries(m.attendance)
    if(field.key==='absence_reason')return Object.entries(m.reasons).filter(([k])=>!['holiday','suspension'].includes(k))
    if(field.key==='is_completed')return [[true,'課程已完成'],[false,'課程未完成']]
    if(['class_participation','classroom_behavior'].includes(field.key))return Array.from({length:11},(_,i)=>[i/2,`${i/2} 星`])
    if(field.key.startsWith('progress_'))return Array.from({length:26},(_,i)=>[String.fromCharCode(65+i),String.fromCharCode(65+i)])
    if(field.key==='lesson_id')return extra.length?extra.map(l=>[l.id,l.title]):report.lesson_id?[[report.lesson_id,report.lesson_name||`教材 #${report.lesson_id.slice(0,8)}`]]:[]
    return []
  }
  function attach(parent,field,report,rules,options) {
    if(field.type==='text'||field.key==='learning_status')return
    const doc=parent.ownerDocument,m=globalThis.edulogFieldMappings,box=make(doc,'details'),summary=make(doc,'summary','欄位映射：查看／修改記憶');box.className='field-mapping-memory';box.append(summary)
    const feedback=make(doc,'p');feedback.className='field-mapping-status';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite')
    if(!options.enabled){feedback.textContent=options.reason||'升級 EduLog 至 1000124 並確認報名後，可跨裝置記住映射。';box.append(feedback);parent.append(box);return}
    const source=make(doc,'select'),canonical=make(doc,'select'),values=choices(field,report,options.lessons)
    source.name=`mapping-source-${field.key}`;canonical.name=`mapping-value-${field.key}`;source.autocomplete=canonical.autocomplete='off'
    for(const o of field.options.filter(o=>!o.disabled&&o.value!=='')){const n=make(doc,'option',o.label||o.value);n.value=o.value;source.append(n)}
    for(const rule of rules.filter(r=>r.field_key===field.key&&!Array.from(source.options).some(o=>o.value===r.source_value))){const n=make(doc,'option',`已失效選項：${rule.source_value}（可清除）`);n.value=rule.source_value;source.append(n)}
    source.value=options.sourceValue||field.value||m.suggest(field,report,rules)
    const prompt=make(doc,'option','請選擇 EduLog 意義');prompt.value='';canonical.append(prompt)
    for(const [v,label] of values){const n=make(doc,'option',label);n.value=JSON.stringify(v);canonical.append(n)}
    const lab=make(doc,'label','原站選項');lab.append(source);const target=make(doc,'label','對應的 EduLog 意義');target.append(canonical)
    const actions=make(doc,'div');actions.className='field-mapping-actions';const save=make(doc,'button','確認並記住映射'),clear=make(doc,'button','清除此映射');save.type=clear.type='button';actions.append(save,clear)
    let unknown=false
    const current=()=>rules.find(r=>r.field_key===field.key&&r.source_value===source.value)
    const writable=()=>!unknown&&!field.disabled&&field.options.some(o=>o.value===source.value&&!o.disabled)&&canonical.value!==''
    function refresh(){const remembered=current();const value=remembered?.canonical_value??m.reportValue(field,report);canonical.value=value===undefined?'':JSON.stringify(value);feedback.textContent=remembered?(remembered.valid===false||remembered.options_signature!==m.signature(field)?'選項已改變，舊記憶暫不沿用；請重新確認或清除。':'已記住此選項；來源選項改變後需重新確認。'):'尚未保存；建議須由您確認。';clear.disabled=unknown||!remembered;save.disabled=!writable()}
    async function send(action){if(save.disabled&&action==='confirm'||clear.disabled&&action==='clear')return;const before=source.value,expected=current()?.revision||null;source.disabled=canonical.disabled=save.disabled=clear.disabled=true;feedback.textContent='正在保存欄位映射…';const slow=setTimeout(()=>{if(box.isConnected)feedback.textContent='回應較慢，仍在等待；目前選擇保留。'},10000)
      try{const response=await options.confirm({field_key:field.key,options_signature:m.signature(field),source_value:before,action,expected_revision:expected,...(action==='confirm'?{canonical_value:JSON.parse(canonical.value)}:{})});if(!box.isConnected||options.isCurrent?.()===false)return;for(let i=rules.length-1;i>=0;i--)if(rules[i].field_key===field.key&&rules[i].source_value===before)rules.splice(i,1);if(action==='confirm')rules.push(...response.items.filter(r=>!r.cleared));refresh();feedback.textContent=action==='clear'?'已清除映射；原站內容保留。':'已記住；匯入與預填會分別驗證可用方向。';options.changed?.(rules)}
      catch(e){unknown=['API_TIMEOUT','API_NETWORK_ERROR','API_RESPONSE_INVALID'].includes(e.code);if(box.isConnected)feedback.textContent=unknown?'保存結果尚未確認。請使用重新核對後再試，不要重複保存。':`${e.message} 請重新核對後重試。`}
      finally{clearTimeout(slow);if(box.isConnected){source.disabled=canonical.disabled=false;save.disabled=!writable();clear.disabled=unknown||!current()}}
    }
    source.addEventListener('change',refresh);canonical.addEventListener('change',()=>save.disabled=!writable());save.addEventListener('click',()=>void send('confirm'));clear.addEventListener('click',()=>void send('clear'));box.append(lab,target,feedback,actions);parent.append(box);refresh()
  }
  globalThis.edulogFieldMappingUI=Object.freeze({attach,choices})
})()
