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
    const code = lost ? 'CONTEXT_INVALIDATED'
      : /message length exceeded|message.*too large|maximum allowed length/i.test(detail) ? 'BRIDGE_MESSAGE_TOO_LARGE'
      : /message channel closed|asynchronous response.*closed/i.test(detail) ? 'BRIDGE_CHANNEL_CLOSED'
      : /receiving end does not exist|could not establish connection/i.test(detail) ? 'BRIDGE_NO_RECEIVER'
      : 'BRIDGE_UNAVAILABLE'
    const messages = {
      CONTEXT_INVALIDATED: '擴充套件已更新，請先保存目前內容，再重新整理分頁。',
      BRIDGE_MESSAGE_TOO_LARGE: '工作資料超過背景通訊容量；目前草稿尚未確認保存。',
      BRIDGE_CHANNEL_CLOSED: '背景服務中斷了這次回應；請先確認草稿保存狀態再重試。',
      BRIDGE_NO_RECEIVER: '擴充套件背景服務尚未就緒；請稍候後重試。',
      BRIDGE_UNAVAILABLE: '擴充套件背景服務暫時無法使用；請確認草稿保存狀態後重試。',
    }
    const result = new Error(messages[code])
    result.code = code
    Object.defineProperty(result, 'cause', { value: error, configurable: true })
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
