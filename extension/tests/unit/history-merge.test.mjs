import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLineMerge, lineMergeText, mergeClearToken, mergeSignature, regenerateLineMerge } from '../../workspace/history-merge.js'

test('mixed lines keep existing content by default and preserve duplicate line positions',()=>{
 const merge=buildLineMerge('same\nsource addition\nsame','old target\nsame')
 assert.deepEqual(merge.lines.map(({side,text,keep})=>[side,text,keep]),[
  ['target','old target',true],['source','same',false],['source','source addition',false],['common','same',true],
 ])
 assert.equal(lineMergeText(merge.lines),'old target\nsame')
})

test('blank lines and empty merge results remain distinct from a missing merge',()=>{
 const merge=buildLineMerge('first\n\nlast','first\n\nlast')
 assert.equal(merge.lines.length,3)
 assert.equal(merge.lines[1].text,'')
 assert.equal(merge.text,'first\n\nlast')
 const cleared=regenerateLineMerge({...merge,lines:merge.lines.map(line=>({...line,keep:false}))})
 assert.equal(cleared.text,'')
 assert.equal(mergeClearToken(cleared),JSON.stringify([mergeSignature('first\n\nlast','first\n\nlast'),'']))
})
