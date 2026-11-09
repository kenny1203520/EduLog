import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from '../../../app/node_modules/jsdom/lib/api.js'
import {comparison,decisionResult,semanticValue,paragraphChanges} from '../../workspace/review-ui.js'
test('semantic comparison keeps false, zero, blank and half-star meanings distinct',()=>{
  assert.equal(semanticValue('is_completed',false),'未完成');assert.equal(semanticValue('is_completed',null),'未填');assert.equal(semanticValue('class_participation',0),'0 星');assert.equal(semanticValue('class_participation',4.5),'4.5 星')
  assert.equal(semanticValue('lesson_id','same-name',()=>({sequence:3,title:'Same title'})),'Lesson 3 · Same title')
})
test('paragraph diff preserves unchanged paragraphs, removes old text and adds new text safely',()=>{
  assert.deepEqual(paragraphChanges('first\nold\nlast','first\nnew\nlast'),[{kind:'same',text:'first'},{kind:'removed',text:'old'},{kind:'added',text:'new'},{kind:'same',text:'last'}])
  const dom=new JSDOM('<body></body>'),root=comparison(dom.window.document,{label:'Notes',source:'first\n<script>unsafe</script>\nlast',target:'first\nold\nlast',text:true});dom.window.document.body.append(root)
  assert.equal(root.querySelector('script'),null);assert.equal(root.querySelectorAll('.review-sides>div').length,2);assert.match(root.querySelector('del').textContent,/old/);assert.ok(root.querySelector('ins').textContent.includes('<script>unsafe</script>'))
  decisionResult(root,'old','keep');assert.match(root.querySelector('[data-diff-result]').textContent,/保留 EduLog/);decisionResult(root,'new','source');assert.equal(root.querySelectorAll('[data-diff-result]').length,1);assert.match(root.querySelector('[data-diff-result]').textContent,/採用來源/);dom.window.close()
})
