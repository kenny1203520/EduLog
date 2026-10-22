import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {JSDOM} from '../../../app/node_modules/jsdom/lib/api.js'
const field={key:'attendance_status',type:'select',value:'yes',options:[{value:'yes',label:'出席',disabled:false},{value:'no',label:'不出席',disabled:false}]}
function setup(rules,confirm,isCurrent=()=>true,changed){const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});for(const f of ['shared/field-mappings.js','shared/field-mapping-ui.js'])dom.window.eval(readFileSync(new URL('../../'+f,import.meta.url),'utf8'));dom.window.edulogFieldMappingUI.attach(dom.window.document.querySelector('main'),field,{attendance_status:'present'},rules,{enabled:true,confirm,isCurrent,changed});return dom}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
test('explicit confirmation uses returned revision; clearing leaves original field untouched',async()=>{
 const rules=[],calls=[],changes=[];const dom=setup(rules,async input=>{calls.push(input);return{items:input.action==='confirm'?[{...input,revision:'rev-1',valid:true}]:[{cleared:true}]}},()=>true,(_rules,change)=>changes.push(change)),doc=dom.window.document
 const [save,clear]=doc.querySelectorAll('button');save.click();save.click();await tick();assert.equal(calls.length,1);assert.equal(rules[0].revision,'rev-1');assert.match(doc.querySelector('[role=status]').textContent,/已記住/)
 assert.equal(changes[0].optionsSignature,dom.window.edulogFieldMappings.signature(field));assert.equal(changes[0].canonicalValue,'present')
 clear.click();await tick();assert.equal(calls[1].expected_revision,'rev-1');assert.equal(rules.length,0);assert.equal(field.value,'yes');dom.window.close()
})
test('removed source options keep their revision and allow clearing, not confirmation',async()=>{
 const rules=[{field_key:field.key,source_value:'obsolete',canonical_value:'present',options_signature:'old',revision:'old-revision',valid:false}],calls=[]
 const dom=setup(rules,async input=>{calls.push(input);return{items:[{cleared:true}]}}),doc=dom.window.document,[source]=doc.querySelectorAll('select');source.value='obsolete';source.dispatchEvent(new dom.window.Event('change'));const [save,clear]=doc.querySelectorAll('button');assert.equal(save.disabled,true);assert.equal(clear.disabled,false);clear.click();await tick();assert.equal(calls[0].expected_revision,'old-revision');dom.window.close()
})
test('uncertain saves lock repeat writes until rechecking',async()=>{
 const dom=setup([],async()=>{throw Object.assign(new Error('timeout'),{code:'API_TIMEOUT'})}),doc=dom.window.document;doc.querySelector('button').click();await tick();assert.match(doc.querySelector('[role=status]').textContent,/結果尚未確認/);assert.ok([...doc.querySelectorAll('button')].every(b=>b.disabled));dom.window.close()
})
test('late confirmations do not write memory after the target changes',async()=>{
 const rules=[];let resolve,current=true;const dom=setup(rules,()=>new Promise(r=>resolve=r),()=>current);dom.window.document.querySelector('button').click();current=false;resolve({items:[{field_key:field.key,source_value:'yes',revision:'late'}]});await tick();assert.equal(rules.length,0);dom.window.close()
})
test('lesson choices sort by numeric sequence, then title and id, with missing sequence last',()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});dom.window.eval(readFileSync(new URL('../../shared/field-mapping-ui.js',import.meta.url),'utf8'))
 const lessons=[{id:'z',sequence:10,title:'ten'},{id:'b',sequence:2,title:'Beta'},{id:'a',sequence:2,title:'Alpha'},{id:'one',sequence:1,title:'One'},{id:'missing',title:'Missing'}]
 assert.deepEqual([...dom.window.edulogFieldMappingUI.sortLessons(lessons)].map(row=>row.id),['one','a','b','z','missing']);dom.window.close()
})
