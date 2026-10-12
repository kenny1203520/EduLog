// Diagnostic details allow only standard JavaScript errors and a source file
// location. Never copy arbitrary exception messages or the full stack.
export function workspaceInterfaceFailure(error) {
  if(error?.code && error.code!=='WORKSPACE_UI_ERROR')return null
  if(!['ReferenceError','TypeError','SyntaxError'].includes(error?.name))return null
  const message=String(error.message||'')
  const safeReason=/^[\w$]+ is not defined$/.test(message)||/^Cannot access '[\w$]+' before initialization$/.test(message)||/^Cannot read properties of (undefined|null) \(reading '[\w$]+'\)$/.test(message)?message:''
  const location=String(error.stack||'').split('\n').slice(1).join('\n').match(/\b([a-zA-Z0-9_-]+\.js:\d+:\d+)\b/)?.[1]||''
  return {code:'WORKSPACE_UI_ERROR',type:error.name,reason:safeReason,location}
}
