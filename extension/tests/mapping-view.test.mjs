import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
import { createMappingView } from '../mapping-view.js'

function fixture(t, mobile = false) {
  const dom = new JSDOM(`<section id="mapping"><div id="mapping-workbench"><button data-mapping-section="courses">課程</button><button data-mapping-section="admissions">報名</button><input id="mapping-search"><select id="mapping-filter"><option value="pending">待處理</option><option value="all">全部</option></select><div id="mapping-items"></div><div id="mapping-list-empty"></div><div id="mapping-editor-pane"><h2 id="mapping-editor-title" tabindex="-1"></h2><p id="mapping-editor-subtitle"></p><div id="mapping-empty"></div><div id="course-mappings"></div><div id="student-mappings"></div></div><button id="mapping-back">返回</button></div></section>`)
  const originals = new Map(['document','window','matchMedia'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  globalThis.document = dom.window.document; globalThis.window = dom.window
  const media = { matches: mobile, addEventListener() {} }; globalThis.matchMedia = () => media
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}; dom.window.scrollTo = () => {}
  t.after(()=>{dom.window.close();for(const[key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}})
  const $ = id => document.getElementById(id), queried = []
  let current = {id:'work-1',snapshot:{sourceOrigin:'https://corp.orangeapple.co',records:[]}}
  const view = createMappingView({work:()=>current,context:()=>({courses:[],students:[],enrollments:[]}),settingsUrl:()=>null,changed(){},queryStudent:row=>queried.push(row)})
  const mount = (ids=['301','302'], course='課程 A') => {
    current.snapshot.records = ids.map(source_id=>({kind:'enrollment',source_id,sourceStudentName:`學生 ${source_id}`,sourceCourseLabel:course,data:{}}))
    const rows=current.snapshot.records, groups=ids.length?[{key:course,label:course,rows}]:[]
    $('course-mappings').innerHTML=groups.map((g,i)=>`<details id="course-group-${i}"><summary>${g.label}</summary><select id="source-course-${i}"><option value="">選擇</option></select><p id="course-state-${i}">待確認</p></details>`).join('')
    $('student-mappings').replaceChildren()
    const cards=new Map()
    for(const row of rows){const panel=document.createElement('details');panel.dataset.state='pending';panel.innerHTML=`<summary>${row.source_id}</summary><div class="mapping-comparison"><div></div><div><select id="student-for-${row.source_id}"><option value="">選擇</option></select><select id="enrollment-course-${row.source_id}"><option value="">選擇</option></select><select id="enrollment-${row.source_id}"><option value="">選擇</option></select><input id="start-${row.source_id}"><input id="status-${row.source_id}"></div></div>`;$('student-mappings').append(panel);cards.set(row.source_id,panel)}
    view.mount(groups,cards);return cards
  }
  const tab = name => document.querySelector(`[data-mapping-section="${name}"]`).click()
  const button = key => [...$('mapping-items').children].find(b=>b.dataset.entryKey===key)
  return { $,view,mount,tab,button,queried,media,work:()=>current,setWork:value=>{current=value} }
}

test('repeated remounts reconcile stable buttons and use current rows, never stale closures', t=>{
  const f=fixture(t);f.mount();f.tab('admissions');f.button('admission:301').click()
  const button=f.button('admission:301');button.focus();f.$('mapping-items').scrollTop=71;f.$('mapping-editor-pane').scrollTop=99
  for(let i=0;i<3;i++){
    button.focus()
    const cards=f.mount()
    assert.equal(f.$('mapping-items').children.length,3)
    assert.equal(f.button('admission:301'),button);assert.equal(document.activeElement,button)
    assert.equal(f.$('mapping-items').scrollTop,71);assert.equal(f.$('mapping-editor-pane').scrollTop,99)
    button.click();assert.equal(f.queried.at(-1),f.work().snapshot.records[0])
    assert.equal(cards.get('301').hidden,false);assert.equal(cards.get('302').hidden,true)
    f.tab('courses');assert.equal([...f.$('mapping-items').children].filter(b=>!b.hidden).length,1)
    assert.equal([...f.$('student-mappings').children].every(p=>p.hidden),true)
    f.tab('admissions');assert.equal([...f.$('mapping-items').children].filter(b=>!b.hidden).length,2)
  }
  f.mount(['302']);assert.equal(f.button('admission:301'),undefined);assert.equal(f.$('mapping-items').children.length,2)
  f.mount([]);assert.equal(f.$('mapping-items').children.length,0);assert.equal(f.$('mapping-empty').hidden,false)
})

test('tabs keep independent searches, filters, selections and both scroll positions',t=>{
  const f=fixture(t);f.mount();f.$('mapping-filter').value='all';f.$('mapping-filter').dispatchEvent(new window.Event('change'))
  f.$('mapping-search').value='課程';f.$('mapping-search').dispatchEvent(new window.Event('input'))
  f.$('mapping-items').scrollTop=31;f.$('mapping-editor-pane').scrollTop=61
  f.tab('admissions');f.button('admission:302').click();f.$('mapping-search').value='302';f.$('mapping-search').dispatchEvent(new window.Event('input'))
  f.$('mapping-items').scrollTop=42;f.$('mapping-editor-pane').scrollTop=82
  f.tab('courses');assert.equal(f.$('mapping-search').value,'課程');assert.equal(f.$('mapping-filter').value,'all');assert.equal(f.$('mapping-editor-pane').scrollTop,61);assert.equal(f.$('mapping-items').scrollTop,31)
  f.tab('admissions');assert.equal(f.$('mapping-search').value,'302');assert.equal(f.$('mapping-editor-title').textContent,'學生 302');assert.equal(f.$('mapping-editor-pane').scrollTop,82);assert.equal(f.$('mapping-items').scrollTop,42)
  f.$('mapping-search').value='查無項目';f.$('mapping-search').dispatchEvent(new window.Event('input'));f.mount(['301'])
  assert.equal(f.$('mapping-list-empty').hidden,false);assert.equal(f.$('mapping-empty').hidden,false)
})

test('restored wrong-section keys and changed work IDs cannot expose another tab editor',t=>{
  const f=fixture(t);f.mount();const oldButton=f.button('admission:301')
  f.setWork({id:'work-2',mappingView:{section:'courses',selected:'admission:301',sections:{admissions:{selected:'course:課程 A',filter:'all'}}},snapshot:{sourceOrigin:'https://corp.orangeapple.co',records:[]}})
  const cards=f.mount();assert.equal(oldButton.isConnected,false);assert.equal(f.$('mapping-editor-title').textContent,'課程 A')
  f.tab('admissions');assert.equal(f.$('course-mappings').firstElementChild.hidden,true);assert.equal(cards.get('301').hidden,false)
  assert.equal(f.$('mapping-editor-title').textContent,'學生 301')
})

test('mobile tab switches show the list and retain the current item on return',t=>{
  const f=fixture(t,true);f.mount();f.tab('admissions');f.button('admission:302').click()
  assert.equal(f.$('mapping-workbench').dataset.mobileView,'editor')
  f.tab('courses');assert.equal(f.$('mapping-workbench').dataset.mobileView,'list')
  f.tab('admissions');assert.equal(f.$('mapping-workbench').dataset.mobileView,'list')
  f.button('admission:302').click();assert.equal(f.$('mapping-editor-title').textContent,'學生 302')
  f.$('mapping-back').click();assert.equal(document.activeElement,f.button('admission:302'))
  f.setWork({id:'work-2',mappingView:{section:'courses',selected:'admission:302',mobileEditor:true},snapshot:{sourceOrigin:'https://corp.orangeapple.co',records:[]}})
  f.mount();assert.equal(f.$('mapping-workbench').dataset.mobileView,'list');assert.equal(f.$('mapping-empty').hidden,false)
})
