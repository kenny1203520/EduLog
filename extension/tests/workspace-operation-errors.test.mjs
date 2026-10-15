import test from 'node:test'
import assert from 'node:assert/strict'
import {workspaceInterfaceFailure} from '../workspace-operation-errors.js'

test('interface errors retain safe exception identity without leaking arbitrary report text',()=>{
  const error=new ReferenceError('t is not defined')
  error.stack='ReferenceError: t is not defined\n at staleReasonLabel (chrome-extension://test/workspace.js:655:52)'
  assert.deepEqual(workspaceInterfaceFailure(error),{code:'WORKSPACE_UI_ERROR',type:'ReferenceError',reason:'t is not defined',location:'workspace.js:655:52'})
  const privateError=new TypeError('private report body and credential')
  privateError.stack='TypeError: private report body and credential\n at run (chrome-extension://test/workspace.js:200:4)'
  assert.deepEqual(workspaceInterfaceFailure(privateError),{code:'WORKSPACE_UI_ERROR',type:'TypeError',reason:'',location:'workspace.js:200:4'})
  assert.equal(workspaceInterfaceFailure(Object.assign(new TypeError('API'),{code:'PREVIEW_STALE'})),null)
})
