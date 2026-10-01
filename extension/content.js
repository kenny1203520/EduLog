(() => {
  if (globalThis.edulogPageController || window.top !== window) return
  const adapter = globalThis.edulogSiteAdapter
  if (!adapter?.matchesHost(location.hostname)) return
  globalThis.edulogPageController = true
  const boot = globalThis.edulogUiBoot
  let enabled = false, enhancement, host, suspended = false, timer, resizeObserver, heightState
  let initialized = false, revision = 0, navigation = 0, needsPreference = false
  let preferenceVisit = null
  let view = {}, lastPath = location.pathname
  const pageViews = new Map()
  const scrollState = () => [...document.querySelectorAll('[data-edulog-scroll]')].map((element, index) => ({ key: element.dataset.edulogScroll, index, left: element.scrollLeft, top: element.scrollTop }))
  function rememberPosition() {
    const active = document.activeElement
    view.cachedFocus = active && active !== document.body ? {
      id: active.id, search: active.dataset.edulogSearch,
      cursor: typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null,
    } : null
    view.cachedScrolls = scrollState()
  }
  let dialogEnhancement
  function syncDialog() {
    if (suspended) return
    if (enabled && enhancement && dialogEnhancement?.isCurrent?.()) return
    observer.disconnect()
    try {
    const active = document.activeElement
    dialogEnhancement?.restore(); dialogEnhancement = null
    if (enabled && enhancement) dialogEnhancement = adapter.enhanceDialogs?.(document, view)
    if (active?.isConnected && active !== document.body) active.focus({ preventScroll: true })
    } finally { observer.observe(document.documentElement, { childList: true, subtree: true }) }
  }
  const bridge = globalThis.edulogRuntime
  const message = data => bridge.send(data)
  let notice = ''
  function showNotice(text) {
    notice = text
    const element = host?.shadowRoot.querySelector('.notice')
    if (element) { element.textContent = text; element.hidden = !text }
  }

  function teardown(keepDialog = false, keepToolbar = false) {
    cancelFrame(timer)
    timer = null
    if (!keepDialog) { dialogEnhancement?.restore(); dialogEnhancement = null }
    enhancement?.restore()
    enhancement = null
    if (keepToolbar) return
    host?.remove()
    host = null
    resizeObserver?.disconnect()
    resizeObserver = null
    if (heightState) {
      const style = document.documentElement.style
      if (heightState.value) style.setProperty('--edulog-toolbar-height', heightState.value, heightState.priority)
      else style.removeProperty('--edulog-toolbar-height')
      if (!heightState.hadStyle && !document.documentElement.getAttribute('style')) document.documentElement.removeAttribute('style')
      heightState = null
    }
    document.documentElement.removeAttribute('data-edulog-nav-open')
  }
  function toolbar(page) {
    host = document.createElement('div')
    host.id = 'edulog-extension-root'
    host.dataset.edulogOwned = ''
    host.dataset.enabled = String(enabled)
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>
      :host{all:initial;position:fixed;inset:0 0 auto;z-index:1040;color:#172033;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
      *{box-sizing:border-box}button{font:inherit;cursor:pointer;min-height:44px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#334155}
      button:hover{background:#eff4ff}button:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
      .bar{display:flex;gap:12px;align-items:center;min-height:64px;padding:8px 20px;background:white;border-bottom:1px solid #dbe3ee;box-shadow:0 2px 8px #1720330a}
      strong{color:#1e40af}.title{flex:1}.toggle{color:#1e40af;font-weight:600}.menu{display:none}
      .panel{margin:8px 16px 0 auto;padding:18px;max-width:400px;background:white;border:1px solid #dbe3ee;border-radius:12px;box-shadow:0 12px 32px #17203320}
      .panel[hidden]{display:none}p{margin:8px 0;color:#475569}.panel button{margin-top:8px}.note{font-size:13px}
      :host([data-enabled="false"]){inset:auto 16px 20px auto}.bar{border-radius:0}
      :host([data-enabled="false"]) .bar{padding:6px;border:1px solid #dbe3ee;border-radius:12px}
      :host([data-enabled="false"]) .bar>:not(.toggle){display:none}
      @media(max-width:991px){.menu{display:block}.bar{padding:8px 12px;gap:8px}.title{font-size:13px}}
      @media(max-width:480px){.brand{display:none}.bar{flex-wrap:wrap}.title{flex-basis:calc(100% - 70px)}.panel{margin:8px;max-width:calc(100vw - 16px)}}
    </style><div class="bar"><button class="menu" type="button" aria-label="切換網站導覽" aria-expanded="false">導覽</button><strong class="brand">EduLog</strong><span class="title"></span><button class="integration" type="button" aria-expanded="false">EduLog 功能</button><button class="toggle" type="button"></button></div>
    <section class="panel" aria-label="EduLog 整合功能" hidden><strong>EduLog 連線與整合</strong><p class="status" role="status" aria-live="polite"></p><p class="note">UI 改善不需要配對。教學資料匯入與報告預填尚未啟用；原站的報告操作可照常使用。</p><button class="settings" type="button">開啟整合設定</button></section>`
    root.querySelector('.title').textContent = page.title
    const banner = document.createElement('div')
    banner.className = 'notice'
    banner.style.cssText = 'padding:10px 16px;background:#fff7ed;color:#9a3412;max-width:100vw'
    banner.setAttribute('role', 'status')
    banner.textContent = notice
    banner.hidden = !notice
    root.querySelector('.bar').after(banner)
    root.querySelector('.toggle').textContent = enabled ? '切回原站' : '啟用 UI 改善'
    root.querySelector('.toggle').addEventListener('click', async () => {
      enabled = !enabled
      revision++
      boot?.remember(enabled)
      sync()
      try {
        const result = await message({ type: 'set-ui-preferences', enabled })
        if (result?.error) throw new Error('偏好設定暫時無法儲存。')
      } catch (error) { showNotice(`${error.message} UI 切換僅作用於當頁，偏好未儲存。`) }
    })
    root.querySelector('.menu').addEventListener('click', event => {
      const open = document.documentElement.toggleAttribute('data-edulog-nav-open')
      event.currentTarget.setAttribute('aria-expanded', String(open))
    })
    const panel = root.querySelector('.panel'), integration = root.querySelector('.integration')
    panel.style.cssText = 'overflow-wrap:anywhere;max-height:70vh;overflow:auto'
    const diagnostics = document.createElement('details')
    diagnostics.hidden = true
    const summary = document.createElement('summary')
    summary.textContent = '診斷資訊'
    const detail = document.createElement('p')
    diagnostics.append(summary, detail)
    panel.append(diagnostics)
    root.querySelector('.note').textContent = 'UI 改善不需要配對。資料匯入：目前版本尚未支援。報告預填：目前版本尚未支援。原站報告操作可照常使用。'
    const retry = document.createElement('button')
    retry.type = 'button'; retry.textContent = '重新檢查'; retry.hidden = true
    panel.append(retry)
    const checkConnection = async () => {
      const status = root.querySelector('.status')
      status.textContent = '正在檢查連線…'
      retry.disabled = true
      try {
        const result = await message({ type: 'get-edulog-integration-status' })
        if (!host?.isConnected || host.shadowRoot !== root) return
        const state = globalThis.edulogConnectionUi.describe(result?.status)
        status.textContent = `${state.label}：${state.detail}${result?.origin ? ` ${result.origin}` : ''}${result?.lastVerifiedAt ? ` 最近驗證：${new Date(result.lastVerifiedAt).toLocaleString()}` : ''}`
        diagnostics.hidden = !result?.diagnostic
        detail.textContent = result?.diagnostic ? [result.diagnostic.code, result.diagnostic.message, result.diagnostic.requestId ? `請求編號：${result.diagnostic.requestId}` : ''].filter(Boolean).join(' — ') : ''
        retry.hidden = !['unavailable', 'connected', 'forbidden'].includes(result?.status)
        root.querySelector('.settings').hidden = result?.status !== 'connected'
        root.querySelector('.settings').disabled = !result?.settingsUrl
      } catch (error) {
        status.textContent = bridge.invalidated ? '通訊已停止；本頁 UI 與原站操作仍可使用。' : error.message
        retry.hidden = bridge.invalidated
      } finally { retry.disabled = false }
    }
    retry.addEventListener('click', () => { void checkConnection() })
    integration.addEventListener('click', async () => {
      panel.hidden = !panel.hidden
      integration.setAttribute('aria-expanded', String(!panel.hidden))
      if (panel.hidden) return
      await checkConnection()
    })
    root.querySelector('.settings').addEventListener('click', async () => {
      const result = await message({ type: 'open-edulog-settings' }).catch(error => { showNotice(error.message); return null })
      if (!result?.opened) root.querySelector('.status').textContent = '請點選瀏覽器工具列的 EduLog 圖示，設定伺服器並完成配對。'
    })
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) { panel.hidden = true; integration.setAttribute('aria-expanded', 'false'); integration.focus() }
    })
    document.body.append(host)
    if (enabled) {
      const html = document.documentElement
      heightState = { value: html.style.getPropertyValue('--edulog-toolbar-height'), priority: html.style.getPropertyPriority('--edulog-toolbar-height'), hadStyle: html.hasAttribute('style') }
      const updateHeight = () => html.style.setProperty('--edulog-toolbar-height', `${Math.max(64, root.querySelector('.bar').getBoundingClientRect().height + banner.getBoundingClientRect().height)}px`)
      updateHeight()
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(updateHeight)
        resizeObserver.observe(root.querySelector('.bar'))
        resizeObserver.observe(banner)
      }
    }
  }
  function sync(force = true) {
    if (suspended || !initialized) return
    observer.disconnect()
    try {
    if (!force && enabled && lastPath === location.pathname && enhancement?.isCurrent()) { enhancement.refresh(); syncDialog(); return }
    const active = document.activeElement
    const search = active?.dataset.edulogSearch
    const cursor = search && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null
    const toolbarFocus = host?.shadowRoot.activeElement?.className
    const nativeCursor = typeof active?.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null
    const scrolls = scrollState()
    const pageScroll = [window.scrollX, window.scrollY]
    const keepToolbar = lastPath === location.pathname && host?.isConnected && host.dataset.enabled === String(enabled)
    teardown(enabled && lastPath === location.pathname && dialogEnhancement?.isCurrent?.(), keepToolbar)
    if (lastPath !== location.pathname) {
      pageViews.set(lastPath, view)
      view = pageViews.get(location.pathname) || {}; lastPath = location.pathname
    }
    const page = adapter.matchPage(location.pathname)
    if (!page || !document.querySelector('#page-body > .content')) { boot?.mode(false); teardown(); return }
    if (enabled) enhancement = adapter.enhancePage(document, view, Boolean(boot))
    if (enabled && !enhancement) { boot?.mode(false); teardown(); return }
    boot?.mode(enabled, page)
    if (!host?.isConnected) toolbar(page)
    syncDialog()
    if (search) {
      const input = document.querySelector(`[data-edulog-search="${search}"]`)
      input?.focus({ preventScroll: true })
      if (input && cursor) input.setSelectionRange(...cursor)
    } else if (['toggle', 'menu', 'integration'].includes(toolbarFocus)) {
      host.shadowRoot.querySelector(`.${toolbarFocus}`)?.focus({ preventScroll: true })
    } else if (active?.isConnected && active !== document.body) {
      active.focus({ preventScroll: true })
      if (nativeCursor) active.setSelectionRange(...nativeCursor)
    } else if (view.cachedFocus) {
      const saved = view.cachedFocus
      const target = saved.search ? document.querySelector(`[data-edulog-search="${saved.search}"]`) : saved.id ? document.getElementById(saved.id) : null
      if (target && (!target.closest('.modal') || target.closest('.modal.show'))) {
        target.focus({ preventScroll: true })
        if (saved.cursor && typeof target.setSelectionRange === 'function') target.setSelectionRange(...saved.cursor)
      }
    }
    const currentScrolls = [...document.querySelectorAll('[data-edulog-scroll]')]
    for (const saved of scrolls.length ? scrolls : view.cachedScrolls || []) {
      const element = currentScrolls[saved.index]
      if (element?.dataset.edulogScroll === saved.key) { element.scrollLeft = saved.left; element.scrollTop = saved.top }
    }
    if (window.scrollX !== pageScroll[0] || window.scrollY !== pageScroll[1]) window.scrollTo(...pageScroll)
    } finally { observer.observe(document.documentElement, { childList: true, subtree: true }) }
  }
  const frame = callback => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 0)
  const cancelFrame = id => typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)
  function schedule() {
    if (timer != null) return
    timer = frame(() => { timer = null; sync(false) })
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement
      if (target?.closest('[data-edulog-owned]')) return false
      return target?.closest('.modal,#remote_modal') || [...record.addedNodes, ...record.removedNodes].some(n => n.nodeType === 1 && n.matches('.modal,#remote_modal'))
    })) schedule()
    const nativeChange = records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement
      if (target?.closest('.modal,#remote_modal')) return false
      if (target?.hasAttribute('data-edulog-owned')) return false
      const changed = [...record.addedNodes, ...record.removedNodes]
      if (!target?.closest('#page-body') && !changed.some(node => node.nodeType === 1 && (node.id === 'page-body' || node.querySelector('#page-body')))) return false
      return changed.some(node => node.nodeType !== 1 || (!node.hasAttribute('data-edulog-owned') && !node.matches('.modal,#remote_modal')))
    })
    if (nativeChange) schedule()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  function resume() {
    suspended = false
    // An initially unknown route cannot request preferences. Read them once
    // it navigates into a supported route, while the new content is gated.
    if (needsPreference && adapter.matchPage(location.pathname)) {
      needsPreference = false
      const request = revision, visit = navigation
      preferenceVisit = visit
      let expired = false
      boot?.wait(() => { expired = true; preferenceVisit = null; sync(false) })
      void message({ type: 'get-ui-preferences' }).then(prefs => {
        if (request !== revision || visit !== navigation) return
        boot?.remember(prefs?.enabled !== false && !prefs?.error)
        if (expired) return
        preferenceVisit = null
        enabled = boot ? boot.preferred : prefs?.enabled !== false
        try { sync(false) } finally { boot?.release() }
      }).catch(() => { if (visit === navigation) { preferenceVisit = null; try { sync(false) } finally { boot?.release() } } })
      return
    }
    if (preferenceVisit === navigation) return
    try { sync(false) } finally { boot?.release() }
  }
  function pending() {
    if (enabled) boot?.wait(() => { navigation++; resume() })
  }
  document.addEventListener('turbo:visit', () => {
    navigation++
    if (preferenceVisit !== null) { preferenceVisit = null; needsPreference = true; boot?.release() }
    if (initialized && boot) enabled = boot.preferred
    pending()
  })
  document.addEventListener('turbo:before-cache', () => {
    rememberPosition()
    pending(); suspended = true
    // Turbo clones the native body on a later event-loop tick. Do not reapply
    // until its renderer runs; the document mode remains active throughout.
    observer.disconnect(); teardown(); boot?.cleanSnapshot()
  })
  for (const eventName of ['turbo:before-render', 'turbo:before-frame-render']) document.addEventListener(eventName, event => {
    const original = event.detail?.render
    if (typeof original !== 'function') return
    const visit = navigation
    if (eventName === 'turbo:before-render') { pending(); suspended = true }
    event.detail.render = async function (...args) {
      try {
        const result = await original.apply(this, args)
        if (visit === navigation) {
          if (eventName === 'turbo:before-frame-render') { if (!suspended) sync(false) }
          else resume()
        }
        return result
      } catch (error) {
        if (visit === navigation && eventName === 'turbo:before-render') { suspended = false; boot?.release(); schedule() }
        throw error
      }
    }
  })
  for (const event of ['turbo:load', 'turbo:render', 'turbo:frame-load']) document.addEventListener(event, resume)
  document.addEventListener('turbo:fetch-request-error', () => { navigation++; resume() })
  window.addEventListener('popstate', () => { navigation++; pending(); schedule() })
  // Native Bootstrap tabs update classes rather than replacing content.
  document.addEventListener('shown.bs.tab', event => {
    if (adapter.matchPage(location.pathname)?.kind === 'calendar') schedule()
  })
  document.addEventListener('click', event => {
    if (adapter.matchPage(location.pathname)?.kind === 'calendar' && event.target.closest('.region-title,[id*="weekday-"][id$="-tab"]')) schedule()
  })
  bridge.onInvalidated(() => {
    boot?.release()
    if (suspended) { navigation++; suspended = false; schedule() }
    showNotice('擴充套件已更新，請先儲存正在編輯的內容，再重新整理分頁。')
  })
  bridge.listen(data => {
    if (data?.type === 'ui-preferences-changed') { revision++; enabled = data.enabled !== false; boot?.remember(enabled); sync() }
  })
  // UI is independent of pairing and backend availability.
  const request = revision
  const initial = boot?.ready || message({ type: 'get-ui-preferences' }).catch(() => ({ enabled: false }))
  void initial.then(prefs => {
    needsPreference = prefs?.reason === 'unknown'
    if (request === revision) enabled = boot?.expired ? false : prefs?.enabled !== false
    if (!enabled && !bridge.invalidated && (boot?.expired || ['timeout', 'unavailable'].includes(prefs?.reason))) showNotice('未能及時讀取 UI 偏好，已保留原站。可在當頁啟用 UI 改善。')
    initialized = true
    try { sync() } finally { boot?.release() }
  })
})()
