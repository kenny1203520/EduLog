(() => {
  if (globalThis.edulogPageController || window.top !== window) return
  const adapter = globalThis.edulogSiteAdapter
  if (!adapter?.matchesHost(location.hostname)) return
  globalThis.edulogPageController = true
  const boot = globalThis.edulogUiBoot
  let enabled = false, enhancement, host, toolbarLifecycle, suspended = false, timer, resizeObserver, heightState
  let initialized = false, revision = 0, navigation = 0, needsPreference = false
  let preferenceVisit = null
  let failedPath = null
  // `enabled` is the saved theme preference; `shown` is whether this page is enhanced
  // after the per-page "original" choice and the provider health check.
  let pageModes = {}, shown = false, healthNotice = false
  const pageOriginal = page => Boolean(page && pageModes[page.kind] === 'original')
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

  function restoreToolbarHeight(ownerDocument = toolbarLifecycle?.ownerDocument ?? globalThis.document) {
    if (!heightState) return
    const html = ownerDocument?.documentElement
    if (!html) { heightState = null; return }
    const style = html.style
    if (heightState.value) style.setProperty('--edulog-toolbar-height', heightState.value, heightState.priority)
    else style.removeProperty('--edulog-toolbar-height')
    if (!heightState.hadStyle && !html.getAttribute('style')) html.removeAttribute('style')
    heightState = null
  }

  function disposeToolbar(instance = toolbarLifecycle, removeNode = false) {
    if (!instance || instance.disposed) return
    instance.disposed = true
    instance.observer?.disconnect()
    instance.resizeObserver?.disconnect()
    const ownerDocument = instance.ownerDocument ?? globalThis.document
    ownerDocument?.removeEventListener('pointerdown', instance.dismissOutside, true)
    instance.stopLocale?.()
    if (removeNode) instance.host?.remove()
    if (toolbarLifecycle === instance) {
      toolbarLifecycle = null
      if (host === instance.host) host = null
      if (resizeObserver === instance.resizeObserver) resizeObserver = null
      restoreToolbarHeight(ownerDocument)
      ownerDocument?.documentElement?.removeAttribute('data-edulog-nav-open')
    }
  }

  function teardown(keepDialog = false, keepToolbar = false) {
    cancelFrame(timer)
    timer = null
    if (!keepDialog) { dialogEnhancement?.restore(); dialogEnhancement = null }
    enhancement?.restore()
    enhancement = null
    if (keepToolbar) return
    disposeToolbar(toolbarLifecycle, true)
    host = null
    resizeObserver?.disconnect()
    resizeObserver = null
    restoreToolbarHeight()
    document.documentElement.removeAttribute('data-edulog-nav-open')
  }
  function toolbar(page) {
    const ownerDocument = document
    const toolbarHost = document.createElement('div')
    host = toolbarHost
    toolbarHost.id = 'edulog-extension-root'
    toolbarHost.dataset.edulogOwned = ''
    toolbarHost.dataset.enabled = String(shown)
    const root = toolbarHost.attachShadow({ mode: 'open' })
    const instance = { host: toolbarHost, root, ownerDocument, disposed: false, observer: null, resizeObserver: null, dismissOutside: null, stopLocale: null }
    toolbarLifecycle = instance
    const isCurrent = () => !instance.disposed && toolbarLifecycle === instance && toolbarHost.isConnected && toolbarHost.shadowRoot === root
    root.innerHTML = `<style>
      :host{all:initial;position:fixed;inset:0 0 auto;z-index:1040;color:var(--edulog-text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
      *{box-sizing:border-box}button{font:inherit;cursor:pointer;min-height:44px;padding:8px 12px;border:1px solid var(--edulog-border-strong);border-radius:8px;background:white;color:var(--edulog-text-secondary)}
      button:hover{background:var(--edulog-primary-soft)}button:focus-visible{outline:3px solid var(--edulog-focus-ring);outline-offset:2px}
      .bar{display:flex;gap:12px;align-items:center;min-height:64px;padding:8px 20px;background:white;border-bottom:1px solid var(--edulog-border);box-shadow:var(--edulog-shadow-bar)}
      strong{color:var(--edulog-primary)}.title{flex:1}.toggle{color:var(--edulog-primary);font-weight:600}.menu{display:none}
      .panel{position:fixed;right:16px;top:72px;margin:0;padding:16px;width:min(400px,calc(100vw - 32px));max-width:400px;max-height:calc(100dvh - 88px);overflow:auto;overscroll-behavior:contain;background:white;border:1px solid var(--edulog-border);border-radius:12px;box-shadow:var(--edulog-shadow-popover)}
      .panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.panel-heading strong{min-width:0;overflow-wrap:anywhere}.panel-close{flex:none!important;width:44px!important;min-width:44px;padding:8px!important;margin:0!important;font-size:20px;line-height:1}
      .panel[hidden]{display:none}p{margin:8px 0;color:var(--edulog-text-muted)}.panel p{font-size:14px}.panel button{margin-top:8px}.panel .panel-close{margin-top:0}.note{font-size:14px}
      :host([data-enabled="false"]){inset:auto 16px 20px auto;max-width:calc(100vw - 32px)}.bar{border-radius:0}
      :host([data-enabled="false"]) .bar{padding:6px;border:1px solid var(--edulog-border);border-radius:12px}
      :host([data-enabled="false"]) .bar>:not(.integration):not(.page-mode){display:none}.page-mode[hidden]{display:none!important}
      :host([data-enabled="false"]) .panel{top:auto;right:16px;bottom:86px;width:min(400px,calc(100vw - 32px));max-width:400px;max-height:calc(100dvh - 112px)}
      .preferences{border-top:1px solid var(--edulog-border);margin-top:12px}.preferences summary{min-height:44px;display:flex;align-items:center;cursor:pointer}.preferences select{font:inherit;min-height:44px;max-width:100%;margin-top:8px}
      @media(max-width:991px){.menu{display:block}.bar{padding:8px 12px;gap:8px}.title{font-size:14px}}
      @media(max-width:480px){.brand{display:none}.bar{flex-wrap:wrap}.title{flex-basis:calc(100% - 70px)}.panel{right:8px;width:min(400px,calc(100vw - 16px));max-width:400px;max-height:calc(100dvh - 152px)}}
    </style><div class="bar"><button class="menu" type="button" aria-label="切換網站導覽" aria-expanded="false">導覽</button><strong class="brand">EduLog</strong><span class="title"></span><button class="page-mode" type="button" hidden></button><button class="integration" type="button" aria-expanded="false">EduLog 功能</button></div>
    <section class="panel" aria-label="EduLog 整合功能" hidden><div class="panel-heading"><strong>EduLog 連線與整合</strong><button class="panel-close" type="button" aria-label="關閉 EduLog 整合面板">×</button></div><p class="status" role="status" aria-live="polite"></p><p class="note">清晰主題不需要配對。下方可查看教學整合的規劃流程；原站的報告操作可照常使用。</p><button class="settings" type="button">開啟整合設定</button></section>`
    // On class pages the title carries the short class name from the navigation bar.
    const currentClass = globalThis.edulogSiteNavigation?.currentClass(document)
    root.querySelector('.title').textContent = currentClass ? `${page.title} · ${currentClass.primary}` : page.title
    const preferences=document.createElement('details');preferences.className='preferences'
    const preferenceTitle=document.createElement('summary');preferenceTitle.textContent='設定';preferences.append(preferenceTitle)
    const themeToggle=document.createElement('button');themeToggle.type='button';themeToggle.className='toggle';preferences.append(themeToggle);root.querySelector('.panel').append(preferences)
    if(globalThis.edulogUi){const style=document.createElement('style');style.textContent=globalThis.edulogUi.styles;root.append(style);preferences.append(globalThis.edulogUi.languageSelect());globalThis.edulogUi.text(preferenceTitle,'ui.settings');globalThis.edulogUi.text(root.querySelector('.integration'),'ui.integration');globalThis.edulogUi.text(root.querySelector('.menu'),'ui.navigation')}
    instance.stopLocale=globalThis.edulogUiLegacy?.watch(root)
    const banner = document.createElement('div')
    banner.className = 'notice'
    banner.style.cssText = 'padding:10px 16px;background:var(--edulog-status-notice-soft);color:var(--edulog-status-notice-text);max-width:100vw'
    banner.setAttribute('role', 'status')
    banner.textContent = notice
    banner.hidden = !notice
    root.querySelector('.bar').after(banner)
    root.querySelector('.toggle').textContent = enabled ? globalThis.edulogIntegrationUi.theme.original : globalThis.edulogIntegrationUi.theme.apply
    if(globalThis.edulogUi)globalThis.edulogUi.text(root.querySelector('.toggle'),enabled?'ui.themeOff':'ui.themeOn')
    root.querySelector('.toggle').title = enabled ? '目前使用 EduLog 清晰主題' : '套用 EduLog 清晰主題'
    root.querySelector('.toggle').addEventListener('click', async () => {
      enabled = !enabled
      revision++
      failedPath = null
      showNotice('')
      sync()
      if (failedPath) return // A failed application must not overwrite the saved preference.
      boot?.remember(enabled)
      try {
        const result = await message({ type: 'set-ui-preferences', enabled })
        if (result?.error) throw new Error('偏好設定暫時無法儲存。')
        boot?.store({ enabled, pages: pageModes })
      } catch (error) { showNotice(`${error.message} 主題切換僅作用於當頁，偏好未儲存。`) }
    })
    const pageMode = root.querySelector('.page-mode')
    // Offered only while the theme is on and the page itself is healthy.
    pageMode.hidden = !enabled || (!shown && !pageOriginal(page))
    pageMode.textContent = shown ? '本頁看原版' : '本頁套用 EduLog'
    pageMode.setAttribute('aria-pressed', String(!shown))
    pageMode.title = shown ? '只有這類頁面改回原站畫面，其他頁面維持 EduLog 主題' : '這類頁面改回 EduLog 主題'
    pageMode.addEventListener('click', async () => {
      const mode = pageOriginal(page) ? 'enhanced' : 'original'
      const { [page.kind]: _previous, ...others } = pageModes
      pageModes = mode === 'original' ? { ...others, [page.kind]: 'original' } : others
      revision++
      sync()
      try {
        const result = await message({ type: 'set-ui-preferences', page: page.kind, pageMode: mode })
        if (result?.error) throw new Error('偏好設定暫時無法儲存。')
        boot?.store({ enabled, pages: pageModes })
      } catch (error) { showNotice(`${error.message} 本頁切換僅作用於當頁，偏好未儲存。`) }
    })
    root.querySelector('.menu').addEventListener('click', event => {
      const open = document.documentElement.toggleAttribute('data-edulog-nav-open')
      event.currentTarget.setAttribute('aria-expanded', String(open))
      if (open) document.querySelector('#edulog-nav a, #edulog-nav button:not(.edulog-nav-close)')?.focus()
    })
    const panel = root.querySelector('.panel'), integration = root.querySelector('.integration')
    panel.style.overflowWrap = 'anywhere'
    const diagnostics = document.createElement('details')
    diagnostics.hidden = true
    const summary = document.createElement('summary')
    summary.textContent = '診斷資訊'
    const detail = document.createElement('p')
    diagnostics.append(summary, detail)
    panel.append(diagnostics)
    root.querySelector('.note').textContent = '清晰主題無須配對；教學整合將連接你設定的 EduLog。'
    const features = document.createElement('section')
    features.setAttribute('aria-label', '教學整合規劃')
    panel.append(features)
    const featureUi = globalThis.edulogIntegrationUi.mount(features)
    featureUi.update('not-connected')
    const retry = document.createElement('button')
    retry.type = 'button'; retry.textContent = '重新檢查'; retry.hidden = true
    panel.append(retry)
    const checkConnection = async () => {
      const status = root.querySelector('.status')
      status.textContent = '正在檢查連線…'
      retry.disabled = true
      try {
        const result = await message({ type: 'get-edulog-integration-status' })
        if (!isCurrent()) return
        const state = globalThis.edulogConnectionUi.describe(result?.status)
        featureUi.update(result)
        status.textContent = `${state.label}：${state.detail}${result?.origin ? ` ${result.origin}` : ''}${result?.lastVerifiedAt ? ` 最近驗證：${new Date(result.lastVerifiedAt).toLocaleString()}` : ''}`
        diagnostics.hidden = !result?.diagnostic
        detail.textContent = result?.diagnostic ? [result.diagnostic.code, result.diagnostic.message, result.diagnostic.requestId ? `請求編號：${result.diagnostic.requestId}` : ''].filter(Boolean).join(' — ') : ''
        retry.hidden = !['unavailable', 'connected', 'forbidden'].includes(result?.status)
        root.querySelector('.settings').hidden = result?.status !== 'connected'
        root.querySelector('.settings').disabled = !result?.settingsUrl
      } catch (error) {
        if (!isCurrent()) return
        status.textContent = bridge.invalidated ? '通訊已停止；清晰主題與原站操作仍可使用。' : error.message
        retry.hidden = bridge.invalidated
      } finally { if (isCurrent()) retry.disabled = false }
    }
    retry.addEventListener('click', () => { void checkConnection() })
    const closePanel = (restoreFocus = false) => {
      panel.hidden = true
      integration.setAttribute('aria-expanded', 'false')
      if (restoreFocus && integration.isConnected) integration.focus()
    }
    const closeButton = root.querySelector('.panel-close')
    if (globalThis.edulogUi) {
      globalThis.edulogUi.text(root.querySelector('.panel-heading strong'), 'ui.integrationPanel')
      globalThis.edulogUi.text(closeButton, 'ui.closePanel', {}, 'aria-label')
    }
    closeButton.addEventListener('click', () => closePanel(true))
    const dismissOutside = event => {
      const path = event.composedPath()
      if (isCurrent() && !panel.hidden && !path.includes(panel) && !path.includes(integration)) closePanel()
    }
    instance.dismissOutside = dismissOutside
    ownerDocument.addEventListener('pointerdown', dismissOutside, true)
    integration.addEventListener('click', async () => {
      panel.hidden = !panel.hidden
      integration.setAttribute('aria-expanded', String(!panel.hidden))
      if (panel.hidden) return
      closeButton.focus()
      await checkConnection()
    })
    root.querySelector('.settings').addEventListener('click', async () => {
      const result = await message({ type: 'open-edulog-settings' }).catch(error => { if (isCurrent()) showNotice(error.message); return null })
      if (isCurrent() && !result?.opened) root.querySelector('.status').textContent = '請點選瀏覽器工具列的 EduLog 圖示，設定伺服器並完成配對。'
    })
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) closePanel(true)
    })
    document.body.append(toolbarHost)
    instance.observer = new MutationObserver(() => {
      if (instance.host.isConnected) return
      disposeToolbar(instance)
    })
    instance.observer.observe(document.body, { childList: true, subtree: true })
    if (shown) {
      const html = document.documentElement
      heightState = { value: html.style.getPropertyValue('--edulog-toolbar-height'), priority: html.style.getPropertyPriority('--edulog-toolbar-height'), hadStyle: html.hasAttribute('style') }
      const updateHeight = () => { if (isCurrent()) html.style.setProperty('--edulog-toolbar-height', `${Math.max(64, root.querySelector('.bar').getBoundingClientRect().height + banner.getBoundingClientRect().height)}px`) }
      updateHeight()
      if (typeof ResizeObserver !== 'undefined') {
        instance.resizeObserver = resizeObserver = new ResizeObserver(updateHeight)
        instance.resizeObserver.observe(root.querySelector('.bar'))
        instance.resizeObserver.observe(banner)
      }
    }
  }
  function sync(force = true) {
    if (suspended || !initialized) return
    if (failedPath && failedPath !== location.pathname) {
      failedPath = null; enabled = boot?.preferred ?? enabled; showNotice('')
    }
    observer.disconnect()
    const active = document.activeElement
    const nativeCursor = typeof active?.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null
    const pageScroll = [window.scrollX, window.scrollY]
    try {
    if (!force && enabled && lastPath === location.pathname && enhancement?.isCurrent()) { enhancement.refresh(); syncDialog(); return }
    const search = active?.dataset.edulogSearch
    const cursor = search && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null
    const toolbarFocus = host?.shadowRoot.activeElement?.className
    const scrolls = scrollState()
    const wanted = enabled && !pageOriginal(adapter.matchPage(location.pathname))
    const keepToolbar = lastPath === location.pathname && host?.isConnected && host.dataset.enabled === String(wanted)
    teardown(wanted && lastPath === location.pathname && dialogEnhancement?.isCurrent?.(), keepToolbar)
    if (lastPath !== location.pathname) {
      pageViews.set(lastPath, view)
      view = pageViews.get(location.pathname) || {}; lastPath = location.pathname
    }
    const page = adapter.matchPage(location.pathname)
    if (!page || !document.querySelector(adapter.lexicon?.selectors.content || '#page-body > .content')) { shown = false; boot?.mode(false); teardown(); return }
    if (healthNotice) { healthNotice = false; showNotice('') }
    const health = wanted ? adapter.checkPage?.(document, page.kind) : null
    if (health?.reason === 'denied') { shown = false; boot?.mode(false); teardown(); return }
    shown = wanted && health?.ok !== false
    if (wanted && !shown) {
      // Provider markup no longer matches the lexicon: keep the native page usable.
      healthNotice = true
      showNotice('此頁暫用原站畫面：原站版面可能已更新，EduLog 暫時無法辨識。')
      if (host?.isConnected) teardown()
    }
    if (shown) enhancement = adapter.enhancePage(document, view, Boolean(boot))
    if (shown && !enhancement) { shown = false; boot?.mode(false); teardown(); return }
    boot?.mode(shown, page)
    if (!host?.isConnected) toolbar(page)
    syncDialog()
    if (search) {
      const input = document.querySelector(`[data-edulog-search="${search}"]`)
      input?.focus({ preventScroll: true })
      if (input && cursor) input.setSelectionRange(...cursor)
    } else if (['toggle', 'menu', 'integration', 'page-mode'].includes(toolbarFocus)) {
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
    } catch {
      observer.disconnect()
      failedPath = location.pathname
      enabled = false
      shown = false
      teardown()
      boot?.mode(false)
      boot?.release()
      showNotice('本頁清晰主題暫時無法套用，已使用原站主題。可重新套用或重新整理。')
      const page = adapter.matchPage(location.pathname)
      if (page && document.body) toolbar(page)
      if (active?.isConnected && active !== document.body) {
        active.focus({ preventScroll: true })
        if (nativeCursor) active.setSelectionRange(...nativeCursor)
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
        if (prefs?.pages) pageModes = prefs.pages
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
    if (failedPath) { failedPath = null; showNotice('') }
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
    if (data?.type === 'ui-preferences-changed') { revision++; failedPath = null; showNotice(''); enabled = data.enabled !== false; pageModes = data.pages || {}; boot?.remember(enabled); boot?.store({ enabled, pages: pageModes }); sync() }
  })
  // UI is independent of pairing and backend availability.
  const request = revision
  const initial = boot?.ready || message({ type: 'get-ui-preferences' }).catch(() => ({ enabled: false }))
  void initial.then(prefs => {
    needsPreference = prefs?.reason === 'unknown'
    if (request === revision) { enabled = prefs?.enabled !== false; pageModes = prefs?.pages || {} }
    if (!enabled && !bridge.invalidated && ['timeout', 'unavailable'].includes(prefs?.reason)) showNotice('未能及時讀取主題偏好，已保留原站。可在當頁套用清晰主題。')
    initialized = true
    try { sync() } finally { boot?.release() }
    return boot?.confirmed
  }).then(confirmed => {
    // The background's answer is the source of truth: it arrives late after a timeout, or
    // differs from the page's cached copy. A choice the teacher made meanwhile wins.
    if (!confirmed || request !== revision) return
    const samePages = JSON.stringify(confirmed.pages) === JSON.stringify(pageModes)
    if (confirmed.enabled === enabled && samePages) return
    enabled = confirmed.enabled; pageModes = confirmed.pages; failedPath = null
    showNotice('')
    sync()
  })
})()
