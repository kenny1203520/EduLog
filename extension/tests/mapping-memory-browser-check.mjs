// Isolated browser scenarios. No real site, user credentials or database writes.
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const {chromium}=await import(pathToFileURL(process.argv.slice(2).find(a=>!a.startsWith('--'))||'C:/Users/kenny/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const root=new URL('../',import.meta.url),output=new URL('artifacts/mapping/',import.meta.url);mkdirSync(output,{recursive:true})
const server=createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!/^[a-z0-9.-]+$/.test(name)){res.writeHead(404).end();return}try{res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(new URL(name,root)))}catch{res.writeHead(404).end()}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`
function mock() {
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,version='a'.repeat(32),origin='https://corp.orangeapple.co',store=new Map()
  let memories=JSON.parse(localStorage.getItem('syntheticMemories')||'[]'),links=JSON.parse(localStorage.getItem('syntheticLinks')||'[]'),enrollments=JSON.parse(localStorage.getItem('syntheticEnrollments')||'[]')
  const save=()=>{localStorage.setItem('syntheticMemories',JSON.stringify(memories));localStorage.setItem('syntheticLinks',JSON.stringify(links));localStorage.setItem('syntheticEnrollments',JSON.stringify(enrollments))}
  const catalog={classrooms:[{id:id(1),name:'教室',target_version:version}],courses:[{id:id(2),display_name:'課程 A',subject:'程式',stage:'初階',target_version:version},{id:id(12),display_name:'課程 B',subject:'程式',stage:'進階',target_version:version}],class_sessions:[{id:id(3),name:'同班多課程',classroom_id:id(1),course_ids:[id(2)],start_date:'2026-01-01',day_of_week:5,start_time:'09:00:00',end_time:'10:00:00',target_version:version}],students:[{id:id(4),name:'同名學生',target_version:version,relationships:[{class_name:'舊班甲',course_name:'課程 A'}]},{id:id(14),name:'同名學生',target_version:version,relationships:[{class_name:'舊班乙',course_name:'課程 B'}]}],enrollments,occurrences:[],report_targets:[]}
  const snapshot={sourceOrigin:origin,sourcePath:'/courses/dt/11',classId:'11',title:'同班多課程',issues:[],admissionPaths:[],records:[{kind:'student',source_id:'101',data:{name:'同名學生'}},{kind:'student',source_id:'102',data:{name:'同名學生'}},...[['301','101','課程 A'],['302','102','課程 A'],['303',null,new URL(location.href).searchParams.has('changed')?'來源已改課程':'課程 B'],['304','101','課程 B']].map(([source_id,student_source_id,sourceCourseLabel])=>({kind:'enrollment',source_id,student_source_id,sourceStudentName:'同名學生',sourceCourseLabel,data:{external_link:`${origin}/dt_admissions/${source_id}`}}))]}
  for(const r of snapshot.records.filter(r=>r.kind==='enrollment'))r.sourceEvidence=[{sourcePath:snapshot.sourcePath,table:'reports',row:Number(r.source_id)-300,capturedAt:'2026-10-02T00:00:00Z',fields:[{key:'student_name',label:'學生',text:r.sourceStudentName},{key:'course_name',label:'課程',text:r.sourceCourseLabel}]}]
  const upsert=(arr,row,key)=>{const i=arr.findIndex(r=>key(r)===key(row));if(i<0)arr.push(row);else arr[i]=row}
  window.testCalls=[];window.chrome={runtime:{sendMessage:async m=>{
    window.testCalls.push(m)
    if(m.type==='workspace-init')return{data:{binding:{instance:'http://localhost:3000',userId:id(8)},status:{status:'connected',settingsUrl:'https://web.example:8443/edulog/dashboard/settings?tab=integrations',capabilities:{teaching_data_import:true,report_prefill:true,catalog_v1:true,mapping_memory:true,multi_course_import:true}},tabs:[{id:10,title:'來源班級',path:snapshot.sourcePath}]}}
    if(m.type==='workspace-source')return{data:m.action==='context'?{sourceOrigin:origin,sourcePath:snapshot.sourcePath,classId:'11',title:snapshot.title}:snapshot}
    if(m.type==='workspace-store'){if(m.action==='list')return{data:[...store.values()]};if(m.action==='get')return{data:store.get(m.id)};const w=structuredClone(m.work);w.updatedAt=Date.now();store.set(w.id,w);return{data:w}}
    if(m.type==='workspace-check-source')return{data:{closed:false}}
    if(m.type==='workspace-api'){
      if(m.operation==='catalog'){
        if(m.query.resource==='students')await new Promise(resolve=>setTimeout(resolve,window.studentDelay||0))
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
        await new Promise(resolve=>setTimeout(resolve,window.confirmDelay||0));if(window.confirmFailure){const code=window.confirmFailure;window.confirmFailure=null;return{error:{code,message:'測試保存失敗'}}}
        for(const row of m.body.items){const key=r=>`${r.kind}:${r.key}:${r.kind==='course_rule'?r.source_class_id:''}`;if(row.action==='clear'){memories=memories.filter(r=>key(r)!==key({...row,source_class_id:m.body.source_class_id}));continue}upsert(memories,{...row,source_class_id:m.body.source_class_id,revision:crypto.randomUUID(),valid:true},key);if(['student','class_session','course'].includes(row.kind))upsert(links,{source_origin:origin,source_kind:row.kind,source_id:row.key,target_id:row.target_id,valid:true,reason:'remembered',revision:crypto.randomUUID()},r=>`${r.source_kind}:${r.source_id}`)}save();return{data:{items:m.body.items.map(r=>({kind:r.kind,key:r.key,revision:memories.find(l=>l.kind===r.kind&&l.key===r.key)?.revision}))}}
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
    try{for(const width of(process.argv.includes('--focused')?[390,1440]:[360,390,768,1024,1440,720])){
      const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:width===720?2:1}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(mock)
      const collect=async()=>{await page.locator('#read-history').uncheck();await page.locator('#collect').click();await page.locator('#mapping').waitFor({state:'visible'})}
      await page.goto(`${base}/workspace.html?source=10`);await collect()
      assert.equal(await page.evaluate(()=>testCalls.some(m=>m.operation==='context')),false)
      await page.locator('#classroom').selectOption(id(1));await page.locator('#class-session').selectOption(id(3));await page.locator('#remember-destination').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('已保存'))
      const choose=async(section,index)=>{
        if(width<=768&&await page.locator('#mapping-back').isVisible())await page.locator('#mapping-back').click()
        await page.locator(`[data-mapping-section="${section}"]`).click()
        await page.locator('#mapping-filter').selectOption('all')
        await page.locator('#mapping-items button:visible').nth(index).click()
        await page.waitForFunction(()=>!document.querySelector('#mapping-editor-pane [aria-busy="true"]'))
      }
      for(const [i,target]of[[0,id(2)],[1,id(12)]]){
        await choose('courses',i);await page.locator(`#source-course-${i}`).selectOption(target)
        const panel=page.locator('.course-group').nth(i),button=panel.locator('.mapping-actions>.primary')
        await button.scrollIntoViewIfNeeded();await button.focus();const before=await page.evaluate(()=>({focus:document.activeElement,window:scrollY,editor:document.querySelector('#mapping-editor-pane').scrollTop,list:document.querySelector('#mapping-items').scrollTop}))
        const calls=await page.evaluate(slow=>{window.confirmDelay=slow?11000:600;return testCalls.length},width===1440&&i===0);await button.click();assert.match(await button.textContent(),/正在保存/);await button.evaluate(n=>n.click());if(width===1440&&i===0){await page.waitForFunction(()=>document.querySelector('.course-group[aria-busy] .mapping-feedback').textContent.includes('回應較慢'));assert.equal(await page.locator('#reread-source').isDisabled(),true)}await page.waitForFunction(()=>!document.querySelector('.course-group[aria-busy]'))
        assert.match(await panel.locator('.mapping-feedback').textContent(),/已記住此課程/)
        assert.equal(await button.evaluate(n=>document.activeElement===n),true,'confirm retains its native button focus')
        await page.evaluate(()=>window.confirmDelay=600);const after=await page.evaluate(()=>({window:scrollY,editor:document.querySelector('#mapping-editor-pane').scrollTop,list:document.querySelector('#mapping-items').scrollTop}))
        assert.equal(after.window,before.window);assert.equal(after.editor,before.editor);assert.equal(after.list,before.list)
        await page.keyboard.press('Shift+Tab');const focus=await page.evaluate(()=>{const n=document.activeElement,r=n.getBoundingClientRect();return{tag:n.tagName,visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,outline:getComputedStyle(n).outlineStyle}});assert.notEqual(focus.tag,'BODY');assert.equal(focus.visible,true,'keyboard focus stays visible');assert.notEqual(focus.outline,'none')
        const requests=await page.evaluate(n=>testCalls.slice(n).filter(m=>m.operation==='resolve'),calls);assert.equal(requests.length,1);assert.equal(await page.evaluate(n=>testCalls.slice(n).filter(m=>m.operation==='confirm').length,calls),1,'duplicate confirm is blocked');assert.equal(requests[0].body.source_refs.length,0,'confirmation resolves only relevant target versions')
        assert.equal(await panel.isVisible(),true);if(i===0){await page.locator('#mapping-filter').evaluate(n=>{n.value='pending';n.dispatchEvent(new Event('change',{bubbles:true}))});assert.equal(await page.locator('#mapping-items button[aria-current=true]:visible').count(),0,'explicit filter releases the completed item pin');await page.locator('#mapping-filter').evaluate(n=>{n.value='all';n.dispatchEvent(new Event('change',{bubbles:true}))})}assert.equal(await panel.locator('.source-evidence').getAttribute('open'),null)
      }
      for(const [index,admission,studentControl,target]of[[0,'301','student-101',id(4)],[1,'302','student-102',id(14)],[2,'303','student-for-303',id(4)],[3,'304','student-for-304',id(4)]]){
        await choose('admissions',index)
        const row=page.locator('.mapping-row').filter({has:page.locator(`#enrollment-${admission}`)})
        if(width===390&&index===0){await page.evaluate(()=>window.studentDelay=700);const search=page.locator(`#student-search-${admission}`);await search.focus();await search.fill('先查詢');await page.waitForFunction(()=>document.querySelector('.mapping-row[aria-busy]'));assert.equal(await search.isDisabled(),false);await search.fill('同名學生');assert.equal(await search.evaluate(n=>document.activeElement===n),true);await page.waitForFunction(()=>testCalls.filter(m=>m.operation==='catalog'&&m.query.search==='同名學生').length>=2&&!document.querySelector('.mapping-row[aria-busy]'));assert.equal(await search.inputValue(),'同名學生');await page.evaluate(()=>window.studentDelay=0)}
        if(admission==='303')assert.equal(await page.locator(`#${studentControl} option[value=new]`).count(),0)
        await page.locator(`#${studentControl}`).selectOption(target);await page.locator(`#enrollment-${admission}`).selectOption('new');await page.locator(`#start-${admission}`).fill('2026-01-01');await page.locator(`#status-${admission}`).selectOption('regular')
        const link=row.getByRole('link',{name:'查看 EduLog 學生（新分頁）'});assert.equal(await link.getAttribute('href'),`https://web.example:8443/edulog/dashboard/student/${target}`);assert.equal(await link.getAttribute('rel'),'noopener noreferrer')
        assert.equal(await row.getByRole('link',{name:'查看原站報名（新分頁）'}).getAttribute('href'),`https://corp.orangeapple.co/dt_admissions/${admission}`)
        await row.locator('.source-evidence>summary').click();assert.match(await row.locator('.source-evidence').textContent(),/同名學生/);await row.locator('.source-evidence>summary').click()
        const button=row.locator('.mapping-actions>.primary')
        if(index===0){await page.evaluate(()=>window.confirmFailure='VERSION_CONFLICT');await button.click();await page.waitForFunction(()=>!document.querySelector('.mapping-row[aria-busy]'));assert.match(await row.locator('.mapping-feedback').textContent(),/對應或目標已變更/);assert.equal(await page.locator(`#start-${admission}`).inputValue(),'2026-01-01')}
        if(index===1){await page.evaluate(()=>window.confirmFailure='API_TIMEOUT');await button.click();await page.waitForFunction(()=>!document.querySelector('.mapping-row[aria-busy]'));assert.match(await row.locator('.mapping-feedback').textContent(),/保存結果尚未確認/);assert.equal(await button.getAttribute('aria-disabled'),'true');await page.locator('#reload-memories').click();await page.waitForFunction(()=>!document.querySelector('#workspace').hasAttribute('aria-busy'));assert.equal(await button.getAttribute('aria-disabled'),'false')}
        await button.click();await page.waitForFunction(()=>!document.querySelector('.mapping-row[aria-busy]'));assert.match(await row.locator('.mapping-feedback').textContent(),/已記住此報名/);assert.equal(await row.isVisible(),true)
      }
      assert.equal(await page.locator('.mapping-row:visible').count(),1,'only the active editor remains visible')
      assert.equal(await page.locator('#mapping-items button[aria-current=true]').count(),1)
      if(width===1440){
        await choose('courses',0);await page.locator('#source-course-0').selectOption(id(2));await page.evaluate(()=>window.confirmDelay=1200)
        await page.locator('.course-group').first().locator('.mapping-actions>.primary').click()
        await page.locator('#mapping-items button:visible').nth(1).click();await page.waitForFunction(()=>!document.querySelector('.course-group[aria-busy]'))
        assert.equal(await page.locator('#mapping-editor-title').textContent(),'課程 B','late save stays bound to the original item')
        assert.equal(await page.locator('#source-course-1').inputValue(),id(12));assert.match(await page.locator('.course-group').first().locator('.mapping-feedback').textContent(),/已記住此課程/)
        await page.evaluate(()=>window.confirmDelay=600);await choose('admissions',3)
      }
      if(width<=768){await page.locator('#mapping-back').click();await page.locator('#mapping-search').fill('304');await page.locator('#mapping-items button[aria-current=true]').click();await page.locator('#mapping-back').click();assert.equal(await page.locator('#mapping-search').inputValue(),'304');await page.locator('#mapping-search').fill('');await page.locator('#mapping-items button[aria-current=true]').click()}
      await page.locator('#mapping-workbench').scrollIntoViewIfNeeded();await page.locator('#mapping-editor-pane').evaluate(n=>n.scrollTop=0);await page.screenshot({path:new URL(`${name}-${width}-mapping.png`,output).pathname.replace(/^\//,'')})
      await page.locator('#preview').click();await page.locator('#preview-section').waitFor({state:'visible'})
      const job=await page.evaluate(()=>testCalls.find(m=>m.operation==='job').body);assert.deepEqual(job.course_ids.sort(),[id(2),id(12)].sort());assert.equal('course_id'in job,false)
      const batch=await page.evaluate(()=>testCalls.find(m=>m.operation==='preview').body.rows.filter(r=>r.record.kind==='enrollment'));assert.equal(batch.length,4);assert.equal(batch.find(r=>r.source_id==='301').record.data.student_id,id(4));assert.equal(batch.find(r=>r.source_id==='302').record.data.student_id,id(14));assert.equal(batch.find(r=>r.source_id==='303').record.data.course_id,id(12))
      const change=page.getByText('我確認追加選定課程到班級可上課程（保留原有課程與排程）',{exact:true});await change.locator('..').locator('input').check();await page.locator('#repreview').click();await page.waitForFunction(()=>!document.querySelector('#workspace').hasAttribute('aria-busy'))
      await page.locator('#apply').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('全部可匯入'))
      assert.equal(await page.evaluate(()=>JSON.stringify(testCalls.filter(m=>['preview','apply'].includes(m.operation))).includes('sourceEvidence')),false,'original evidence never enters API writes')
      await page.reload();await collect();assert.match(await page.locator('#mapping-summary').textContent(),/已沿用 4/)
      await page.locator('#mapping-filter').selectOption('all');await choose('admissions',0);assert.equal(await page.locator('#student-101').inputValue(),id(4))
      assert.match(await page.locator('#enrollment-301 option:checked').textContent(),/正式/)
      assert.equal(await page.locator('.mapping-row:visible').getByRole('link',{name:'查看 EduLog 報名與報告（新分頁）'}).getAttribute('href').then(h=>h.startsWith('https://web.example:8443/edulog/dashboard/reports/')),true)
      const selected=await page.locator('#student-101').inputValue();await page.locator('#reread-source').click();await page.waitForFunction(()=>!document.querySelector('#workspace').hasAttribute('aria-busy'));assert.equal(await page.locator('#student-101').inputValue(),selected)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[])
      await page.goto(`${base}/workspace.html?source=10&changed=1`);await collect();assert.match(await page.locator('#mapping-summary').textContent(),/失效 1/)
      console.log(`PASS ${name} ${width}: master/detail, focus/scroll, inline failure, targeted revisions, evidence, safe frontend links, multilingual statuses, multi-course reuse and supplement`);await context.close()
    }}finally{await browser.close()}
  }
}finally{await new Promise(resolve=>server.close(resolve))}
