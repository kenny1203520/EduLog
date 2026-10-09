import { createMappingView, evidenceDetails } from './mapping-view.js'
import { enrollmentLabel, enrollmentStatuses, mergeEvidence, sourceUrl, frontendUrl, scheduleLabel, sessionLabel, enrollmentDifferences, canMapEnrollmentAcrossSession, legacyCourse, reportMatchesReconciliation } from './mapping-presentation.js'
import { courseIdentity, admissionIdentity, classifyAdmissionIdentityChange, groupCourses, rankCandidates } from './mapping-core.js'
import { attachImportFields } from './import-field-mappings.js'
const $ = id => document.getElementById(id)
const el = (tag,text,cls) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n }
const kinds={student:'students',course:'courses',classroom:'classrooms',class_session:'class_sessions',enrollment:'enrollments',occurrence:'occurrences',report:'report_targets'}
export function createMappingController(hooks) {
  const { run,notice:globalNotice,idFor }=hooks
  const state=()=>hooks.state(), ctx=()=>state().context, work=()=>state().work
  const guard=call=>async(...args)=>{const currentWork=work(),generation=hooks.generation?.(),readGeneration=hooks.readGeneration?.();const result=await call(...args);if(currentWork!==work()||generation!==hooks.generation?.()||readGeneration!==hooks.readGeneration?.()){const error=new Error('查詢已過時，保留目前工作與選擇。');error.code='READ_CANCELLED';throw error}return result}
  const api=guard(hooks.api),catalog=guard(hooks.catalog)
  let groups=[],memories=[],cards=new Map(),confirmed=new Map(),courseConfirmed=new Map(),studentIds=new Map(),studentSplits=new Set(),cursors=new Map(),candidates=new Map(),enrollmentCursors=new Map(),reportCursors=new Map()
  let mounting=false, localPanel=null, courseOverrides=new Set()
  const reconciliationChecks=new Map(), querySequences=new Map()
  const capable=()=>hooks.capabilities?.()?.student_enrollment_catalog === true
  const skipped=r=>work().skippedAdmissions?.includes(r.source_id)
  const rowKey=r=>`${studentSelect(r)?.value}:${$(`enrollment-course-${r.source_id}`)?.value}:${$('class-session').value}:${admissionIdentity(r)}`
  function feedbackFor(panel,b){return b?.dataset.enrollmentAction ? panel.querySelector('[data-enrollment-status]') : panel.querySelector('.mapping-feedback')}
  const view=createMappingView({work,context:ctx,settingsUrl:()=>hooks.settingsUrl?.(),changed:dirty,queryStudent:r=>{
    const originalWork=work(),panel=cards.get(r.source_id)
    const query=()=>{if(work()!==originalWork||!panel?.isConnected||panel.hidden||candidates.get(r.source_id)?.length)return;if(localPanel){setTimeout(query,300);return}void localTask(()=>studentPage(r,true),panel.querySelector('[data-query-student]'))}
    query()
  }})
  function notice(message,error=false){const n=localPanel?.querySelector('.mapping-feedback');if(n){n.textContent=message;n.dataset.state=error?'error':'complete'}else globalNotice(message,error)}
  const link=(kind,key)=>ctx().source_links.find(r=>r.source_kind===kind&&r.source_id===key&&r.valid!==false)
  const memory=(kind,key)=>memories.find(m=>m.kind===kind&&m.key===key&&!m.suggestion)
  const courseName=r=>r.display_name || `${r.subject} ${r.stage}`
  function select(parent,label,id,rows=[],name=r=>r.name,empty='請選擇',extra) {
    const l=el('label',label),s=el('select');s.id=id;s.name=id;s.dataset.sourceRawOptions='true';l.htmlFor=id;s.autocomplete='off';parent.append(l,s);fill(s,rows,name,empty,extra);return s
  }
  function fill(s,rows,name,empty,extra) {
    const old=s.value;s.replaceChildren(new Option(empty,''));rows.forEach(r=>s.add(new Option(name(r),r.id)));if(extra)s.add(new Option(extra,'new'));s.value=[...s.options].some(o=>o.value===old)?old:''
  }
  function input(parent,label,id,type='text',value='') { const l=el('label',label),n=el('input');n.id=id;n.name=id;n.type=type;n.value=value;n.autocomplete='off';l.htmlFor=id;parent.append(l,n);return n }
  async function localTask(action,b) {
    if(b?.getAttribute('aria-disabled')==='true')return
    const panel=b?.closest('.course-group,.mapping-row')
    if(!panel)return run(action,{label:'正在查詢對應資料'})
    if(localPanel){const feedback=panel.querySelector('.mapping-feedback');if(panel!==localPanel&&feedback){feedback.dataset.state='loading';feedback.textContent='另一筆對應正在處理，完成後可再操作此項目。'}return}
    const activeWork=work(),n=feedbackFor(panel,b),original=b.textContent,writing=/^(確認|清除)/.test(original)
    localPanel=panel;panel.setAttribute('aria-busy','true');b.setAttribute('aria-disabled','true');b.textContent=/^確認/.test(original)?'正在保存…':'正在處理…'
    const peers=[...document.querySelectorAll('.mapping-row')].filter(p=>panel.classList.contains('course-group')&&p.dataset.courseKey===panel.dataset.courseKey||panel.dataset.studentKey&&p.dataset.studentKey===panel.dataset.studentKey)
    const locked=writing?[...new Set([...panel.querySelectorAll('input,select,textarea'),...peers.flatMap(p=>[...p.querySelectorAll('input,select,textarea')]),...['classroom','class-session','source-tab','collect','preview','repreview','reload-memories','reread-source','remember-destination','forget-session','forget-classroom'].map($)])].filter(Boolean).map(node=>[node,node.disabled]):[];locked.forEach(([node])=>node.disabled=true)
    if(n){n.dataset.state='loading';n.textContent=/^確認/.test(original)?'正在核對目標並保存對應…':'正在讀取對應資料…'}
    const timer=setTimeout(()=>{if(n)n.textContent='回應較慢，仍在等待 EduLog。請保留目前工作。'},10000)
    try {await action();if(activeWork===work()&&n?.dataset.state==='loading'){n.dataset.state='complete';n.textContent='操作完成；目前選擇已保留。'}}
    catch(error){if(activeWork===work()){const unknown=['API_TIMEOUT','API_NETWORK_ERROR'].includes(error.code)&&/^確認/.test(original);if(unknown)panel.dataset.saveUnknown='true';if(n){n.dataset.state=unknown?'unknown':'error';n.textContent=unknown?'保存結果尚未確認。請使用「重新檢查對應記憶」核對，勿重複保存。':error.message}panel.dataset.failed='true'}}
    finally {clearTimeout(timer);locked.forEach(([node,disabled])=>{if(node.isConnected)node.disabled=disabled});b.removeAttribute('aria-disabled');b.textContent=original;panel.removeAttribute('aria-busy');localPanel=null;if(activeWork===work()){update();view.refresh()}}
  }
  function button(parent,label,action) {const b=el('button',label);b.type='button';b.dataset.originalLabel=label;b.addEventListener('click',()=>void localTask(action,b));parent.append(b);return b}
  function dirty() { hooks.mappingChanged?.() }
  function ingest(page) {
    if(page.source_links)ctx().source_links=[...new Map([...ctx().source_links,...page.source_links].map(r=>[`${r.source_kind}:${r.source_id}`,r])).values()]
    for(const t of page.targets||[]) {ctx()[t.kind]||=[];ctx()[t.kind]=[...new Map([...ctx()[t.kind],t].map(r=>[r.id,r])).values()]}
    if(page.memories) memories=[...new Map([...memories,...page.memories].map(r=>[`${r.kind}:${r.key}:${r.source_class_id}`,r])).values()]
  }
  async function resolve(records) {
    memories=[];ctx().source_links=[]
    const refs=[{source_kind:'class_session',source_id:work().snapshot.classId},...records.filter(r=>r.source_id&&kinds[r.kind]).map(r=>({source_kind:r.kind,source_id:r.source_id})),...records.filter(r=>r.source_course_id).map(r=>({source_kind:'course',source_id:r.source_course_id})),...records.filter(r=>r.kind==='report'&&r.date).map(r=>({source_kind:'occurrence',source_id:`${work().snapshot.classId}:${r.date}`}))]
    const unique=[...new Map(refs.map(r=>[`${r.source_kind}:${r.source_id}`,r])).values()]
    for(let i=0;i<unique.length;i+=50) {const p=await api('resolve',{source_class_id:work().snapshot.classId,source_refs:unique.slice(i,i+50),target_refs:[]});ingest(p)}
    const mrefs=[{kind:'classroom',key:work().snapshot.classId},...groups.filter(g=>g.key.startsWith('label:')).map(g=>({kind:'course_rule',key:g.key})),...records.filter(r=>r.kind==='enrollment').map(r=>({kind:'admission',key:r.source_id,source_identity:admissionIdentity(r),source_course_id:r.source_course_id,source_course_label:r.sourceCourseLabel}))]
    for(let i=0;i<mrefs.length;i+=50)ingest(await api('resolve',{source_class_id:work().snapshot.classId,source_refs:[],target_refs:[],memory_refs:mrefs.slice(i,i+50)}))
    // Resolve an existing enrollment's related targets without loading a directory.
    const savedTargets=(work().uiState||[]).filter(s=>/^[a-f0-9-]{36}$/i.test(s.value)).map(s=>({kind:s.id==='classroom'?'classrooms':s.id==='class-session'?'class_sessions':/^(source-course-|enrollment-course-)/.test(s.id)?'courses':/^student-/.test(s.id)?'students':/^enrollment-/.test(s.id)?'enrollments':/^occurrence-/.test(s.id)?'occurrences':/^report-/.test(s.id)?'report_targets':null,id:s.value})).filter(s=>s.kind)
    const targets=[...savedTargets,...ctx().enrollments.flatMap(e=>[{kind:'students',id:e.student_id},{kind:'courses',id:e.course_id},{kind:'class_sessions',id:e.class_session_id}]),...ctx().class_sessions.map(s=>({kind:'classrooms',id:s.classroom_id}))]
    for(let i=0;i<targets.length;i+=50)ingest(await api('resolve',{source_refs:[],target_refs:targets.slice(i,i+50)}))
  }
  function studentSelect(row) {return $(studentIds.get(row.source_id))}
  function baseStudentGroupKey(row) {
    if(row.student_source_id)return `student:${row.student_source_id}`
    const name=String(row.sourceStudentName||'').trim()
    return name?`name:${name}`:`admission:${row.source_id}`
  }
  function studentGroupKey(row) {return studentSplits.has(row.source_id)?`admission:${row.source_id}`:baseStudentGroupKey(row)}
  const signature=row=>[studentSelect(row)?.value,$(`enrollment-course-${row.source_id}`)?.value,$(`enrollment-${row.source_id}`)?.value,$('class-session').value].join('|')
  function memoryMatchesAdmission(memo,student,course,selectedEnrollment) {
    if(!memo?.valid||memo.student_id!==student||memo.course_id!==course)return false
    const target=selectedEnrollment&&selectedEnrollment!=='new'?ctx().enrollments.find(e=>e.id===selectedEnrollment):ctx().enrollments.find(e=>e.id===memo.target_id)
    return target?target.id===memo.target_id&&target.student_id===memo.student_id&&target.course_id===memo.course_id&&target.class_session_id===memo.class_session_id:memo.class_session_id===$('class-session').value
  }
  function applyFilter() {if(!mounting)view.refresh()}
  function summary() {
    const count={remembered:0,identity:0,pending:0,missing:0,invalid:0,verification:0,conflict:0,legacy:0}
    for(const r of work().snapshot.records.filter(r=>r.kind==='enrollment')) {
      const card=cards.get(r.source_id);if(!card)continue
      const memo=memory('admission',r.source_id),student=studentSelect(r)?.value,course=$(`enrollment-course-${r.source_id}`)?.value
      const legacy=legacyCourse(r,work().snapshot),conflict=r.sourceStudentConflict||r.sourceCourseConflict||r.sourceIdentityChanged
      const kept=confirmed.get(r.source_id)===signature(r)&&student&&course&&$('class-session').value
      const status=skipped(r)?'skipped':legacy?'legacy':conflict||['source_identity_changed','target_relationship_changed'].includes(memo?.reason)?'conflict':memo?.reason==='target_unavailable'||memo?.reason==='identity_unverified'?'verification':memo?.valid===false?'invalid':kept?'remembered':link('student',r.student_source_id)?.reason==='external_link'||link('enrollment',r.source_id)?.reason==='external_link'?'identity':!r.sourceStudentName||courseIdentity(r).startsWith('missing:')?'missing':'pending'
      card.dataset.state=status;if(status in count)count[status]++
      const text={skipped:'保留 EduLog；此筆與相關報告已略過',remembered:'已記住並核對目前關係',identity:'原站連結一致；請確認此報名的學生與課程',pending:'待確認；名稱相同仍需人工核對',missing:'需補資料；請核對原站學生與課程',invalid:'記憶無法沿用；請檢查對應與版本',verification:'目前無法驗證；已保留選擇，請重查後再同步',conflict:'來源身份或課程有矛盾；請核對原文',legacy:'舊工作資料需補讀後才能核對'}[status]
      card.querySelector('[data-row-state]').textContent=text
      card.dataset.reason=status
    }
    $('mapping-summary').textContent=`已核對 ${count.remembered} · 可靠識別 ${count.identity} · 待確認 ${count.pending} · 需補資料 ${count.missing} · 待驗證 ${count.verification} · 衝突 ${count.conflict} · 記憶需重核 ${count.invalid} · 舊資料需補讀 ${count.legacy}`
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
    const saved=await api('confirm',{source_origin:work().snapshot.sourceOrigin,source_class_id:work().snapshot.classId,items:items.map(item=>({...item,action:'confirm',versions}))})
    for(const item of items){const result=saved.items?.find(r=>r.kind===item.kind&&r.key===item.key);if(!result?.revision){const reliable=['student','course','class_session','enrollment'].includes(item.kind);ingest(await api('resolve',{source_class_id:work().snapshot.classId,source_refs:reliable?[{source_kind:item.kind,source_id:item.key}]:[],target_refs:[],memory_refs:reliable?[]:[{kind:item.kind,key:item.key,source_identity:item.source_identity}]}));continue}
      ingest({memories:[{...item,source_class_id:work().snapshot.classId,revision:result.revision,valid:true}]})
      if(['student','course','class_session','enrollment','admission'].includes(item.kind)&&item.target_id){const kind=item.kind==='admission'?'enrollment':item.kind;ctx().source_links=ctx().source_links.filter(r=>r.source_kind!==kind||r.source_id!==item.key);ctx().source_links.push({source_origin:work().snapshot.sourceOrigin,source_kind:kind,source_id:item.key,target_id:item.target_id,revision:result.revision,valid:true,reason:'remembered'})}
    }
    notice('對應已保存；下次會先核對目標與權限，再自動帶入。')
  }
  const revision=(kind,key)=>memory(kind,key)?.revision||link(kind,key)?.revision||null
  async function forget(items) {
    if(!window.confirm('清除此對應記憶？已匯入的 EduLog 資料會保留。'))return false
    await api('confirm',{source_origin:work().snapshot.sourceOrigin,source_class_id:work().snapshot.classId,items:items.map(item=>({...item,action:'clear'}))});for(const item of items){memories=memories.filter(m=>m.kind!==item.kind||m.key!==item.key);ctx().source_links=ctx().source_links.filter(r=>r.source_kind!==(item.kind==='admission'?'enrollment':item.kind)||r.source_id!==item.key)}notice('記憶已清除；EduLog 資料保留。');return true
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
    if(g.rows.some(r=>legacyCourse(r,work().snapshot)))throw new Error('舊工作可能把年級當成課程，請先補讀來源資料。')
    const target=selectedCourse(g);if(!target||$(`source-course-${groups.indexOf(g)}`).value==='new')throw new Error('新建課程會於匯入交易完成時記住；請先補齊新課程欄位。')
    const kind=g.sourceId?'course':'course_rule',key=g.sourceId||g.key
    if(g.key.startsWith('missing:'))throw new Error('原站課程未辨識，不能保存名稱規則；請先補齊可靠來源資料。')
    await confirm([{kind,key,target_id:target,expected_revision:revision(kind,key)}]);courseConfirmed.set(g.key,target);refreshCourses()
    let affected=0;for(const row of g.rows){const c=$(`enrollment-course-${row.source_id}`);if(!courseOverrides.has(row.source_id)&&!confirmed.has(row.source_id)&&c.value!==target){c.value=target;confirmed.delete(row.source_id);affected++}}
    const index=groups.indexOf(g)
    $(`course-state-${index}`).textContent='已記住；本班完全相符的課程名稱可沿用。';update();dirty()
    notice(`已記住此課程；更新 ${affected} 筆尚未個別設定的報名。`);$(`course-group-${index}`).open=true;$(`course-group-${index}`).querySelector('summary').textContent=`${g.label} · ${g.rows.length} 筆報名 · 已記住`
    view.refresh()
  }
  async function confirmRow(row) {
    const student=studentSelect(row).value,course=$(`enrollment-course-${row.source_id}`).value,enrollment=$(`enrollment-${row.source_id}`).value,session=$('class-session').value
    if(!student||!course||!session)throw new Error('請先選擇此報名的學生、課程及目標班級。')
    assertReconciled(row)
    if(student==='new'||session==='new'||courseRows().some(r=>r.target_id===course))throw new Error('新建資料的記憶會與匯入同交易保存；請先檢查差異。')
    const targetEnrollment=enrollment&&enrollment!=='new'?ctx().enrollments.find(e=>e.id===enrollment):null
    if(targetEnrollment&&targetEnrollment.class_session_id!==session&&!hooks.capabilities?.()?.transferred_occurrence_import)throw new Error('目前連線無法核對跨班單次調課；請重新檢查連線，或先在 EduLog 核對報名關係。')
    const enrollmentSession=targetEnrollment?.class_session_id||session
    const items=[{kind:'admission',key:row.source_id,source_identity:admissionIdentity(row),student_id:student,course_id:course,class_session_id:enrollmentSession,...(enrollment&&enrollment!=='new'?{target_id:enrollment}:{}),expected_revision:revision('admission',row.source_id)}]
    if(row.student_source_id&&!studentSplits.has(row.source_id))items.push({kind:'student',key:row.student_source_id,target_id:student,expected_revision:revision('student',row.student_source_id)})
    await confirm(items);row.sourceIdentityChanged=false;row.sourceStudentNameConflict=false;row.sourceStudentConflict=false;work().skippedAdmissions=(work().skippedAdmissions||[]).filter(id=>id!==row.source_id);confirmed.set(row.source_id,signature(row));cards.get(row.source_id).open=true;summary();dirty()
    notice('已記住此報名；來源與目標關係已核對。')
  }
  async function destination() {
    const room=$('classroom').value,previous=$('class-session').value
    if(!room){ctx().class_sessions=[];return}
    ctx().permissions=await catalog('permissions',{classroom_id:room})
    const page=await catalog('class_sessions',{classroom_id:room});ctx().class_sessions=[...new Map([...ctx().class_sessions.filter(s=>s.classroom_id===room),...page.items||[]].map(s=>[s.id,s])).values()]
    fill($('class-session'),ctx().class_sessions,sessionLabel,'選擇目標班級',ctx().permissions.classroom?.class_create?'建立新班級…':null)
    if([...$('class-session').options].some(o=>o.value===previous))$('class-session').value=previous
    $('more-sessions').hidden=!page.next_cursor;$('more-sessions').dataset.cursor=page.next_cursor||''
    await hooks.loadMappingCourses(true);refreshCourses();$('new-session').hidden=$('class-session').value!=='new'
  }
  function refreshCourses() {
    for(const [i,g]of groups.entries()) {
      const s=$(`source-course-${i}`);if(!s)continue
      fill(s,rankCandidates(ctx().courses,g.label,courseName),c=>`${courseName(c)} · #${c.id.slice(0,8)}`,'選擇此來源課程的目標',!g.key.startsWith('missing:')&&ctx().permissions.course_create?'建立新課程…':null)
    }
    update()
  }
  async function scoped() {
    reconciliationChecks.clear();enrollmentCursors.clear()
    const session=$('class-session').value
    if(!session||session==='new'){ctx().enrollments=[];ctx().occurrences=[];ctx().report_targets=[];update();return}
    const p=await catalog('permissions',{class_session_id:session});ctx().permissions.session=p.session
    // Related choices are scoped to a single selected class and paginated by row.
    const [enrollments,occurrences]=await Promise.all([catalog('enrollments',{class_session_id:session}),catalog('occurrences',{class_session_id:session,date_from:work().dateFrom,date_to:work().dateTo})])
    ctx().enrollments=[...new Map([...ctx().enrollments,...enrollments.items||[]].map(e=>[e.id,e])).values()];ctx().occurrences=occurrences.items||[]
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
    ctx().students=[...new Map([...ctx().students,...p.items||[]].map(r=>[r.id,r])).values()];candidates.set(key,[...new Map([...(candidates.get(key)||[]),...p.items||[]].map(r=>[r.id,r])).values()]);$('more-students-'+key).hidden=!p.next_cursor
    fill(s,rankCandidates(candidates.get(key),row.sourceStudentName),c=>`${c.name} · #${c.id.slice(0,8)}`,'略過此報名的學生',row.student_source_id&&createAllowed('student')?'建立獨立學生':null)
    update()
  }
  function assertReconciled(row) {
    if(skipped(row))throw new Error('此筆已略過；請先恢復對應。')
    if(legacyCourse(row,work().snapshot))throw new Error('此工作可能把年級當成課程，請先補讀來源資料。')
    if(row.sourceStudentConflict||row.sourceCourseConflict||row.sourceIdentityChanged)throw new Error('來源課程或學生 ID 有矛盾，請核對原文並確認後再繼續。')
    const memo=memory('admission',row.source_id)
    if(memo?.reason==='target_unavailable'||memo?.reason==='identity_unverified')throw new Error('目前無法驗證原對應；請重查目標權限與報名後再繼續。')
    if(memo?.valid===false)throw new Error('原對應記憶與目前來源不一致，請重新核對並記住此報名。')
    const value=$(`enrollment-${row.source_id}`).value,student=studentSelect(row).value,course=$(`enrollment-course-${row.source_id}`).value,session=$('class-session').value
    const target=ctx().enrollments.find(e=>e.id===value)
    if(target&&!canMapEnrollmentAcrossSession(target,{student,course}))throw new Error('既有報名的學生或課程不一致。請選擇正確報名，或略過此筆。')
    if(value&&value!=='new'&&!target)throw new Error('既有報名資料未核對，請重新查詢。')
    if(value==='new') {
      if(student!=='new'&&!capable())throw new Error('目前連線未提供跨班報名查詢；請重新檢查連線，確認後再建立報名。')
      if(student!=='new'&&(!reconciliationChecks.has(student)||enrollmentCursors.get(student)!==''))throw new Error('請先查完此學生的既有報名，再確認是否需要新建。')
      if(ctx().enrollments.some(e=>e.student_id===student&&e.class_session_id===session&&e.course_id===course))throw new Error('已有符合的報名，請選用既有報名。')
      if(!$(`review-${row.source_id}`)?.checked)throw new Error('請核對兩邊資料並勾選確認需要建立獨立報名。')
    }
  }
  function enrollmentLink(parent,label,id) {
    const url=frontendUrl(hooks.settingsUrl?.(),`/dashboard/reports/${id}`)
    if(!url){parent.append(el('p','尚未取得可靠前端網址，請重新檢查連線。','hint'));return}
    const a=el('a',`${label} ↗`,'mapping-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label',`${label}（新分頁）`);parent.append(a)
  }
  function renderEnrollmentCandidates(row) {
    const box=$(`enrollment-results-${row.source_id}`);if(!box)return
    const student=studentSelect(row).value,course=$(`enrollment-course-${row.source_id}`).value,session=$('class-session').value
    const rows=ctx().enrollments.filter(e=>e.student_id===student).sort((a,b)=>enrollmentDifferences(a,{student,course,session}).length-enrollmentDifferences(b,{student,course,session}).length||a.id.localeCompare(b.id))
    const key=JSON.stringify([student,course,session,rows,work().reconciliation?.[row.source_id]])
    if(box.dataset.signature===key)return
    const active=document.activeElement,activeId=box.contains(active)?active.id:null
    box.dataset.signature=key;box.replaceChildren()
    for(const e of rows) {
      const differences=enrollmentDifferences(e,{student,course,session}),card=el('section',undefined,'enrollment-candidate')
      const compatible=canMapEnrollmentAcrossSession(e,{student,course})
      card.append(el('strong',`${e.course_name||ctx().courses.find(c=>c.id===e.course_id)?.display_name||'課程資料未提供'} · ${enrollmentLabel(e)}`),el('p',e.class_session?sessionLabel(e.class_session):`班級 #${e.class_session_id.slice(0,8)} · 時段待核對`,'hint'),el('p',differences.length?compatible?'報名所屬班次不同；報名關係不變，依各堂日期核對。':`${differences.join('、')}；請核對或選擇其他報名。`:'符合目前學生、班級與課程。',differences.length?'mapping-warning':'hint'))
      enrollmentLink(card,'前往 EduLog 核對／處理異動',e.id)
      const details=work().reconciliation?.[row.source_id]?.[e.id]
      if(details) {
        card.append(el('p',details.note||'以下為可讀取的單次調課紀錄。','hint'))
        for(const t of details.transfers||[])card.append(el('p',`${t.cancelled_at?'已取消':t.is_effective_target?'目前有效的單次調課':'後續已有調課'}：${t.source_class_session?.name||'來源班級'} ${t.source_date} → ${t.target_class_session?.name||'目標班級'} ${t.target_date}${!t.cancelled_at&&t.is_effective_target&&t.target_class_session_id===session?' · 此日期適用目前班次':''}`,'hint'))
        if(!(details.transfers||[]).length)card.append(el('p','沒有可讀取的單次調課紀錄；不能據此判定未曾轉班。','hint'))
      }
      if(canMapEnrollmentAcrossSession(e,{student,course})){const use=button(card,differences.includes('班級不一致')?'使用此報名（逐堂核對）':'使用符合的既有報名',()=>{const choice=$(`enrollment-${row.source_id}`);choice.value=e.id;choice.dispatchEvent(new Event('change',{bubbles:true}));notice(differences.includes('班級不一致')?'已選擇原班次報名；報名關係不變，後續逐堂核對調課。':'已選擇既有報名；請核對並記住對應。')});use.dataset.enrollmentAction='true';use.id=`use-${row.source_id}-${e.id}`}
      if(hooks.capabilities?.()?.enrollment_reconciliation){const check=button(card,details?.next_cursor?'載入更多調課紀錄':'核對此報名的調課紀錄',()=>reconcileEnrollment(row,e.id,Boolean(details?.next_cursor)));check.dataset.enrollmentAction='true';check.id=`reconcile-${row.source_id}-${e.id}`}
      box.append(card)
    }
    if(activeId)$(activeId)?.focus({preventScroll:true})
  }
  async function reconcileEnrollment(row,enrollmentId,more=false) {
    const key=rowKey(row),sequence=(querySequences.get(row.source_id)||0)+1;querySequences.set(row.source_id,sequence)
    const previous=work().reconciliation?.[row.source_id]?.[enrollmentId]
    const p=await api('reconcile',undefined,{enrollmentId,query:{limit:50,...(more&&previous?.next_cursor?{cursor:previous.next_cursor}:{})}})
    if(key!==rowKey(row)||sequence!==querySequences.get(row.source_id))return
    const before=ctx().enrollments.find(e=>e.id===enrollmentId)
    const relationshipChanged=before&&['student_id','course_id','class_session_id','target_version','version'].some(k=>before[k]!==p.enrollment[k])
    ctx().enrollments=[...ctx().enrollments.filter(e=>e.id!==enrollmentId),p.enrollment]
    work().reconciliation||={};work().reconciliation[row.source_id]||={};work().reconciliation[row.source_id][enrollmentId]={...p,transfers:more?[...previous.transfers,...p.transfers]:p.transfers}
    if(relationshipChanged)confirmed.delete(row.source_id);update();summary();dirty();const n=$(`enrollment-status-${row.source_id}`);n.textContent=relationshipChanged?'目標關係已改變，請重新確認。':'已重新核對報名與調課；有效的確認保留。';n.dataset.state='complete'
  }
  async function enrollmentPage(row,reset=false) {
    const student=studentSelect(row)?.value,course=$(`enrollment-course-${row.source_id}`)?.value,session=$('class-session').value
    if(!student||student==='new')throw new Error('請先選擇既有學生，再查詢既有報名。')
    if(!capable()&&(!course||!session||session==='new'))throw new Error('目前連線未提供跨班報名查詢；請選擇目標課程與班級後重試。')
    const key=capable()?student:`${session}:${student}:${course}`,selection=rowKey(row),sequence=(querySequences.get(row.source_id)||0)+1;querySequences.set(row.source_id,sequence)
    if(reset)enrollmentCursors.delete(key)
    const p=await catalog('enrollments',{student_id:student,...(capable()?{}:{class_session_id:session,course_id:course}),cursor:enrollmentCursors.get(key)||undefined})
    if(selection!==rowKey(row)||sequence!==querySequences.get(row.source_id))return
    enrollmentCursors.set(key,p.next_cursor||'');ctx().enrollments=[...new Map([...(reset?ctx().enrollments.filter(e=>e.student_id!==student):ctx().enrollments),...p.items||[]].map(e=>[e.id,e])).values()];reconciliationChecks.set(student,true);update();summary();dirty()
    const n=$(`enrollment-status-${row.source_id}`),total=ctx().enrollments.filter(e=>e.student_id===student).length
    n.textContent=capable()?`已讀取 ${total} 筆可存取報名${p.next_cursor?'；可載入更多':'，已到清單結尾'}。${total?'請核對班級、課程與異動情況。':'沒有可讀取的報名，不代表其他權限範圍沒有資料。'}`:'目前只完成所選班級／課程查詢；跨班報名尚未核對。可重新檢查連線。';n.dataset.state='complete'
  }
  function update() {
    if(!work()?.snapshot)return
    const session=ctx().class_sessions.find(s=>s.id===$('class-session').value)
    let sessionInfo=$('session-selection-info')
    if(!sessionInfo){sessionInfo=el('div',undefined,'session-selection-info');sessionInfo.id='session-selection-info';$('class-session').after(sessionInfo)}
    const sessionKey=JSON.stringify(session)+hooks.settingsUrl?.();if(sessionInfo.dataset.signature!==sessionKey){sessionInfo.dataset.signature=sessionKey;sessionInfo.replaceChildren();if(session){sessionInfo.append(el('p',`${session.name} · ${scheduleLabel(session)} · ${session.time_zone||'時區未提供'}`,'hint'));const url=frontendUrl(hooks.settingsUrl?.(),`/dashboard/classrooms/session/${session.id}`);if(url){const a=el('a','查看 EduLog 班級 ↗','mapping-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';sessionInfo.append(a)}}}
    for(const r of work().snapshot.records.filter(r=>r.kind==='enrollment')) {
      const student=studentSelect(r);if(!student)continue
      fill(student,candidates.get(r.source_id)||[],c=>`${c.name} · #${c.id.slice(0,8)}`,'略過此報名的學生',r.student_source_id&&createAllowed('student')?'建立獨立學生':null)
      const group=groups.find(g=>g.key===courseIdentity(r)),target=selectedCourse(group),course=$(`enrollment-course-${r.source_id}`)
      const extraCourses=courseRowsSafe(),all=[...ctx().courses,...extraCourses]
      const oldCourse=course.value
      fill(course,all,c=>`${courseName(c)} · #${c.id.slice(0,8)}`,'請確認此報名的課程')
      if(!oldCourse&&target)course.value=target
      const enrollment=$(`enrollment-${r.source_id}`),saved=memory('admission',r.source_id)
      const matches=ctx().enrollments.filter(e=>canMapEnrollmentAcrossSession(e,{student:student.value,course:course.value}))
      const retained=ctx().enrollments.find(e=>e.id===(enrollment.value||saved?.target_id||link('enrollment',r.source_id)?.target_id))
      const options=retained&&!matches.some(e=>e.id===retained.id)?[...matches,retained]:matches
      fill(enrollment,options,e=>`${enrollmentDifferences(e,{student:student.value,course:course.value,session:$('class-session').value}).length?'差異待核對 · ':''}${enrollmentLabel(e)}`,'請選擇既有報名或明確新建',createAllowed('enrollment')?'建立新報名（需核對）':null)
      const existing=ctx().enrollments.find(e=>e.id===enrollment.value)
      const more=$(`more-enrollments-${r.source_id}`),queryKey=capable()?student.value:`${$('class-session').value}:${student.value}:${course.value}`
      if(more&&!more.hasAttribute('aria-disabled')){more.disabled=!student.value||student.value==='new'||enrollmentCursors.has(queryKey)&&!enrollmentCursors.get(queryKey);more.textContent=enrollmentCursors.has(queryKey)?enrollmentCursors.get(queryKey)?'載入更多既有報名':'既有報名已查詢完畢':'查詢既有報名'}
      if(existing&&enrollment.dataset.lastSelected!==existing.id){$(`start-${r.source_id}`).value=existing.start_date||'';$(`status-${r.source_id}`).value=existing.status||'';enrollment.dataset.lastSelected=existing.id}
      if(memoryMatchesAdmission(saved,student.value,course.value,saved?.target_id)&&!enrollment.value) {
        if(saved.target_id)enrollment.value=saved.target_id
      }
      const error=$(`mapping-error-${r.source_id}`),differences=existing?enrollmentDifferences(existing,{student:student.value,course:course.value,session:$('class-session').value}):[]
      const incompatible=existing&&!canMapEnrollmentAcrossSession(existing,{student:student.value,course:course.value})
      if(incompatible||legacyCourse(r,work().snapshot)||r.sourceIdentityChanged){confirmed.delete(r.source_id);if(error){error.dataset.reconciliation='true';error.textContent=legacyCourse(r,work().snapshot)?'舊工作可能把年級當成課程，請補讀來源資料。':incompatible?`${differences.join('、')}；請核對或略過，不會自動轉班或改寫課程。`:'來源身份已改變，請重新確認。'}}
      else if(error?.dataset.reconciliation){error.textContent='';delete error.dataset.reconciliation}
      renderEnrollmentCandidates(r)
    }
    for(const r of work().snapshot.records.filter(r=>r.kind==='report'&&r.source_id&&r.date&&!r.identityUnverified&&r.sourceReadStatus!=='failed')) {
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
    mounting=true;reconciliationChecks.clear();querySequences.clear();courseOverrides=new Set(work().mappingView?.courseOverrides||[]);studentSplits=new Set(work().mappingView?.studentSplits||[]);groups=groupCourses(work().snapshot.records);cards=new Map();confirmed=new Map();courseConfirmed=new Map();studentIds=new Map();cursors=new Map();candidates=new Map();enrollmentCursors=new Map();reportCursors=new Map()
    await resolve(work().snapshot.records);await hooks.loadClassrooms(false)
    for(const r of work().snapshot.records.filter(r=>r.kind==='enrollment'))if(memory('admission',r.source_id)?.reason==='identity_enriched'&&memory('admission',r.source_id)?.valid){r.sourceIdentityChanged=false;r.sourceStudentConflict=false;r.sourceCourseConflict=false;for(const report of work().snapshot.records.filter(row=>row.kind==='report'&&row.enrollment_source_id===r.source_id))report.sourceStudentIdentityConflict=Boolean(report.student_source_id&&r.student_source_id&&report.student_source_id!==r.student_source_id)}
    const rememberedSession=ctx().class_sessions.find(s=>s.id===link('class_session',work().snapshot.classId)?.target_id),room=memory('classroom',work().snapshot.classId)
    $('classroom').value=work().uiState?.find(s=>s.id==='classroom')?.value||rememberedSession?.classroom_id||room?.target_id||''
    await destination();$('class-session').value=work().uiState?.find(s=>s.id==='class-session')?.value||rememberedSession?.id||''
    $('session-name').value=work().snapshot.title;$('new-session').hidden=$('class-session').value!=='new';await scoped()
    $('course-mappings').replaceChildren();$('student-mappings').replaceChildren();$('report-mappings').replaceChildren();$('source-issues').replaceChildren()
    for(const [i,g]of groups.entries()) {
      const c=el('details',undefined,'course-group');c.id=`course-group-${i}`;c.dataset.courseKey=g.key;c.open=true;c.append(el('summary',`${g.label} · ${g.rows.length} 筆報名`))
      const s=select(c,'EduLog 課程',`source-course-${i}`,ctx().courses,courseName,'選擇目標課程',!g.key.startsWith('missing:')&&ctx().permissions.course_create?'建立新課程…':null)
      const memo=g.rows.some(r=>legacyCourse(r,work().snapshot))?null:g.sourceId?link('course',g.sourceId):memory('course_rule',g.key),hint=el('p',memo?.valid!==false&&memo?.target_id?'已記住本班課程對應':'待確認；名稱相同只提供建議','mapping-reason');hint.id=`course-state-${i}`;c.append(hint)
      if(memo?.valid!==false&&memo?.target_id){s.value=memo.target_id;courseConfirmed.set(g.key,memo.target_id);c.open=false;c.querySelector('summary').textContent+= ' · 已記住'}
      const cross=memories.find(m=>m.kind==='course_rule'&&m.key===g.key&&m.suggestion&&m.valid)
      if(cross)c.append(el('p',`其他班級曾選：${courseName(ctx().courses.find(c=>c.id===cross.target_id)||{})}；本班需重新確認。`,'hint'))
      const fields=el('div');fields.id=`new-course-fields-${i}`;fields.hidden=true;input(fields,'新課程科目',`subject-${i}`);input(fields,'新課程階段',`stage-${i}`);c.append(fields)
      s.addEventListener('change',()=>{fields.hidden=s.value!=='new';courseConfirmed.delete(g.key);hint.textContent=s.value==='new'?'新課程與本班名稱規則將在匯入交易成功後一起記住。':'已修改；請確認並記住後套用本班。';if(s.value==='new')for(const row of g.rows){$(`enrollment-course-${row.source_id}`).value='';confirmed.delete(row.source_id)}update();dirty()})
      button(c,'確認並記住此課程',()=>confirmCourse(g));button(c,'清除此課程記憶',async()=>{if(!await forget([{kind:g.sourceId?'course':'course_rule',key:g.sourceId||g.key,expected_revision:revision(g.sourceId?'course':'course_rule',g.sourceId||g.key)}]))return;courseConfirmed.delete(g.key);c.querySelector('summary').textContent=`${g.label} · ${g.rows.length} 筆報名 · 待確認`;hint.textContent='記憶已清除；下次需要確認。';dirty()})
      $('course-mappings').append(c)
    }
    refreshCourses()
    const seenStudents=new Set(),seenStudentGroups=new Set()
    for(const r of work().snapshot.records.filter(r=>r.kind==='enrollment')) {
      const c=el('details',undefined,'row-card mapping-row');c.dataset.courseKey=courseIdentity(r);c.dataset.studentKey=r.student_source_id||'';c.open=true;cards.set(r.source_id,c)
      const heading=el('summary',`${r.sourceStudentName||work().snapshot.records.find(s=>s.kind==='student'&&s.source_id===r.student_source_id)?.data.name||'姓名尚未辨識'} · ${r.sourceCourseLabel||'課程未辨識'} · 報名 ${r.source_id}`),reason=el('p',undefined,'mapping-reason');reason.dataset.rowState='';c.append(heading,reason)
        const columns=el('div',undefined,'mapping-comparison'),left=el('div'),right=el('div');left.append(el('h3','來源'),el('p',`學生：${r.sourceStudentName||'未辨識'} · ${r.student_source_id?'ID '+r.student_source_id:'無學生 ID；只記住本筆報名'}`),el('p',`課程：${r.sourceCourseLabel||'未辨識'}`));if(r.sourceGrade)left.append(el('p',`年級：${r.sourceGrade}`,'hint'));if(r.sourceCourseConflict)left.append(el('p','來源課程資料互相矛盾，請展開原文核對。','mapping-warning'));if(r.sourceStudentConflict)left.append(el('p',`來源學生 ID 互相矛盾：${(r.sourceStudentIdConflictValues||[]).join(' · ')}。請核對原文後再確認。`,'mapping-warning'));else if(r.sourceStudentNameConflict)left.append(el('p',`來源姓名文字有差異：${(r.sourceStudentNameConflictValues||[]).join(' · ')}。學生 ID 相同時會保留既有對應，不會改寫 EduLog 姓名。`,'hint'));right.append(el('h3','EduLog'));columns.append(left,right);c.append(columns)
      const studentId=!seenStudentGroups.has(studentGroupKey(r))&&r.student_source_id?`student-${r.student_source_id}`:`student-for-${r.source_id}`;seenStudents.add(r.student_source_id);seenStudentGroups.add(studentGroupKey(r));studentIds.set(r.source_id,studentId)
      const memo=memory('admission',r.source_id),existing=ctx().enrollments.find(e=>e.id===link('enrollment',r.source_id)?.target_id)
      const selectedStudent=work().uiState?.find(s=>s.id===studentId)?.value||(memoryMatchesAdmission(memo,memo?.student_id,memo?.course_id,memo?.target_id)?memo.student_id:existing?.student_id||link('student',r.student_source_id)?.target_id)
      const s=select(right,'目標學生',studentId,ctx().students,c=>`${c.name} · ${c.id.slice(0,8)}`,'略過此報名的學生',r.student_source_id&&createAllowed('student')?'建立獨立學生':null);s.value=selectedStudent||''
      candidates.set(r.source_id,ctx().students.filter(t=>t.id===selectedStudent));const search=input(right,'搜尋學生候選',`student-search-${r.source_id}`,'search',r.sourceStudentName||'')
      const more=button(right,'載入更多學生候選',()=>studentPage(r,false));more.id=`more-students-${r.source_id}`;more.hidden=true
      let timer;const queryWhenReady=()=>{if(!c.isConnected)return;if(localPanel){timer=setTimeout(queryWhenReady,300);return}void localTask(()=>studentPage(r,true),c.querySelector('[data-query-student]'))};search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(queryWhenReady,300)})
      const cs=select(right,'此筆報名的課程',`enrollment-course-${r.source_id}`,ctx().courses,courseName,'請確認目標課程');cs.value=memo?.valid?memo.course_id:existing?.course_id||''
      const es=select(right,'既有／新建報名',`enrollment-${r.source_id}`,ctx().enrollments,e=>e.id.slice(0,8),'略過此報名',createAllowed('enrollment')?'建立新報名':null);es.value=memo?.valid?memo.target_id||'':existing?.id||''
      const queryButton=button(right,'查詢既有報名',()=>enrollmentPage(r));queryButton.id=`more-enrollments-${r.source_id}`;queryButton.dataset.enrollmentAction='true'
      const recheck=button(right,'重新核對此筆',async()=>{
        const selection=rowKey(r)
        await enrollmentPage(r,true)
        if(selection!==rowKey(r))return
        const target=memory('admission',r.source_id)?.target_id||link('enrollment',r.source_id)?.target_id||$(`enrollment-${r.source_id}`).value
        if(target&&target!=='new'&&hooks.capabilities?.()?.enrollment_reconciliation)await reconcileEnrollment(r,target)
      });recheck.dataset.enrollmentAction='true'
      const queryStatus=el('p',capable()?'查詢範圍：此學生所有可存取報名，包含其他班級與課程。':'目前僅查詢所選班級與課程；跨班報名尚未核對。','enrollment-query-status');queryStatus.id=`enrollment-status-${r.source_id}`;queryStatus.dataset.enrollmentStatus='';queryStatus.setAttribute('role','status');queryStatus.setAttribute('aria-live','polite');right.append(queryStatus)
      const results=el('div',undefined,'enrollment-results');results.id=`enrollment-results-${r.source_id}`;right.append(results)
      const reviewLabel=el('label',undefined,'mapping-review'),review=el('input');review.type='checkbox';review.id=`review-${r.source_id}`;review.name=review.id;reviewLabel.htmlFor=review.id;reviewLabel.append(review,el('span','已核對來源與 EduLog 差異；若新建，確認需要獨立報名。'));right.append(reviewLabel)
      input(right,'報名開始日期',`start-${r.source_id}`,'date',existing?.start_date||r.data.start_date||'')
      const status=select(right,'報名狀態',`status-${r.source_id}`,Object.entries(enrollmentStatuses).map(([id,name])=>({id,name})),r=>r.name,'請確認狀態');status.value=existing?.status||r.data.status||''
      const error=el('p',undefined,'mapping-error');error.id=`mapping-error-${r.source_id}`;error.setAttribute('role','status');right.append(error)
      button(right,'確認並記住此報名',async()=>{error.textContent='';try{await confirmRow(r)}catch(e){error.textContent=e.message;throw e}})
      button(right,'修改對應',async()=>{confirmed.delete(r.source_id);c.open=true;s.focus();summary()})
      button(right,'保留 EduLog 並略過此筆',async()=>{work().skippedAdmissions=[...new Set([...(work().skippedAdmissions||[]),r.source_id])];confirmed.delete(r.source_id);summary();dirty();notice('已略過此筆及相關報告；既有資料與選擇保留。')})
      button(right,'恢復此筆對應',async()=>{work().skippedAdmissions=(work().skippedAdmissions||[]).filter(id=>id!==r.source_id);summary();dirty();notice('此筆已恢復，請核對後確認。')})
      button(right,'清除此報名記憶',async()=>{if(!await forget([{kind:'admission',key:r.source_id,expected_revision:revision('admission',r.source_id)}]))return;confirmed.delete(r.source_id);summary();dirty()})
      if(r.student_source_id)button(right,'清除此學生 ID 對應',async()=>{if(!await forget([{kind:'student',key:r.student_source_id,expected_revision:revision('student',r.student_source_id)}]))return;notice('學生 ID 對應已清除；各筆已確認的報名記憶仍保留。');dirty()})
      for(const control of [s,cs,es])control.addEventListener('change',()=>{review.checked=false;querySequences.set(r.source_id,(querySequences.get(r.source_id)||0)+1);if(control===s)es.value='';if(control===cs){courseOverrides.add(r.source_id);work().mappingView={...work().mappingView,courseOverrides:[...courseOverrides]}}confirmed.delete(r.source_id);if(control===s)for(const peer of work().snapshot.records.filter(p=>p.kind==='enrollment'&&studentGroupKey(p)===studentGroupKey(r)&&p.source_id!==r.source_id)){const other=studentSelect(peer);if(other&&other.value!==s.value){candidates.set(peer.source_id,candidates.get(r.source_id)||[]);fill(other,candidates.get(r.source_id)||[],c=>`${c.name} · ${c.id.slice(0,8)}`,'略過此報名的學生',createAllowed('student')?'建立獨立學生':null);other.value=s.value;confirmed.delete(peer.source_id)}}update();dirty()})
      const peers=work().snapshot.records.filter(p=>p.kind==='enrollment'&&baseStudentGroupKey(p)===baseStudentGroupKey(r))
      if(peers.length>1){if(!r.student_source_id)left.append(el('p','依完全相同姓名暫時分組；這不是永久身份對應。確認前可拆分報名。','hint'));const split=button(right,studentSplits.has(r.source_id)?'併回此學生分組':'拆分此報名的學生',()=>{const joining=studentSplits.has(r.source_id);if(joining)studentSplits.delete(r.source_id);else studentSplits.add(r.source_id);work().mappingView={...work().mappingView,studentSplits:[...studentSplits]};if(joining)for(const peer of peers){if(peer.source_id===r.source_id||studentSplits.has(peer.source_id))continue;const other=studentSelect(peer);if(other)other.value=s.value}for(const peer of peers)confirmed.delete(peer.source_id);update();dirty();notice(studentSplits.has(r.source_id)?'此報名及其歷史已獨立；請重新核對目標學生。':'此報名已併回分組；請核對共用的學生選擇。')});split.dataset.studentGroupAction='true'}
      $('student-mappings').append(c)
      if(memoryMatchesAdmission(memo,studentSelect(r).value,$(`enrollment-course-${r.source_id}`).value,memo?.target_id)&&!r.sourceIdentityChanged&&!legacyCourse(r,work().snapshot))c.open=false
      // Candidate data is fetched only when its row is opened or explicitly searched.
      button(right,'查詢學生候選',()=>studentPage(r,true)).dataset.queryStudent=''
      if(!r.student_source_id)left.append(el('p','可以選擇既有學生；不能僅依姓名建立或合併學生。','hint'))
    }
    appendReports()
    update()
    for(const saved of work().uiState||[]){const n=$(saved.id);if(n?.closest('#mapping')){n.value=saved.value;if(n.type==='checkbox')n.checked=saved.checked}}
    for(const [i]of groups.entries())$(`new-course-fields-${i}`).hidden=$(`source-course-${i}`).value!=='new'
    // Compare remembered relationships only after restoring the user's choices.
    // Otherwise a temporary empty enrollment option produces a stale signature.
    for(const r of work().snapshot.records.filter(r=>r.kind==='enrollment')){
      const memo=memory('admission',r.source_id),selected=$(`enrollment-${r.source_id}`).value
      if(memoryMatchesAdmission(memo,studentSelect(r).value,$(`enrollment-course-${r.source_id}`).value,selected)&&!r.sourceIdentityChanged&&!legacyCourse(r,work().snapshot)&&(memo.target_id?memo.target_id===selected:selected==='new'))confirmed.set(r.source_id,signature(r))
    }
    update();summary();$('mapping-filter').value=work().uiState?.find(s=>s.id==='mapping-filter')?.value||'pending';mounting=false;view.mount(groups,cards);applyFilter()
  }
  function appendReports(){
    const dates=new Set([...document.querySelectorAll('[id^=occurrence-]')].map(n=>n.id.slice('occurrence-'.length)))
    for(const r of work().snapshot.records.filter(r=>r.kind==='report'&&r.source_id&&r.date&&!r.identityUnverified&&r.sourceReadStatus!=='failed'&&r.date>=work().dateFrom&&r.date<=work().dateTo)) {
      if($(`report-${r.source_id}`))continue
      if(!dates.has(r.date)){dates.add(r.date);const occurrence=select($('report-mappings'),`${r.date} 課次`,`occurrence-${r.date}`);occurrence.addEventListener('change',()=>{update();dirty()});button($('report-mappings'),`查詢 ${r.date} 的既有課次`,async()=>{const s=$('class-session').value;if(!s||s==='new')throw new Error('請先選擇既有班級。');const p=await catalog('occurrences',{class_session_id:s,date_from:r.date,date_to:r.date});ctx().occurrences=[...new Map([...ctx().occurrences,...p.items||[]].map(o=>[o.id,o])).values()];update();notice(`已查詢 ${r.date} 的既有課次。`)})}
      $('report-mappings').append(evidenceDetails([r]))
      const sourceReport=sourceUrl(work().snapshot.sourceOrigin,r.data.external_link);if(sourceReport){const a=el('a',`查看原站報告 #${r.source_id} ↗`,'mapping-link');a.href=sourceReport;a.target='_blank';a.rel='noopener noreferrer';$('report-mappings').append(a)}
      select($('report-mappings'),`報告 ${r.source_id}`,`report-${r.source_id}`)
      attachImportFields($('report-mappings'),r,{work,courseId:()=>$(`enrollment-course-${r.enrollment_source_id}`)?.value,resolve:resolveReportFields,api,catalog,capable:()=>hooks.capabilities?.()?.field_mapping_memory===true,lessons:()=>ctx().lessons,ingestLessons:rows=>{ctx().lessons=[...new Map([...ctx().lessons,...rows].map(l=>[l.id,l])).values()]},changed:dirty})
      button($('report-mappings'),`查詢報告 ${r.source_id} 的既有對應／載入更多`,async()=>{const e=$(`enrollment-${r.enrollment_source_id}`)?.value,s=$('class-session').value,o=$(`occurrence-${r.date}`)?.value;if(!e||e==='new'||!s||s==='new'||!o||o==='new')throw new Error('請先確認既有報名與課次。');const key=`${e}:${o}`,p=await catalog('report_targets',{class_session_id:s,enrollment_id:e,class_occurrence_id:o,cursor:reportCursors.get(key)||undefined});reportCursors.set(key,p.next_cursor||'');ctx().report_targets=[...new Map([...ctx().report_targets,...p.items||[]].map(t=>[t.id,t])).values()];update();notice(p.next_cursor?'已載入報告候選，可繼續載入。':'已到報告候選清單結尾。')}).id=`more-reports-${r.source_id}`
    }
    update()
  }
  async function resolveReportFields(record,courseId){
    record.fieldRules=[];record.fieldRuleScope=courseId
    if(!hooks.capabilities?.()?.field_mapping_memory)return
    const fields=(record.sourceFields||[]).filter(f=>f.type!=='text'&&!f.internal)
    if(!fields.length)return
    const response=await api('field-resolve',{source_origin:work().snapshot.sourceOrigin,adapter_version:'orange-apple-v1',items:fields.map(f=>({field_key:f.key,...(f.key==='lesson_id'?{course_id:courseId}:{}),options_signature:globalThis.edulogFieldMappings.signature(f)}))})
    record.fieldRules=response.items||[]
    // Resolve only the remembered or chosen lesson IDs, never the full directory.
    const ids=[...new Set([...record.fieldRules.filter(r=>r.field_key==='lesson_id'&&r.valid!==false).map(r=>r.canonical_value),...Object.entries(record.fieldChoices?.fields||{}).filter(([key])=>key==='lesson_id').map(([,v])=>v.value)])]
    if(ids.length){const resolved=await api('resolve',{source_refs:[],target_refs:ids.map(id=>({kind:'lessons',id}))});ingest(resolved)}
  }
  async function resolveFieldRules(){
    const records=work().snapshot.records.filter(r=>r.kind==='report'&&!r.sourceSkipped&&r.date&&r.date>=work().dateFrom&&r.date<=work().dateTo),references=new Map(),scopeFor=field=>field.key==='lesson_id'?'course':'global',key=(f,course)=>`${scopeFor(f)==='course'?course:'*'}:${f.key}:${globalThis.edulogFieldMappings.signature(f)}`
    for(const record of records){const course=$(`enrollment-course-${record.enrollment_source_id}`)?.value;record.fieldRuleScope=course;record.fieldRules=[];if(!course||course==='new')continue;for(const field of record.sourceFields||[])if(field.type!=='text'&&!field.internal)references.set(key(field,course),{field_key:field.key,...(scopeFor(field)==='course'?{course_id:course}:{}),options_signature:globalThis.edulogFieldMappings.signature(field)})}
    const items=[...references.values()],rules=[]
    if(hooks.capabilities?.()?.field_mapping_memory)for(let i=0;i<items.length;i+=50){const response=await api('field-resolve',{source_origin:work().snapshot.sourceOrigin,adapter_version:'orange-apple-v1',items:items.slice(i,i+50)});rules.push(...response.items||[])}
    const lessonIds=new Set()
    for(const record of records){record.fieldRules=rules.filter(rule=>rule.field_key==='lesson_id'?rule.course_id===record.fieldRuleScope:!rule.course_id);for(const rule of record.fieldRules)if(rule.field_key==='lesson_id'&&rule.valid!==false)lessonIds.add(rule.canonical_value);if(record.fieldChoices?.courseId===record.fieldRuleScope&&record.fieldChoices.fields?.lesson_id)lessonIds.add(record.fieldChoices.fields.lesson_id.value)}
    const ids=[...lessonIds];for(let i=0;i<ids.length;i+=50)ingest(await api('resolve',{source_refs:[],target_refs:ids.slice(i,i+50).map(id=>({kind:'lessons',id}))}))
  }
  async function resolveReportFieldRules(record,courseId){
    record.fieldRuleScope=courseId;record.fieldRules=[]
    if(!courseId||courseId==='new')return
    const fields=(record.sourceFields||[]).filter(f=>f.type!=='text'&&!f.internal&&f.key!=='learning_status'),scopeFor=field=>field.key==='lesson_id'?'course':'global',items=[...new Map(fields.map(f=>[`${scopeFor(f)==='course'?courseId:'*'}:${f.key}:${globalThis.edulogFieldMappings.signature(f)}`,{field_key:f.key,...(scopeFor(f)==='course'?{course_id:courseId}:{}),options_signature:globalThis.edulogFieldMappings.signature(f)}])).values()],rules=[]
    if(hooks.capabilities?.()?.field_mapping_memory)for(let i=0;i<items.length;i+=50){const response=await api('field-resolve',{source_origin:work().snapshot.sourceOrigin,adapter_version:'orange-apple-v1',items:items.slice(i,i+50)});rules.push(...response.items||[])}
    record.fieldRules=rules
    const lessonIds=new Set(rules.filter(r=>r.field_key==='lesson_id'&&r.valid!==false).map(r=>r.canonical_value))
    if(record.fieldChoices?.courseId===courseId&&record.fieldChoices.fields?.lesson_id)lessonIds.add(record.fieldChoices.fields.lesson_id.value)
    const ids=[...lessonIds];for(let i=0;i<ids.length;i+=50)ingest(await api('resolve',{source_refs:[],target_refs:ids.slice(i,i+50).map(id=>({kind:'lessons',id}))}))
    return rules
  }
  async function confirmDestination() {
    const room=$('classroom').value,session=$('class-session').value
    if(!room||!session||session==='new')throw new Error('新班級的對應會隨建立保存；既有班級請先選擇教室與班級。')
    await confirm([{kind:'classroom',key:work().snapshot.classId,target_id:room,expected_revision:revision('classroom',work().snapshot.classId)},{kind:'class_session',key:work().snapshot.classId,target_id:session,expected_revision:revision('class_session',work().snapshot.classId)}]);dirty()
  }
  function validateRow(r,quiet=false) {
    if(skipped(r))return false
    const s=studentSelect(r)?.value,c=$(`enrollment-course-${r.source_id}`)?.value
    if(!s||!c)return false
    try{assertReconciled(r)}catch(error){$(`mapping-error-${r.source_id}`).textContent=error.message;return false}
    if(s!=='new'&&$('class-session').value!=='new'&&!courseRowsSafe().some(t=>t.id===c)&&confirmed.get(r.source_id)!==signature(r)) {
      const e=$(`mapping-error-${r.source_id}`);e.textContent='請先確認並記住此報名的學生與課程。';if(quiet)return false;view.revealRow(r);studentSelect(r).focus({preventScroll:true});throw new Error(`${r.sourceStudentName||'報名 '+r.source_id} 的對應尚未確認。`)
    }
    return true
  }
  async function verifyReportRelationships() {
    if(!hooks.capabilities?.()?.enrollment_reconciliation)return
    const loaded=new Map()
    for(const report of work().snapshot.records.filter(r=>r.kind==='report'&&r.source_id&&r.date&&!r.identityUnverified&&r.sourceReadStatus!=='failed'&&r.date>=work().dateFrom&&r.date<=work().dateTo)) {
      const row=work().snapshot.records.find(r=>r.kind==='enrollment'&&r.source_id===report.enrollment_source_id),id=$(`enrollment-${report.enrollment_source_id}`)?.value
      if(!row||skipped(row)||!id||id==='new'||!$(`report-${report.source_id}`)?.value||!$(`occurrence-${report.date}`)?.value)continue
      if(!loaded.has(id)) {
        try{
          let data,cursor;const seen=new Set(),transfers=[]
          do {
            if(cursor&&seen.has(cursor))throw new Error('調課目錄的分頁游標重複，請重新核對。')
            if(cursor)seen.add(cursor)
            data=await api('reconcile',undefined,{enrollmentId:id,query:{limit:50,...(cursor?{cursor}:{})}})
            transfers.push(...data.transfers||[]);cursor=data.next_cursor
            const n=$(`enrollment-status-${row.source_id}`);n.textContent=`正在核對相關課次，已讀取 ${transfers.length} 筆調課紀錄。`
          }while(cursor)
          loaded.set(id,{...data,transfers})
        }
        catch(error){if(error.code==='READ_CANCELLED')throw error;loaded.set(id,{error:error.message,transfers:[]})}
      }
      const data=loaded.get(id)
      work().reconciliation||={};work().reconciliation[row.source_id]||={};work().reconciliation[row.source_id][id]=data
      if(data.enrollment)ctx().enrollments=[...ctx().enrollments.filter(e=>e.id!==id),data.enrollment]
      if(data.error){const n=$(`enrollment-status-${row.source_id}`);n.dataset.state='error';n.textContent=`課次核對失敗：${data.error}。相關報告暫不匯入，請重新核對此筆。`}
    }
    update();dirty()
  }
  function validateReport(row,enrollmentId,occurrenceId) {
    const choice=$(`enrollment-${row.enrollment_source_id}`)?.value
    if(choice==='new')return true
    const enrollment=ctx().enrollments.find(e=>e.id===enrollmentId)
    const crossSession=Boolean(enrollment&&enrollment.class_session_id!==$('class-session').value)
    if(crossSession&&!hooks.capabilities?.()?.transferred_occurrence_import)return false
    const details=work().reconciliation?.[row.enrollment_source_id]?.[enrollmentId]
    if(!hooks.capabilities?.()?.enrollment_reconciliation&&!details)return true
    if(!reportMatchesReconciliation(details,{occurrenceId,date:row.date,sessionId:$('class-session').value}))return false
    if(!crossSession)return true
    return (details?.transfers||[]).some(t=>!t.cancelled_at&&t.is_effective_target&&t.target_occurrence_id===occurrenceId&&t.target_date===row.date&&t.target_class_session_id===$('class-session').value)
  }
  $('mapping-filter').addEventListener('change',applyFilter)
  $('reload-memories').addEventListener('click',()=>void run(async()=>{await resolve(work().snapshot.records);document.querySelectorAll('[data-save-unknown]').forEach(p=>{delete p.dataset.saveUnknown;const n=p.querySelector('.mapping-feedback');n.dataset.state='complete';n.textContent='已重新核對伺服器記憶，請確認目前對應狀態。'});for(const r of work().snapshot.records.filter(r=>r.kind==='enrollment')){const m=memory('admission',r.source_id),selected=$(`enrollment-${r.source_id}`)?.value;if(memoryMatchesAdmission(m,studentSelect(r)?.value,$(`enrollment-course-${r.source_id}`).value,selected))confirmed.set(r.source_id,signature(r));else confirmed.delete(r.source_id)}for(const [i,g]of groups.entries()){const m=g.sourceId?link('course',g.sourceId):memory('course_rule',g.key);if(m?.valid!==false&&m?.target_id===selectedCourse(g)){courseConfirmed.set(g.key,m.target_id);$(`course-state-${i}`).textContent='已記住；目標與權限已重新核對。'}else{courseConfirmed.delete(g.key);$(`course-state-${i}`).textContent='待確認；請重新核對目標。'}}update();dirty();notice('已重新檢查记憶與關係，欄位與目前項目保留。')},{readOnly:true,label:'正在重新檢查對應記憶'}))
  $('reread-source').addEventListener('click',()=>void run(async()=>{
    const activeWork=work(),fresh=await hooks.rereadSource();if(work()!==activeWork||fresh.classId!==work().snapshot.classId||fresh.sourceOrigin!==work().snapshot.sourceOrigin||fresh.sourcePath!==work().snapshot.sourcePath)throw new Error('來源已改變，未修改目前工作。')
    const focus=document.activeElement,focusId=focus?.id,range=['text','search','textarea'].includes(focus?.type)?[focus.selectionStart,focus.selectionEnd]:null
    const position={page:window.scrollY,editor:$('mapping-editor-pane').scrollTop,list:($('mapping-items').closest('aside')||$('mapping-items')).scrollTop}
    const courseChoices=new Map(groups.map((g,i)=>[g.key,{value:$(`source-course-${i}`).value,subject:$(`subject-${i}`).value,stage:$(`stage-${i}`).value}]))
    const values=new Map(work().snapshot.records.filter(r=>r.kind==='enrollment').map(r=>[r.source_id,studentSelect(r)?.value]));let changedIdentities=0
    for(const old of work().snapshot.records){
      const incoming=fresh.records.find(r=>r.kind===old.kind&&r.source_id===old.source_id);if(!incoming)continue
      const before=old.kind==='enrollment'?admissionIdentity(old):null
      const previousCourseLabel=old.sourceCourseLabel
      const identities=['student_source_id','source_course_id','sourceCourseLabel','sourceStudentName','sourceCourseCode','sourceCourseName']
      const fields=Object.fromEntries(Object.entries(incoming).filter(([key,value])=>!['data','sourceEvidence'].includes(key)&&((identities.includes(key)&&value!==null&&value!==undefined&&value!=='')||(!identities.includes(key)&&value!==null&&value!==undefined&&value!==''))))
      Object.assign(old,fields,{data:{...old.data,...incoming.data},sourceEvidence:mergeEvidence(old.sourceEvidence||[],incoming.sourceEvidence||[])})
      if(before){
        const relationChange=classifyAdmissionIdentityChange(before,admissionIdentity(old),{studentLinkedToExisting:link('student',old.student_source_id)?.target_id===memory('admission',old.source_id)?.student_id,courseLinkedToExisting:link('course',old.source_course_id)?.target_id===memory('admission',old.source_id)?.course_id,sameCourseLabel:String(previousCourseLabel||'').trim().replace(/\s+/g,' ')===String(old.sourceCourseLabel||'').trim().replace(/\s+/g,' ')})
        const conflicted=relationChange==='conflict'
        if(conflicted){old.sourceIdentityChanged=true;const review=$(`review-${old.source_id}`);if(review)review.checked=false;changedIdentities++}else old.sourceIdentityChanged=false
      }
    }
    work().snapshot.extractionVersion=fresh.extractionVersion
    const ids=new Set(work().snapshot.records.filter(r=>r.kind==='enrollment').map(r=>r.student_source_id));for(const s of fresh.records.filter(r=>r.kind==='student'&&ids.has(r.source_id)))if(!work().snapshot.records.some(r=>r.kind==='student'&&r.source_id===s.source_id))work().snapshot.records.push(s)
    const choices=[...$('mapping').querySelectorAll('input,select,textarea')].filter(n=>n.id&&!/^(source-course|subject|stage)-/.test(n.id)).map(n=>({id:n.id,value:n.value,checked:n.checked})),seen=new Set()
    for(const [i,g]of groupCourses(work().snapshot.records).entries()){const previous=courseChoices.get(g.key);if(previous)for(const key of ['value','subject','stage'])choices.push({id:key==='value'?`source-course-${i}`:`${key}-${i}`,value:previous[key]})}
    for(const r of work().snapshot.records.filter(r=>r.kind==='enrollment')){const id=r.student_source_id&&!seen.has(r.student_source_id)?`student-${r.student_source_id}`:`student-for-${r.source_id}`;seen.add(r.student_source_id);if(values.get(r.source_id))choices.push({id,value:values.get(r.source_id)})}work().uiState=[...new Map(choices.map(c=>[c.id,c])).values()]
    await mount();changedIdentities=work().snapshot.records.filter(r=>r.kind==='enrollment'&&(r.sourceStudentConflict||r.sourceCourseConflict||r.sourceIdentityChanged)).length;$('mapping-editor-pane').scrollTop=position.editor;($('mapping-items').closest('aside')||$('mapping-items')).scrollTop=position.list;window.scrollTo(0,position.page);if(focusId){const current=$(focusId);current?.focus({preventScroll:true});if(range&&current?.setSelectionRange)current.setSelectionRange(...range)}dirty();notice(`來源原文已補讀；${changedIdentities} 筆來源身份或課程矛盾需重新確認，其他有效對應已沿用。`)
  },{readOnly:true,label:'正在補讀來源摘要與原文'}))
  for(const [id,kind]of[['forget-session','class_session'],['forget-classroom','classroom']])$(id).addEventListener('click',()=>void run(async()=>{if(!await forget([{kind,key:work().snapshot.classId,expected_revision:revision(kind,work().snapshot.classId)}]))return;dirty()},{label:'正在清除對應記憶'}))
  $('remember-destination').addEventListener('click',()=>void run(confirmDestination,{label:'正在保存教室與班級對應'}))
  $('more-sessions').addEventListener('click',()=>void run(async()=>{const old=$('class-session').value,p=await catalog('class_sessions',{classroom_id:$('classroom').value,cursor:$('more-sessions').dataset.cursor});ctx().class_sessions.push(...p.items||[]);fill($('class-session'),ctx().class_sessions,sessionLabel,'選擇目標班級',ctx().permissions.classroom?.class_create?'建立新班級…':null);$('class-session').value=old;$('more-sessions').hidden=!p.next_cursor;$('more-sessions').dataset.cursor=p.next_cursor||''},{readOnly:true,label:'正在載入更多班級'}))
  return {resolveFieldRules,resolveReportFieldRules,appendReports,mount,resolve,destination,scoped,update,refreshCourses,courseRows,studentSelect,validateRow,validateReport,verifyReportRelationships,courseFor:row=>selectedCourse(groups.find(g=>g.key===courseIdentity(row))),selectedCourseIds:()=>[...new Set(work().snapshot.records.filter(r=>r.kind==='enrollment'&&!skipped(r)&&studentSelect(r)?.value).map(r=>$(`enrollment-course-${r.source_id}`)?.value||selectedCourse(groups.find(g=>g.key===courseIdentity(r)))).filter(Boolean))]}
}
