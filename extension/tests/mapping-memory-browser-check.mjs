// Isolated browser scenarios. No real site, user credentials or database writes.
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const {chromium}=await import(pathToFileURL(process.argv[2]||'C:/Users/kenny/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const root=new URL('../',import.meta.url),output=new URL('artifacts/mapping/',import.meta.url);mkdirSync(output,{recursive:true})
const server=createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!/^[a-z0-9.-]+$/.test(name)){res.writeHead(404).end();return}try{res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(new URL(name,root)))}catch{res.writeHead(404).end()}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`
function mock() {
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,version='a'.repeat(32),origin='https://corp.orangeapple.co',store=new Map()
  let memories=JSON.parse(localStorage.getItem('syntheticMemories')||'[]'),links=JSON.parse(localStorage.getItem('syntheticLinks')||'[]'),enrollments=JSON.parse(localStorage.getItem('syntheticEnrollments')||'[]')
  const save=()=>{localStorage.setItem('syntheticMemories',JSON.stringify(memories));localStorage.setItem('syntheticLinks',JSON.stringify(links));localStorage.setItem('syntheticEnrollments',JSON.stringify(enrollments))}
  const catalog={classrooms:[{id:id(1),name:'教室',target_version:version}],courses:[{id:id(2),display_name:'課程 A',subject:'程式',stage:'初階',target_version:version},{id:id(12),display_name:'課程 B',subject:'程式',stage:'進階',target_version:version}],class_sessions:[{id:id(3),name:'同班多課程',classroom_id:id(1),course_ids:[id(2)],start_date:'2026-01-01',day_of_week:5,start_time:'09:00:00',end_time:'10:00:00',target_version:version}],students:[{id:id(4),name:'同名學生',target_version:version,relationships:[{class_name:'舊班甲',course_name:'課程 A'}]},{id:id(14),name:'同名學生',target_version:version,relationships:[{class_name:'舊班乙',course_name:'課程 B'}]}],enrollments,occurrences:[],report_targets:[]}
  const snapshot={sourceOrigin:origin,sourcePath:'/courses/dt/11',classId:'11',title:'同班多課程',issues:[],admissionPaths:[],records:[{kind:'student',source_id:'101',data:{name:'同名學生'}},{kind:'student',source_id:'102',data:{name:'同名學生'}},...[['301','101','課程 A'],['302','102','課程 A'],['303',null,new URL(location.href).searchParams.has('changed')?'來源已改課程':'課程 B'],['304','101','課程 B']].map(([source_id,student_source_id,sourceCourseLabel])=>({kind:'enrollment',source_id,student_source_id,sourceStudentName:'同名學生',sourceCourseLabel,data:{external_link:`${origin}/dt_admissions/${source_id}`}}))]}
  const upsert=(arr,row,key)=>{const i=arr.findIndex(r=>key(r)===key(row));if(i<0)arr.push(row);else arr[i]=row}
  window.testCalls=[];window.chrome={runtime:{sendMessage:async m=>{
    window.testCalls.push(m)
    if(m.type==='workspace-init')return{data:{binding:{instance:'http://localhost:5173',userId:id(8)},status:{status:'connected',capabilities:{teaching_data_import:true,report_prefill:true,catalog_v1:true,mapping_memory:true,multi_course_import:true}},tabs:[{id:10,title:'來源班級',path:snapshot.sourcePath}]}}
    if(m.type==='workspace-source')return{data:m.action==='context'?{sourceOrigin:origin,sourcePath:snapshot.sourcePath,classId:'11',title:snapshot.title}:snapshot}
    if(m.type==='workspace-store'){if(m.action==='list')return{data:[...store.values()]};if(m.action==='get')return{data:store.get(m.id)};const w=structuredClone(m.work);w.updatedAt=Date.now();store.set(w.id,w);return{data:w}}
    if(m.type==='workspace-check-source')return{data:{closed:false}}
    if(m.type==='workspace-api'){
      if(m.operation==='catalog'){
        if(m.query.resource==='permissions')return{data:m.query.class_session_id?{session:{class_update:true,enrollment_create:true,student_create:true}}:{course_create:true,classroom:{class_create:true,student_create:true,enrollment_create:true}}}
        return{data:{items:catalog[m.query.resource]||[],next_cursor:null}}
      }
      if(m.operation==='resolve'){
        const ls=links.filter(l=>m.body.source_refs.some(r=>r.source_kind===l.source_kind&&r.source_id===l.source_id))
        const ms=memories.filter(l=>m.body.memory_refs?.some(r=>r.kind===l.kind&&r.key===l.key)).map(l=>({...l,valid:!m.body.memory_refs?.find(r=>r.kind===l.kind&&r.key===l.key)?.source_identity||m.body.memory_refs.find(r=>r.kind===l.kind&&r.key===l.key).source_identity===l.source_identity,suggestion:l.kind==='course_rule'&&l.source_class_id!==m.body.source_class_id}))
        const map={student:'students',course:'courses',classroom:'classrooms',class_session:'class_sessions',enrollment:'enrollments'}
        const refs=[...m.body.target_refs,...ls.map(l=>({kind:map[l.source_kind],id:l.target_id})),...ms.flatMap(l=>[{kind:l.kind==='course_rule'?'courses':l.kind==='classroom'?'classrooms':'enrollments',id:l.target_id},{kind:'students',id:l.student_id},{kind:'courses',id:l.course_id},{kind:'class_sessions',id:l.class_session_id}])]
        const targets=refs.filter(r=>r.id).flatMap(r=>(catalog[r.kind]||[]).filter(t=>t.id===r.id).map(t=>({...t,kind:r.kind,target_version:version})))
        return{data:{source_links:ls,memories:ms,targets}}
      }
      if(m.operation==='confirm'){
        for(const row of m.body.items){const key=r=>`${r.kind}:${r.key}:${r.kind==='course_rule'?r.source_class_id:''}`;if(row.action==='clear'){memories=memories.filter(r=>key(r)!==key({...row,source_class_id:m.body.source_class_id}));continue}upsert(memories,{...row,source_class_id:m.body.source_class_id,revision:crypto.randomUUID(),valid:true},key);if(['student','class_session','course'].includes(row.kind))upsert(links,{source_origin:origin,source_kind:row.kind,source_id:row.key,target_id:row.target_id,valid:true,reason:'remembered',revision:crypto.randomUUID()},r=>`${r.source_kind}:${r.source_id}`)}save();return{data:{items:[]}}
      }
      if(m.operation==='job')return{data:{id:id(9)}}
      if(m.operation==='preview')return{data:{rows:m.body.rows.map(r=>({kind:r.record.kind,source_id:r.source_id,target_id:r.target_id,status:r.record.kind==='class_session'?(r.overwrite.includes('course_ids')?'updated':'conflict'):'added',before:r.record.kind==='class_session'?{...r.record.data,course_ids:[id(2)]}:{},after:r.record.data}))}}
      if(m.operation==='apply'){for(const r of m.body.rows){if(r.record.kind==='enrollment'){catalog.enrollments.push({...r.record.data,id:r.target_id,target_version:version});upsert(memories,{kind:'admission',key:r.source_id,source_class_id:'11',source_identity:r.source_identity,target_id:r.target_id,student_id:r.record.data.student_id,course_id:r.record.data.course_id,class_session_id:r.record.data.class_session_id,revision:crypto.randomUUID(),valid:true},r=>`${r.kind}:${r.key}`)}if(r.record.kind==='class_session')catalog.class_sessions[0].course_ids=r.record.data.course_ids}enrollments=catalog.enrollments;save();return{data:{applied:m.body.rows.length}}}
      if(m.operation==='work')return{data:{imports:[],pushes:[]}}
      return{data:{}}
    }
    return{data:true}
  },onMessage:{addListener(){}}}}
}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
try{
  for(const [name,executablePath]of[['chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'],['edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]){
    const browser=await chromium.launch({executablePath,headless:true})
    try{for(const width of[360,390,768,1024,1440]){
      const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(mock)
      const collect=async()=>{await page.locator('#read-history').uncheck();await page.locator('#collect').click();await page.locator('#mapping').waitFor({state:'visible'})}
      await page.goto(`${base}/workspace.html?source=10`);await collect()
      assert.equal(await page.evaluate(()=>testCalls.some(m=>m.operation==='context')),false)
      await page.locator('#classroom').selectOption(id(1));await page.locator('#class-session').selectOption(id(3));await page.locator('#remember-destination').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('已保存'))
      for(const [i,target]of[[0,id(2)],[1,id(12)]]){await page.locator(`#source-course-${i}`).selectOption(target);await page.locator('.course-group').nth(i).getByRole('button',{name:'確認並記住此課程',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#workspace').hasAttribute('aria-busy'))}
      for(const [admission,studentControl,target]of[['301','student-101',id(4)],['302','student-102',id(14)],['303','student-for-303',id(4)],['304','student-for-304',id(4)]]){
        const row=page.locator('.mapping-row').filter({has:page.locator(`#enrollment-${admission}`)})
        await row.getByRole('button',{name:'查詢學生候選',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#workspace').hasAttribute('aria-busy'))
        assert.equal(await page.locator(`#${studentControl}`).inputValue(),admission==='304'?id(4):'','names never auto-select')
        if(admission==='303')assert.equal(await page.locator(`#${studentControl} option[value=new]`).count(),0)
        await page.locator(`#${studentControl}`).selectOption(target);await page.locator(`#enrollment-${admission}`).selectOption('new');await page.locator(`#start-${admission}`).fill('2026-01-01');await page.locator(`#status-${admission}`).selectOption('regular')
        await row.getByRole('button',{name:'確認並記住此報名',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#workspace').hasAttribute('aria-busy'))
      }
      assert.equal(await page.locator('.mapping-row:visible').count(),0)
      assert.equal(await page.evaluate(()=>document.activeElement.id),'preview','focus moves to the next available action')
      await page.keyboard.press('Shift+Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY')
      await page.locator('#mapping-filter').selectOption('all');assert.equal(await page.locator('.mapping-row:visible').count(),4)
      await page.screenshot({path:new URL(`${name}-${width}-mapping.png`,output).pathname.replace(/^\//,'')})
      await page.locator('#preview').click();await page.locator('#preview-section').waitFor({state:'visible'})
      const job=await page.evaluate(()=>testCalls.find(m=>m.operation==='job').body);assert.deepEqual(job.course_ids.sort(),[id(2),id(12)].sort());assert.equal('course_id'in job,false)
      const batch=await page.evaluate(()=>testCalls.find(m=>m.operation==='preview').body.rows.filter(r=>r.record.kind==='enrollment'));assert.equal(batch.length,4);assert.equal(batch.find(r=>r.source_id==='301').record.data.student_id,id(4));assert.equal(batch.find(r=>r.source_id==='302').record.data.student_id,id(14));assert.equal(batch.find(r=>r.source_id==='303').record.data.course_id,id(12))
      const change=page.getByText('我確認追加選定課程到班級可上課程（保留原有課程與排程）',{exact:true});await change.locator('..').locator('input').check();await page.locator('#repreview').click();await page.waitForFunction(()=>!document.querySelector('#workspace').hasAttribute('aria-busy'))
      await page.locator('#apply').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('全部可匯入'))
      await page.reload();await collect();assert.equal(await page.locator('.mapping-row:visible').count(),0,'reopen reuses validated memories')
      assert.match(await page.locator('#mapping-summary').textContent(),/已沿用 4/)
      await page.locator('#mapping-filter').selectOption('all');await page.locator('.mapping-row').first().locator('summary').click();assert.equal(await page.locator('#student-101').inputValue(),id(4))
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[])
      await page.goto(`${base}/workspace.html?source=10&changed=1`);await collect();assert.match(await page.locator('#mapping-summary').textContent(),/失效 1/);assert.equal(await page.locator('.mapping-row:visible').count(),1)
      console.log(`PASS ${name} ${width}: two courses, same names distinct, one student multiple admissions, missing student ID, explicit append, persisted reuse, course identity change, filters and overflow`);await context.close()
    }}finally{await browser.close()}
  }
}finally{await new Promise(resolve=>server.close(resolve))}
