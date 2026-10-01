// Run before parsing the body. Only the background reads extension storage.
(function bootstrap() {
  if (window.top !== window || globalThis.edulogUiBoot) return
  if (!document.documentElement) {
    const observer = new MutationObserver(() => {
      if (document.documentElement) { observer.disconnect(); bootstrap() }
    })
    observer.observe(document, { childList: true })
    return
  }
  const adapter = globalThis.edulogSiteAdapter
  if (!adapter?.matchesHost(location.hostname)) return
  const html = document.documentElement
  let settled = false, preferred = false, sequence = 0, timer, hint, expired = false
  let resolve
  const ready = new Promise(done => { resolve = done })
  function release() {
    clearTimeout(timer)
    html.removeAttribute('data-edulog-pending')
    hint?.remove(); hint = null
  }
  function finish(enabled, reason) {
    if (settled) return
    settled = true
    preferred = enabled
    if (!enabled) release()
    resolve({ enabled, reason })
  }
  function wait(onTimeout) {
    // A transaction never extends an existing deadline.
    if (html.hasAttribute('data-edulog-pending')) return
    html.setAttribute('data-edulog-pending', '')
    timer = setTimeout(() => { release(); onTimeout?.() }, 300)
  }
  function mode(enabled, page) {
    if (enabled && page) {
      html.setAttribute('data-edulog-ui', 'on')
      html.setAttribute('data-edulog-page', page.kind)
    } else {
      html.removeAttribute('data-edulog-ui')
      html.removeAttribute('data-edulog-page')
    }
  }
  function status() {
    if (!document.body || !html.hasAttribute('data-edulog-pending') || hint) return
    hint = document.createElement('div')
    hint.dataset.edulogOwned = ''; hint.id = 'edulog-loading-status'
    hint.setAttribute('role', 'status'); hint.textContent = '正在準備介面…'
    document.body.append(hint)
  }
  globalThis.edulogUiBoot = Object.freeze({
    ready, wait: callback => { wait(callback); status() }, release, mode,
    cleanSnapshot() { hint?.remove(); hint = null },
    get preferred() { return preferred },
    get expired() { return expired },
    remember(value) { preferred = value; sequence++ },
  })
  const page = adapter.matchPage(location.pathname)
  if (!page) { finish(false, 'unknown'); return }
  wait(() => { expired = true; mode(false); finish(false, 'timeout') })
  document.addEventListener('DOMContentLoaded', status, { once: true })
  const request = sequence
  void globalThis.edulogRuntime.send({ type: 'get-ui-preferences' }).then(prefs => {
    if (request !== sequence) return
    preferred = prefs?.enabled !== false && !prefs?.error
    if (settled) return // Remember for a later visit, never switch the painted page.
    mode(preferred, page)
    finish(preferred, 'preference')
  }).catch(() => { if (!settled && request === sequence) { mode(false); finish(false, 'unavailable') } })
})()
