// Extension-owned comparison components; provider text is rendered as text only.
const phrases={
  'diff.source':['來源','Source'],'diff.target':['EduLog','EduLog'],
  'diff.same':['一致','Same'],'diff.changed':['內容不同','Different content'],
  'diff.blank':['未填','Not filled'],'diff.result':['同步後內容','Content after sync'],
  'diff.keep':['保留 EduLog','Keep EduLog'],'diff.sourceDecision':['採用來源','Use source'],
  'diff.skip':['不同步','Do not sync'],'diff.text':['文字差異：刪除／新增','Text changes: removed / added'],
  'diff.removed':['刪除內容','Removed text'],'diff.added':['新增內容','Added text'],
  'diff.raw':['原始值','Raw values'],
  'diff.value':['{value}','{value}'],'diff.resultValue':['{decision} · {value}','{decision} · {value}'],
  'outcome.saved':['已保存歷史','History saved'],'outcome.bound':['已綁定課次','Sessions linked'],
  'outcome.kept':['保留原值','Existing values kept'],'outcome.skipped':['明確略過','Explicitly skipped'],
  'outcome.failed':['寫入失敗','Write failed'],'outcome.pending':['仍需處理','Still needs review'],
}
globalThis.edulogUi?.register(phrases)
function make(doc,tag,text,key){const el=doc.createElement(tag);if(key&&globalThis.edulogUi)globalThis.edulogUi.text(el,key);else if(text!==undefined)el.textContent=text;return el}
export function semanticValue(key,value,lookup=()=>null) {
  const en=globalThis.edulogUi?.locale==='en'
  if(value==null||value==='')return en?'Not filled':'未填'
  if(key==='is_completed')return value===true?(en?'Completed':'已完成'):value===false?(en?'Incomplete':'未完成'):String(value)
  if(key==='attendance_status')return ({present:en?'Present':'出席',absent:en?'Absent':'不出席',pending:en?'Pending':'待確認'})[value]||String(value)
  if(['class_participation','classroom_behavior'].includes(key))return `${value} ${en?'stars':'星'}`
  if(key==='lesson_id'){const lesson=lookup(value);if(lesson)return `${Number.isFinite(lesson.sequence)?'Lesson '+lesson.sequence:(en?'Sequence not provided':'序號未提供')} · ${lesson.title||lesson.name||lesson.display_name||''}`}
  return String(value)
}
// A bounded LCS keeps unchanged paragraphs readable. Long content falls back to
// two complete changed blocks rather than blocking the UI or truncating evidence.
export function paragraphChanges(before,after) {
  if(before===after)return [{kind:'same',text:before}]
  const a=String(before).split('\n'),b=String(after).split('\n')
  if(a.length*b.length>40000)return [{kind:'removed',text:String(before)},{kind:'added',text:String(after)}]
  const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1))
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1])
  const changes=[];let i=0,j=0
  while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j])changes.push({kind:'same',text:a[i++]}),j++;else if(j<b.length&&(i===a.length||dp[i][j+1]>dp[i+1][j]))changes.push({kind:'added',text:b[j++]});else changes.push({kind:'removed',text:a[i++]})}
  return changes
}
export function comparison(doc,{label,source,target,sourceDisplay,targetDisplay,text=false}) {
  const root=make(doc,'section');root.className='review-comparison';root.append(make(doc,'h4',label))
  const sides=make(doc,'div');sides.className='review-sides'
  for(const [key,value] of [['diff.source',sourceDisplay??(()=>semanticValue('',source))],['diff.target',targetDisplay??(()=>semanticValue('',target))]]){const side=make(doc,'div');side.append(make(doc,'strong',phrases[key][0],key));const content=make(doc,'p',typeof value==='function'?value():value);content.dataset.sourceRaw='true';content.setAttribute('translate','no');if(globalThis.edulogUi)globalThis.edulogUi.text(content,'diff.value',()=>({value:typeof value==='function'?value():value}));side.append(content);sides.append(side)}
  root.append(sides)
  const same=JSON.stringify(source)===JSON.stringify(target),state=make(doc,'p',same?'一致':'內容不同',same?'diff.same':'diff.changed');state.className=same?'diff-same':'diff-changed';root.append(state)
  if(text&&!same){const diff=make(doc,'div');diff.className='text-diff';diff.dataset.sourceRaw='true';diff.append(make(doc,'strong',phrases['diff.text'][0],'diff.text'));for(const part of paragraphChanges(String(target??''),String(source??''))){const row=make(doc,part.kind==='removed'?'del':part.kind==='added'?'ins':'span',part.text||'（空白）');if(part.kind!=='same'){const key=part.kind==='removed'?'diff.removed':'diff.added';if(globalThis.edulogUi)globalThis.edulogUi.text(row,key,{},'aria-label');else row.setAttribute('aria-label',phrases[key][0])}diff.append(row)}root.append(diff)}
  return root
}
export function decisionResult(root,value,decision) {
  let result=root.querySelector('[data-diff-result]');if(!result){result=make(root.ownerDocument,'div');result.className='diff-result';result.dataset.diffResult='';result.append(make(root.ownerDocument,'strong',phrases['diff.result'][0],'diff.result'),make(root.ownerDocument,'p'));root.append(result)}
  const key=decision==='skip'?'diff.skip':decision==='source'?'diff.sourceDecision':'diff.keep'
  result.lastChild.dataset.sourceRaw='true';if(globalThis.edulogUi)globalThis.edulogUi.text(result.lastChild,'diff.resultValue',()=>({decision:globalThis.edulogUi.t(key),value:typeof value==='function'?value():value}));else result.lastChild.textContent=`${phrases[key][0]} · ${typeof value==='function'?value():value}`
}
export function outcomeMetrics(host,values){const doc=host.ownerDocument,grid=make(doc,'dl');grid.className='outcome-metrics';for(const [key,value] of Object.entries(values)){const tile=make(doc,'div'),number=make(doc,'dd',String(value));globalThis.edulogUi?.text(number,'diff.value',{value});tile.append(make(doc,'dt',phrases['outcome.'+key]?.[0]||key,'outcome.'+key),number);grid.append(tile)}host.append(grid)}
