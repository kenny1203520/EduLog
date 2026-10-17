// Run before parsing the body. Only the background reads extension storage; the page keeps a
// copy of the theme preference (on/off and per-page original mode, nothing secret) in its own
// localStorage so the first paint does not wait for a sleeping service worker.
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
  const CACHE_KEY = 'edulog:ui-preferences'
  // Waiting for the preference itself; once it is known the gate only waits for the page.
  const PREFERENCE_DEADLINE = 300, PAGE_DEADLINE = 1500
  let settled = false, preferred = false, sequence = 0, timer, hint, expired = false
  let resolve, confirm
  const ready = new Promise(done => { resolve = done })
  // The background's answer, whenever it arrives (null when it fails or is superseded).
  const confirmed = new Promise(done => { confirm = done })
  function readCache() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY))
      if (value?.v !== 1 || typeof value.enabled !== 'boolean') return null
      const pages = value.pages && typeof value.pages === 'object' && !Array.isArray(value.pages) ? value.pages : {}
      return { enabled: value.enabled, pages }
    } catch { return null }
  }
  function store(prefs) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 1, enabled: prefs.enabled !== false, pages: prefs.pages || {} })) } catch {}
  }
  function release() {
    clearTimeout(timer)
    html.removeAttribute('data-edulog-pending')
    hint?.remove(); hint = null
  }
  function finish(enabled, reason, pages = {}) {
    if (settled) return
    settled = true
    preferred = enabled
    if (!enabled || pages[page?.kind] === 'original') release()
    resolve({ enabled, reason, pages })
  }
  function wait(onTimeout, deadline = PREFERENCE_DEADLINE) {
    // A transaction never extends an existing deadline.
    if (html.hasAttribute('data-edulog-pending')) return
    html.setAttribute('data-edulog-pending', '')
    timer = setTimeout(() => { release(); onTimeout?.() }, deadline)
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
    ready, confirmed, store, wait: callback => { wait(callback); status() }, release, mode,
    cleanSnapshot() { hint?.remove(); hint = null },
    get preferred() { return preferred },
    get expired() { return expired },
    remember(value) { preferred = value; sequence++ },
  })
  const page = adapter.matchPage(location.pathname)
  if (!page) { finish(false, 'unknown'); confirm(null); return }
  const cached = readCache()
  if (cached) {
    // Paint from the copy now; the background's answer corrects it later if it changed.
    const shown = cached.enabled && cached.pages[page.kind] !== 'original'
    if (shown) wait(null, PAGE_DEADLINE)
    mode(shown, page)
    finish(cached.enabled, 'cache', cached.pages)
  } else {
    // Without a copy, wait briefly for the preference. If only the page is slow, show it
    // rather than hold a blank screen, but keep the theme: the content script applies it.
    wait(() => { if (!settled) { expired = true; mode(false); finish(false, 'timeout') } })
  }
  document.addEventListener('DOMContentLoaded', status, { once: true })
  const request = sequence
  void globalThis.edulogRuntime.send({ type: 'get-ui-preferences' }).then(prefs => {
    if (request !== sequence) { confirm(null); return }
    if (!prefs || prefs.error) { confirm(null); if (!settled) { mode(false); finish(false, 'preference') } return }
    const answer = { enabled: prefs.enabled !== false, pages: prefs.pages || {} }
    store(answer)
    confirm(answer)
    preferred = answer.enabled
    if (settled) return // The content script switches the painted page if this differs.
    mode(answer.enabled && answer.pages[page.kind] !== 'original', page)
    finish(answer.enabled, 'preference', answer.pages)
  }).catch(() => {
    confirm(null)
    if (!settled && request === sequence) { mode(false); finish(false, 'unavailable') }
  })
})()
