import { courseIdentity, admissionIdentity, groupCourses, rankCandidates } from './mapping-core.js'
const $ = id => document.getElementById(id)
const el = (tag,text,cls) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n }
const kinds={student:'students',course:'courses',classroom:'classrooms',class_session:'class_sessions',enrollment:'enrollments',occurrence:'occurrences',report:'report_targets'}
export function createMappingController(hooks) {
  const { run,notice,idFor }=hooks
  const state=()=>hooks.state(), ctx=()=>state().context, work=()=>state().work
  const guard=call=>async(...args)=>{const currentWork=work(),generation=hooks.generation?.(),readGeneration=hooks.readGeneration?.();const result=await call(...args);if(currentWork!==work()||generation!==hooks.generation?.()||readGeneration!==hooks.readGeneration?.()){const error=new Error('查詢已過時，保留目前工作與選擇。');error.code='READ_CANCELLED';throw error}return result}
  const api=guard(hooks.api),catalog=guard(hooks.catalog)
  let groups=[],memories=[],cards=new Map(),confirmed=new Map(),courseConfirmed=new Map(),studentIds=new Map(),cursors=new Map(),candidates=new Map(),enrollmentCursors=new Map(),reportCursors=new Map()
  const link=(kind,key)=>ctx().source_links.find(r=>r.source_kind===kind&&r.source_id===key&&r.valid!==false)
  const memory=(kind,key)=>memories.find(m=>m.kind===kind&&m.key===key&&!m.suggestion)
  const courseName=r=>r.display_name || `${r.subject} ${r.stage}`
  function select(parent,label,id,rows=[],name=r=>r.name,empty='請選擇',extra) {
    const l=el('label',label),s=el('select');s.id=id;s.name=id;l.htmlFor=id;s.autocomplete='off';parent.append(l,s);fill(s,rows,name,empty,extra);return s
  }
  function fill(s,rows,name,empty,extra) {
    const old=s.value;s.replaceChildren(new Option(empty,''));rows.forEach(r=>s.add(new Option(name(r),r.id)));if(extra)s.add(new Option(extra,'new'));s.value=[...s.options].some(o=>o.value===old)?old:''
  }
  function input(parent,label,id,type='text',value='') { const l=el('label',label),n=el('input');n.id=id;n.name=id;n.type=type;n.value=value;n.autocomplete='off';l.htmlFor=id;parent.append(l,n);return n }
  function button(parent,label,action) {const b=el('button',label);b.type='button';b.addEventListener('click',()=>void run(action,{label:`正在${label}`}));parent.append(b);return b}
  function dirty() { $('mapping').dispatchEvent(new Event('input',{bubbles:true})) }
  function ingest(page) {
    for(const t of page.targets||[]) {ctx()[t.kind]||=[];ctx()[t.kind]=[...new Map([...ctx()[t.kind],t].map(r=>[r.id,r])).values()]}
    if(page.memories) memories=[...new Map([...memories,...page.memories].map(r=>[`${r.kind}:${r.key}:${r.source_class_id}`,r])).values()]
  }
  async function resolve(records) {
    memories=[];ctx().source_links=[]
    const refs=[{source_kind:'class_session',source_id:work().snapshot.classId},...records.filter(r=>r.source_id&&kinds[r.kind]).map(r=>({source_kind:r.kind,source_id:r.source_id})),...records.filter(r=>r.source_course_id).map(r=>({source_kind:'course',source_id:r.source_course_id})),...records.filter(r=>r.kind==='report'&&r.date).map(r=>({source_kind:'occurrence',source_id:`${work().snapshot.classId}:${r.date}`}))]
    const unique=[...new Map(refs.map(r=>[`${r.source_kind}:${r.source_id}`,r])).values()]
    for(let i=0;i<unique.length;i+=50) {const p=await api('resolve',{source_class_id:work().snapshot.classId,source_refs:unique.slice(i,i+50),target_refs:[]});ctx().source_links.push(...p.source_links||[]);ingest(p)}
    const mrefs=[{kind:'classroom',key:work().snapshot.classId},...groups.filter(g=>g.key.startsWith('label:')).map(g=>({kind:'course_rule',key:g.key})),...records.filter(r=>r.kind==='enrollment').map(r=>({kind:'admission',key:r.source_id,source_identity:admissionIdentity(r)}))]
    for(let i=0;i<mrefs.length;i+=50)ingest(await api('resolve',{source_class_id:work().snapshot.classId,source_refs:[],target_refs:[],memory_refs:mrefs.slice(i,i+50)}))
    // Resolve an existing enrollment's related targets without loading a directory.
    const savedTargets=(work().uiState||[]).filter(s=>/^[a-f0-9-]{36}$/i.test(s.value)).map(s=>({kind:s.id==='classroom'?'classrooms':s.id==='class-session'?'class_sessions':/^(source-course-|enrollment-course-)/.test(s.id)?'courses':/^student-/.test(s.id)?'students':/^enrollment-/.test(s.id)?'enrollments':/^occurrence-/.test(s.id)?'occurrences':/^report-/.test(s.id)?'report_targets':null,id:s.value})).filter(s=>s.kind)
    const targets=[...savedTargets,...ctx().enrollments.flatMap(e=>[{kind:'students',id:e.student_id},{kind:'courses',id:e.course_id},{kind:'class_sessions',id:e.class_session_id}]),...ctx().class_sessions.map(s=>({kind:'classrooms',id:s.classroom_id}))]
    for(let i=0;i<targets.length;i+=50)ingest(await api('resolve',{source_refs:[],target_refs:targets.slice(i,i+50)}))
  }
  function studentSelect(row) {return $(studentIds.get(row.source_id))}
  const signature=row=>[studentSelect(row)?.value,$(`enrollment-course-${row.source_id}`)?.value,$(`enrollment-${row.source_id}`)?.value,$('class-session').value].join('|')
  function applyFilter() { for(const card of cards.values())card.hidden=$('mapping-filter').value==='pending'&&card.dataset.state==='remembered' }
  function summary() {
    const count={remembered:0,identity:0,pending:0,missing:0,invalid:0}
    for(const r of work().snapshot.records.filter(r=>r.kind==='enrollment')) {
      const card=cards.get(r.source_id);if(!card)continue
      const memo=memory('admission',r.source_id),student=studentSelect(r)?.value,course=$(`enrollment-course-${r.source_id}`)?.value
      const invalid=memo?.valid===false
      const kept=confirmed.get(r.source_id)===signature(r)&&student&&course&&$('class-session').value
      const status=invalid&&!kept?'invalid':kept?'remembered':link('student',r.student_source_id)?.reason==='external_link'||link('enrollment',r.source_id)?.reason==='external_link'?'identity':!r.sourceStudentName||courseIdentity(r).startsWith('missing:')?'missing':'pending'
      card.dataset.state=status;count[status]++
      const text={remembered:'已記住並核對目前關係',identity:'原站連結一致；請確認此報名的學生與課程',pending:'待確認；名稱相同仍需人工核對',missing:'需補資料；請核對原站學生與課程',invalid:'對應已失效或來源課程已改變；請重新確認'}[status]
      card.querySelector('[data-row-state]').textContent=text
    }
    $('mapping-summary').textContent=`已沿用 ${count.remembered} · 可靠識別 ${count.identity} · 待確認 ${count.pending} · 需補資料 ${count.missing} · 失效 ${count.invalid}`
    applyFilter()
  }
  async function versionRefs(items) {
    const refs=items.flatMap(item=>[{kind:item.kind==='course_rule'?'courses':kinds[item.kind]||'enrollments',id:item.target_id},{kind:'students',id:item.student_id},{kind:'courses',id:item.course_id},{kind:'class_sessions',id:item.class_session_id}]).filter(r=>r.id&&r.id!=='new')
    const p=await api('resolve',{source_refs:[],target_refs:[...new Map(refs.map(r=>[`${r.kind}:${r.id}`,r])).values()]});ingest(p)
    const versions=Object.fromEntries((p.targets||[]).map(t=>[t.id,t.target_version]));
    for(const ref of refs)if(!versions[ref.id])throw new Error('目標不存在或已無權限，請重新讀取候選。')
    return versions
  }
  async function confirm(items) {
    const versions=await versionRefs(items)
    await api('confirm',{source_origin:work().snapshot.sourceOrigin,source_class_id:work().snapshot.classId,items:items.map(item=>({...item,action:'confirm',versions}))})
    await resolve(work().snapshot.records)
    notice('對應已保存；下次會先核對目標與權限，再自動帶入。')
  }
  const revision=(kind,key)=>memory(kind,key)?.revision||link(kind,key)?.revision||null
  async function forget(items) {
    if(!window.confirm('清除此對應記憶？已匯入的 EduLog 資料會保留。'))return
    await api('confirm',{source_origin:work().snapshot.sourceOrigin,source_class_id:work().snapshot.classId,items:items.map(item=>({...item,action:'clear'}))});await resolve(work().snapshot.records);notice('記憶已清除；EduLog 資料保留。')
  }
  function newCourseId(g){return idFor(g.sourceId?'course':'course_rule',g.sourceId||g.key)}
  function selectedCourse(g) {const v=$(`source-course-${groups.indexOf(g)}`)?.value;return v==='new'?newCourseId(g):v}
  function courseRows() {
    return groups.filter(g=>$(`source-course-${groups.indexOf(g)}`)?.value==='new').map(g=>{
      const i=groups.indexOf(g),subject=$(`subject-${i}`).value.trim(),stage=$(`stage-${i}`).value.trim()
      if(g.key.startsWith('missing:')||!subject||!stage)throw new Error(`請補齊「${g.label}」的來源課程名稱、科目及階段。`)
      return {source_id:g.sourceId||`work:${newCourseId(g)}`,...(!g.sourceId?{source_rule:g.key}:{}),target_id:selectedCourse(g),overwrite:[],record:{kind:'course',data:{subject,stage}}}
    })
  }
  async function confirmCourse(g) {
    const target=selectedCourse(g);if(!target||$(`source-course-${groups.indexOf(g)}`).value==='new')throw new Error('新建課程會於匯入交易完成時記住；請先補齊新課程欄位。')
    const kind=g.sourceId?'course':'course_rule',key=g.sourceId||g.key
    if(g.key.startsWith('missing:'))throw new Error('原站課程未辨識，不能保存名稱規則；請先補齊可靠來源資料。')
    await confirm([{kind,key,target_id:target,expected_revision:revision(kind,key)}]);courseConfirmed.set(g.key,target);refreshCourses()
    for(const row of g.rows){$(`enrollment-course-${row.source_id}`).value=target;confirmed.delete(row.source_id)}
    const index=groups.indexOf(g)
    $(`course-state-${index}`).textContent='已記住；本班完全相符的課程名稱可沿用。';update();dirty()
    $(`course-group-${index}`).open=false;$(`course-group-${index}`).querySelector('summary').textContent=`${g.label} · ${g.rows.length} 筆報名 · 已記住`
    ;(document.querySelector('.course-group[open] select')||[...cards.values()].find(c=>!c.hidden)?.querySelector('summary')||$('preview')).focus()
  }
  async function confirmRow(row) {
    const student=studentSelect(row).value,course=$(`enrollment-course-${row.source_id}`).value,enrollment=$(`enrollment-${row.source_id}`).value,session=$('class-session').value
    if(!student||!course||!session)throw new Error('請先選擇此報名的學生、課程及目標班級。')
    if(student==='new'||session==='new'||courseRows().some(r=>r.target_id===course))throw new Error('新建資料的記憶會與匯入同交易保存；請先檢查差異。')
    const items=[{kind:'admission',key:row.source_id,source_identity:admissionIdentity(row),student_id:student,course_id:course,class_session_id:session,...(enrollment&&enrollment!=='new'?{target_id:enrollment}:{}),expected_revision:revision('admission',row.source_id)}]
    if(row.student_source_id)items.push({kind:'student',key:row.student_source_id,target_id:student,expected_revision:revision('student',row.student_source_id)})
    await confirm(items);confirmed.set(row.source_id,signature(row));cards.get(row.source_id).open=false;summary();dirty()
    const next=[...cards.values()].find(c=>!c.hidden&&c.dataset.state!=='remembered')
    ;(next?.querySelector('summary')||$('preview')).focus()
  }
  async function destination() {
    const room=$('classroom').value,previous=$('class-session').value
    if(!room){ctx().class_sessions=[];return}
    ctx().permissions=await catalog('permissions',{classroom_id:room})
    const page=await catalog('class_sessions',{classroom_id:room});ctx().class_sessions=[...new Map([...ctx().class_sessions.filter(s=>s.classroom_id===room),...page.items||[]].map(s=>[s.id,s])).values()]
    fill($('class-session'),ctx().class_sessions,s=>s.name,'選擇目標班級',ctx().permissions.classroom?.class_create?'建立新班級…':null)
    if([...$('class-session').options].some(o=>o.value===previous))$('class-session').value=previous
    $('more-sessions').hidden=!page.next_cursor;$('more-sessions').dataset.cursor=page.next_cursor||''
    await hooks.loadMappingCourses(true);refreshCourses();$('new-session').hidden=$('class-session').value!=='new'
  }
  function refreshCourses() {
    for(const [i,g]of groups.entries()) {
      const s=$(`source-course-${i}`);if(!s)continue
      fill(s,rankCandidates(ctx().courses,g.label,courseName),c=>`${courseName(c)} · ${c.subject}／${c.stage}${courseConfirmed.get(g.key)===c.id?' · 已確認':courseName(c)===g.label?' · 名稱相同，待確認':''}`,'選擇此來源課程的目標',!g.key.startsWith('missing:')&&ctx().permissions.course_create?'建立新課程…':null)
    }
    update()
  }
  async function scoped() {
    const session=$('class-session').value
    if(!session||session==='new'){ctx().enrollments=[];ctx().occurrences=[];ctx().report_targets=[];update();return}
    const p=await catalog('permissions',{class_session_id:session});ctx().permissions.session=p.session
    // Related choices are scoped to a single selected class and paginated by row.
    const [enrollments,occurrences]=await Promise.all([catalog('enrollments',{class_session_id:session}),catalog('occurrences',{class_session_id:session,date_from:work().dateFrom,date_to:work().dateTo})])
    ctx().enrollments=[...new Map([...ctx().enrollments.filter(e=>e.class_session_id===session),...enrollments.items||[]].map(e=>[e.id,e])).values()];ctx().occurrences=occurrences.items||[]
    const courses=ctx().class_sessions.find(s=>s.id===session)?.course_ids||[]
    if(courses.length)ingest(await api('resolve',{source_refs:[],target_refs:courses.map(id=>({kind:'courses',id}))}))
    update()
  }
  function createAllowed(kind){return $('class-session').value==='new'?ctx().permissions.classroom?.[`${kind}_create`]:ctx().permissions.session?.[`${kind}_create`]}
  async function studentPage(row,reset=true) {
    const key=row.source_id,s=studentSelect(row),previous=s.value,query=$(`student-search-${key}`).value.trim()||row.sourceStudentName
    if(!query&&!previous)return
    if(reset){cursors.delete(key);candidates.set(key,(candidates.get(key)||[]).filter(c=>c.id===previous))}
    const p=await catalog('students',{search:query,cursor:cursors.get(key)||undefined});if(($(`student-search-${key}`)?.value.trim()||row.sourceStudentName)!==query)return;cursors.set(key,p.next_cursor||'')
    candidates.set(key,[...new Map([...(candidates.get(key)||[]),...p.items||[]].map(r=>[r.id,r])).values()]);$('more-students-'+key).hidden=!p.next_cursor
    fill(s,rankCandidates(candidates.get(key),row.sourceStudentName),c=>`${c.name} · ${c.id.slice(0,8)}${c.name===row.sourceStudentName?' · 名稱相同，待確認':''} ${(c.relationships||[]).slice(0,2).map(r=>`${r.class_name}／${r.course_name}`).join('、')}`,'略過此報名的學生',row.student_source_id&&createAllowed('student')?'建立獨立學生':null)
    update()
  }
  async function enrollmentPage(row) {
    const student=studentSelect(row)?.value,course=$(`enrollment-course-${row.source_id}`)?.value,session=$('class-session').value
    if(!student||student==='new'||!course||!session||session==='new')throw new Error('請先選擇既有學生、課程與班級，再查詢既有報名。')
    const key=`${session}:${student}:${course}`,p=await catalog('enrollments',{class_session_id:session,student_id:student,course_id:course,cursor:enrollmentCursors.get(key)||undefined})
    enrollmentCursors.set(key,p.next_cursor||'');ctx().enrollments=[...new Map([...ctx().enrollments,...p.items||[]].map(e=>[e.id,e])).values()];update();notice(p.items?.length?`已載入 ${p.items.length} 筆既有報名${p.next_cursor?'；可再次載入更多':'，已到清單結尾'}。`:'此學生與課程沒有更多可讀取的報名。')
  }
  function update() {
    if(!work()?.snapshot)return
    for(const r of work().snapshot.records.filter(r=>r.kind==='enrollment')) {
      const student=studentSelect(r);if(!student)continue
      fill(student,candidates.get(r.source_id)||[],c=>`${c.name} · ${c.id.slice(0,8)}${c.name===r.sourceStudentName?' · 名稱相同，待確認':''} ${(c.relationships||[]).slice(0,2).map(t=>`${t.class_name}／${t.course_name}`).join('、')}`,'略過此報名的學生',r.student_source_id&&createAllowed('student')?'建立獨立學生':null)
      const group=groups.find(g=>g.key===courseIdentity(r)),target=selectedCourse(group),course=$(`enrollment-course-${r.source_id}`)
      const extraCourses=courseRowsSafe(),all=[...ctx().courses,...extraCourses]
      const oldCourse=course.value
      fill(course,all,c=>courseName(c),'請確認此報名的課程')
      if(!oldCourse&&target)course.value=target
      const enrollment=$(`enrollment-${r.source_id}`),saved=memory('admission',r.source_id)
      const matches=ctx().enrollments.filter(e=>e.student_id===student.value&&e.course_id===course.value&&e.class_session_id===$('class-session').value)
      fill(enrollment,matches,e=>`${e.start_date||'日期未填'} · ${e.status} · ${e.id.slice(0,8)}`,'略過此報名',createAllowed('enrollment')?'建立新報名':null)
      const existing=ctx().enrollments.find(e=>e.id===enrollment.value)
      const more=$(`more-enrollments-${r.source_id}`),queryKey=`${$('class-session').value}:${student.value}:${course.value}`
      if(more){more.disabled=enrollmentCursors.has(queryKey)&&!enrollmentCursors.get(queryKey);more.textContent=more.disabled?'既有報名已載入完畢':'查詢既有報名／載入更多'}
      if(existing){$(`start-${r.source_id}`).value=existing.start_date||'';$(`status-${r.source_id}`).value=existing.status||''}
      if(saved?.valid&&saved.class_session_id===$('class-session').value&&saved.student_id===student.value&&saved.course_id===course.value&&!enrollment.value) {
        if(saved.target_id)enrollment.value=saved.target_id
      }
    }
    for(const r of work().snapshot.records.filter(r=>r.kind==='report'&&r.date&&r.data.content)) {
      const occurrence=$(`occurrence-${r.date}`),report=$(`report-${r.source_id}`)
      if(occurrence){fill(occurrence,ctx().occurrences.filter(o=>o.class_session_id===$('class-session').value&&o.occurrence_date===r.date),o=>`${o.occurrence_date} · ${o.id.slice(0,8)}`,'略過此課次',createAllowed('occurrence')?'建立新課次':null);if(!occurrence.value)occurrence.value=link('occurrence',`${work().snapshot.classId}:${r.date}`)?.target_id||''}
      const e=$(`enrollment-${r.enrollment_source_id}`)?.value,o=occurrence?.value
      if(report){fill(report,ctx().report_targets.filter(t=>t.enrollment_id===e&&t.class_occurrence_id===o),t=>`既有報告 · ${t.id.slice(0,8)}`,'略過此報告',createAllowed('report')?'建立新報告':null);if(!report.value)report.value=link('report',r.source_id)?.target_id||''}
      const more=$(`more-reports-${r.source_id}`),queryKey=`${e}:${o}`
      if(more){more.disabled=reportCursors.has(queryKey)&&!reportCursors.get(queryKey);more.textContent=more.disabled?`報告 ${r.source_id} 的候選已載入完畢`:`查詢報告 ${r.source_id} 的既有對應／載入更多`}
    }
    summary()
  }
  function courseRowsSafe(){return groups.filter(g=>$(`source-course-${groups.indexOf(g)}`)?.value==='new').map(g=>({id:newCourseId(g),display_name:g.label,subject:'新建課程',stage:''}))}
  async function mount() {
    groups=groupCourses(work().snapshot.records);cards=new Map();confirmed=new Map();courseConfirmed=new Map();studentIds=new Map();cursors=new Map();candidates=new Map();enrollmentCursors=new Map();reportCursors=new Map()
    await resolve(work().snapshot.records);await hooks.loadClassrooms(false)
    const rememberedSession=ctx().class_sessions.find(s=>s.id===link('class_session',work().snapshot.classId)?.target_id),room=memory('classroom',work().snapshot.classId)
    $('classroom').value=work().uiState?.find(s=>s.id==='classroom')?.value||rememberedSession?.classroom_id||room?.target_id||''
    await destination();$('class-session').value=work().uiState?.find(s=>s.id==='class-session')?.value||rememberedSession?.id||''
    $('session-name').value=work().snapshot.title;$('new-session').hidden=$('class-session').value!=='new';await scoped()
    $('course-mappings').replaceChildren();$('student-mappings').replaceChildren();$('report-mappings').replaceChildren();$('source-issues').replaceChildren()
    for(const [i,g]of groups.entries()) {
      const c=el('details',undefined,'course-group');c.id=`course-group-${i}`;c.open=true;c.append(el('summary',`${g.label} · ${g.rows.length} 筆報名`))
      const s=select(c,'EduLog 課程',`source-course-${i}`,ctx().courses,courseName,'選擇目標課程',!g.key.startsWith('missing:')&&ctx().permissions.course_create?'建立新課程…':null)
      const memo=g.sourceId?link('course',g.sourceId):memory('course_rule',g.key),hint=el('p',memo?.valid!==false&&memo?.target_id?'已記住本班課程對應':'待確認；名稱相同只提供建議','mapping-reason');hint.id=`course-state-${i}`;c.append(hint)
      if(memo?.valid!==false&&memo?.target_id){s.value=memo.target_id;courseConfirmed.set(g.key,memo.target_id);c.open=false;c.querySelector('summary').textContent+= ' · 已記住'}
      const cross=memories.find(m=>m.kind==='course_rule'&&m.key===g.key&&m.suggestion&&m.valid)
      if(cross)c.append(el('p',`其他班級曾選：${courseName(ctx().courses.find(c=>c.id===cross.target_id)||{})}；本班需重新確認。`,'hint'))
      const fields=el('div');fields.id=`new-course-fields-${i}`;fields.hidden=true;input(fields,'新課程科目',`subject-${i}`);input(fields,'新課程階段',`stage-${i}`);c.append(fields)
      s.addEventListener('change',()=>{fields.hidden=s.value!=='new';courseConfirmed.delete(g.key);hint.textContent=s.value==='new'?'新課程與本班名稱規則將在匯入交易成功後一起記住。':'已修改；請確認並記住後套用本班。';if(s.value==='new')for(const row of g.rows){$(`enrollment-course-${row.source_id}`).value='';confirmed.delete(row.source_id)}update();dirty()})
      button(c,'確認並記住此課程',()=>confirmCourse(g));button(c,'清除此課程記憶',async()=>{await forget([{kind:g.sourceId?'course':'course_rule',key:g.sourceId||g.key,expected_revision:revision(g.sourceId?'course':'course_rule',g.sourceId||g.key)}]);courseConfirmed.delete(g.key);c.querySelector('summary').textContent=`${g.label} · ${g.rows.length} 筆報名 · 待確認`;hint.textContent='記憶已清除；下次需要確認。';dirty()})
      $('course-mappings').append(c)
    }
    refreshCourses()
    const seenStudents=new Set()
    for(const r of work().snapshot.records.filter(r=>r.kind==='enrollment')) {
      const c=el('details',undefined,'row-card mapping-row');c.open=true;cards.set(r.source_id,c)
      const heading=el('summary',`${r.sourceStudentName||work().snapshot.records.find(s=>s.kind==='student'&&s.source_id===r.student_source_id)?.data.name||'姓名尚未辨識'} · ${r.sourceCourseLabel||'課程未辨識'} · 報名 ${r.source_id}`),reason=el('p',undefined,'mapping-reason');reason.dataset.rowState='';c.append(heading,reason)
      const columns=el('div',undefined,'mapping-comparison'),left=el('div'),right=el('div');left.append(el('h3','來源'),el('p',`學生：${r.sourceStudentName||'未辨識'} · ${r.student_source_id?'ID '+r.student_source_id:'無學生 ID；只記住本筆報名'}`),el('p',`課程：${r.sourceCourseLabel||'未辨識'}`));right.append(el('h3','EduLog'));columns.append(left,right);c.append(columns)
      const studentId=r.student_source_id&&!seenStudents.has(r.student_source_id)?`student-${r.student_source_id}`:`student-for-${r.source_id}`;seenStudents.add(r.student_source_id);studentIds.set(r.source_id,studentId)
      const memo=memory('admission',r.source_id),existing=ctx().enrollments.find(e=>e.id===link('enrollment',r.source_id)?.target_id)
      const selectedStudent=work().uiState?.find(s=>s.id===studentId)?.value||(memo?.valid&&memo.class_session_id===$('class-session').value?memo.student_id:existing?.student_id||link('student',r.student_source_id)?.target_id)
      const s=select(right,'目標學生',studentId,ctx().students,c=>`${c.name} · ${c.id.slice(0,8)}`,'略過此報名的學生',r.student_source_id&&createAllowed('student')?'建立獨立學生':null);s.value=selectedStudent||''
      candidates.set(r.source_id,ctx().students.filter(t=>t.id===selectedStudent));const search=input(right,'搜尋學生候選',`student-search-${r.source_id}`,'search',r.sourceStudentName||'')
      const more=button(right,'載入更多學生候選',()=>studentPage(r,false));more.id=`more-students-${r.source_id}`;more.hidden=true
      let timer;search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>void run(()=>studentPage(r,true),{readOnly:true,label:'正在查詢學生候選'}),300)})
      const cs=select(right,'此筆報名的課程',`enrollment-course-${r.source_id}`,ctx().courses,courseName,'請確認目標課程');cs.value=memo?.valid?memo.course_id:existing?.course_id||''
      const es=select(right,'既有／新建報名',`enrollment-${r.source_id}`,ctx().enrollments,e=>e.id.slice(0,8),'略過此報名',createAllowed('enrollment')?'建立新報名':null);es.value=memo?.valid?memo.target_id||'':existing?.id||''
      button(right,'查詢既有報名／載入更多',()=>enrollmentPage(r)).id=`more-enrollments-${r.source_id}`
      input(right,'報名開始日期',`start-${r.source_id}`,'date',existing?.start_date||r.data.start_date||'')
      const status=select(right,'報名狀態',`status-${r.source_id}`,[{id:'regular',name:'正式'},{id:'trial',name:'試讀'},{id:'completed',name:'完課'},{id:'dropped',name:'退班'}],r=>r.name,'請確認狀態');status.value=existing?.status||r.data.status||''
      const error=el('p',undefined,'mapping-error');error.id=`mapping-error-${r.source_id}`;error.setAttribute('role','status');right.append(error)
      button(right,'確認並記住此報名',async()=>{error.textContent='';try{await confirmRow(r)}catch(e){error.textContent=e.message;throw e}})
      button(right,'修改對應',async()=>{confirmed.delete(r.source_id);c.open=true;s.focus();summary()})
      button(right,'略過此報名',async()=>{s.value='';es.value='';confirmed.delete(r.source_id);summary();dirty()})
      button(right,'清除此報名記憶',async()=>{await forget([{kind:'admission',key:r.source_id,expected_revision:revision('admission',r.source_id)}]);confirmed.delete(r.source_id);summary();dirty()})
      if(r.student_source_id)button(right,'清除此學生 ID 對應',async()=>{await forget([{kind:'student',key:r.student_source_id,expected_revision:revision('student',r.student_source_id)}]);notice('學生 ID 對應已清除；各筆已確認的報名記憶仍保留。');dirty()})
      for(const control of [s,cs,es])control.addEventListener('change',()=>{confirmed.delete(r.source_id);if(control===s&&r.student_source_id)for(const peer of work().snapshot.records.filter(p=>p.kind==='enrollment'&&p.student_source_id===r.student_source_id&&p.source_id!==r.source_id)){const other=studentSelect(peer);if(other&&other.value!==s.value){candidates.set(peer.source_id,candidates.get(r.source_id)||[]);fill(other,candidates.get(peer.source_id),c=>`${c.name} · ${c.id.slice(0,8)}`,'略過此報名的學生',createAllowed('student')?'建立獨立學生':null);other.value=s.value;confirmed.delete(peer.source_id)}}update();dirty()})
      $('student-mappings').append(c)
      if(memo?.valid&&memo.class_session_id===$('class-session').value){confirmed.set(r.source_id,signature(r));c.open=false}
      // Candidate data is fetched only when its row is opened or explicitly searched.
      c.addEventListener('toggle',()=>{if(c.open&&!candidates.get(r.source_id)?.length)void run(()=>studentPage(r,true),{readOnly:true,label:'正在查詢學生候選'})})
      button(right,'查詢學生候選',()=>studentPage(r,true))
      if(!r.student_source_id)left.append(el('p','可以選擇既有學生；不能僅依姓名建立或合併學生。','hint'))
    }
    const dates=new Set()
    for(const r of work().snapshot.records.filter(r=>r.kind==='report'&&r.date&&r.data.content&&r.date>=work().dateFrom&&r.date<=work().dateTo)) {
      if(!dates.has(r.date)){dates.add(r.date);const occurrence=select($('report-mappings'),`${r.date} 課次`,`occurrence-${r.date}`);occurrence.addEventListener('change',()=>{update();dirty()});button($('report-mappings'),`查詢 ${r.date} 的既有課次`,async()=>{const s=$('class-session').value;if(!s||s==='new')throw new Error('請先選擇既有班級。');const p=await catalog('occurrences',{class_session_id:s,date_from:r.date,date_to:r.date});ctx().occurrences=[...new Map([...ctx().occurrences,...p.items||[]].map(o=>[o.id,o])).values()];update();notice(`已查詢 ${r.date} 的既有課次。`)})}
      select($('report-mappings'),`報告 ${r.source_id}`,`report-${r.source_id}`)
      button($('report-mappings'),`查詢報告 ${r.source_id} 的既有對應／載入更多`,async()=>{const e=$(`enrollment-${r.enrollment_source_id}`)?.value,s=$('class-session').value,o=$(`occurrence-${r.date}`)?.value;if(!e||e==='new'||!s||s==='new'||!o||o==='new')throw new Error('請先確認既有報名與課次。');const key=`${e}:${o}`,p=await catalog('report_targets',{class_session_id:s,enrollment_id:e,class_occurrence_id:o,cursor:reportCursors.get(key)||undefined});reportCursors.set(key,p.next_cursor||'');ctx().report_targets=[...new Map([...ctx().report_targets,...p.items||[]].map(t=>[t.id,t])).values()];update();notice(p.next_cursor?'已載入報告候選，可繼續載入。':'已到報告候選清單結尾。')}).id=`more-reports-${r.source_id}`
    }
    update()
    for(const saved of work().uiState||[]){const n=$(saved.id);if(n?.closest('#mapping')){n.value=saved.value;if(n.type==='checkbox')n.checked=saved.checked}}
    for(const [i]of groups.entries())$(`new-course-fields-${i}`).hidden=$(`source-course-${i}`).value!=='new'
    update();summary();$('mapping-filter').value=work().uiState?.find(s=>s.id==='mapping-filter')?.value||'pending';applyFilter()
  }
  async function confirmDestination() {
    const room=$('classroom').value,session=$('class-session').value
    if(!room||!session||session==='new')throw new Error('新班級的對應會隨建立保存；既有班級請先選擇教室與班級。')
    await confirm([{kind:'classroom',key:work().snapshot.classId,target_id:room,expected_revision:revision('classroom',work().snapshot.classId)},{kind:'class_session',key:work().snapshot.classId,target_id:session,expected_revision:revision('class_session',work().snapshot.classId)}]);dirty()
  }
  function validateRow(r) {
    const s=studentSelect(r)?.value,c=$(`enrollment-course-${r.source_id}`)?.value
    if(!s||!c)return false
    if(s!=='new'&&$('class-session').value!=='new'&&!courseRowsSafe().some(t=>t.id===c)&&confirmed.get(r.source_id)!==signature(r)) {
      const e=$(`mapping-error-${r.source_id}`);e.textContent='請先確認並記住此報名的學生與課程。';cards.get(r.source_id).hidden=false;cards.get(r.source_id).open=true;studentSelect(r).focus();throw new Error(`${r.sourceStudentName||'報名 '+r.source_id} 的對應尚未確認。`)
    }
    return true
  }
  $('mapping-filter').addEventListener('change',applyFilter)
  $('reload-memories').addEventListener('click',()=>void run(async()=>{await mount();notice('已重新檢查記憶、目標權限及關係；目前輸入仍保留。')},{readOnly:true,label:'正在重新檢查對應記憶'}))
  for(const [id,kind]of[['forget-session','class_session'],['forget-classroom','classroom']])$(id).addEventListener('click',()=>void run(async()=>{await forget([{kind,key:work().snapshot.classId,expected_revision:revision(kind,work().snapshot.classId)}]);dirty()},{label:'正在清除對應記憶'}))
  $('remember-destination').addEventListener('click',()=>void run(confirmDestination,{label:'正在保存教室與班級對應'}))
  $('more-sessions').addEventListener('click',()=>void run(async()=>{const old=$('class-session').value,p=await catalog('class_sessions',{classroom_id:$('classroom').value,cursor:$('more-sessions').dataset.cursor});ctx().class_sessions.push(...p.items||[]);fill($('class-session'),ctx().class_sessions,s=>s.name,'選擇目標班級',ctx().permissions.classroom?.class_create?'建立新班級…':null);$('class-session').value=old;$('more-sessions').hidden=!p.next_cursor;$('more-sessions').dataset.cursor=p.next_cursor||''},{readOnly:true,label:'正在載入更多班級'}))
  return {mount,resolve,destination,scoped,update,refreshCourses,courseRows,studentSelect,validateRow,selectedCourseIds:()=>[...new Set(work().snapshot.records.filter(r=>r.kind==='enrollment'&&studentSelect(r)?.value).map(r=>$(`enrollment-course-${r.source_id}`)?.value).filter(Boolean))]}
}
