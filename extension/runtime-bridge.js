// Chrome APIs may throw before returning a Promise after extension reload.
(() => {
  let invalidated = false
  const observers = new Set()
  function failure(error) {
    const detail = error?.message || String(error)
    const lost = invalidated || /extension context invalidated/i.test(detail)
    if (lost && !invalidated) {
      invalidated = true
      for (const notify of observers) notify()
    }
    const result = new Error(lost ? '擴充套件已更新，請先儲存正在編輯的內容，再重新整理分頁。' : '擴充套件背景服務暫時無法使用，請再試一次。')
    result.code = lost ? 'CONTEXT_INVALIDATED' : 'BRIDGE_UNAVAILABLE'
    return result
  }
  async function call(operation) {
    if (invalidated) throw failure(new Error('Extension context invalidated.'))
    try { return await operation() }
    catch (error) { throw failure(error) }
  }
  globalThis.edulogRuntime = Object.freeze({
    call,
    send: data => call(() => chrome.runtime.sendMessage(data)),
    listen(handler) {
      if (invalidated) return
      try { chrome.runtime.onMessage.addListener(handler) }
      catch (error) { failure(error) }
    },
    onInvalidated(handler) { observers.add(handler); if (invalidated) handler() },
    get invalidated() { return invalidated },
  })
})()
