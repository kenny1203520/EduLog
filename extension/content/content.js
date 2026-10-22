(() => {
  if (globalThis.edulogPageController || window.top !== window) return
  const adapter = globalThis.edulogSiteAdapter
  if (!adapter?.matchesHost(location.hostname)) return
  globalThis.edulogPageController = true
  const boot = globalThis.edulogUiBoot
  const tx = (text, params) => globalThis.edulogUi?.tx(text, params) ?? text
  // Rebuild the enhanced page in the new language; the toolbar re-renders with it.
  globalThis.edulogUi?.subscribe(() => { if (initialized && shown) sync(true) })
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
  // The teaching site's own language, read from the active choice in its locale switcher.
  // The lexicon reads all three of the site's languages; any other keeps the native page.
  const SOURCE_READY = new Set(['zh-TW', 'zh-CN', 'en'])
  function siteLocale() {
    const active = document.querySelector('.locale-selector a.btn-primary[href*="locale="]')
    let value = document.documentElement.lang || ''
    try { if (active) value = new URL(active.getAttribute('href'), location.href).searchParams.get('locale') || value } catch { /* keep the document language */ }
    return /^en/i.test(value) ? 'en' : /^zh-(?:CN|Hans)/i.test(value) ? 'zh-CN' : /^zh/i.test(value) ? 'zh-TW' : null
  }
  let sourceLocale = null
  function recordSiteLocale() {
    const detected = siteLocale(); if (!detected || detected === sourceLocale) return
    sourceLocale = detected; globalThis.edulogUi?.setSourceLocale(detected)
    try { void globalThis.chrome?.storage?.local?.set({ edulogSourceLocale: detected })?.catch?.(() => {}) } catch { /* storage unavailable after the context is invalidated */ }
  }
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
  // Last connection answer, so a rebuilt toolbar shows the known state before checking again.
  let lastStatus = null, lastStatusAt = 0
  // Theme on: sticky toolbar with one primary action and a "more" button. Theme off or this page
  // kind set to original: one floating EduLog button. Both open the same panel (MASTER §6.12).
  function toolbar(page) {
    const ownerDocument = document
    const shell = globalThis.edulogIntegrationUi, presentation = globalThis.edulogConnectionUi
    const { icon, label } = shell
    const toolbarHost = document.createElement('div')
    host = toolbarHost
    toolbarHost.id = 'edulog-extension-root'
    toolbarHost.dataset.edulogOwned = ''
    toolbarHost.dataset.enabled = String(shown)
    const root = toolbarHost.attachShadow({ mode: 'open' })
    const instance = { host: toolbarHost, root, ownerDocument, disposed: false, observer: null, resizeObserver: null, dismissOutside: null, stopLocale: null }
    toolbarLifecycle = instance
    const isCurrent = () => !instance.disposed && toolbarLifecycle === instance && toolbarHost.isConnected && toolbarHost.shadowRoot === root
    const context = presentation?.pageContext(location.href) || { kind: 'other' }
    const opener = 'aria-haspopup="dialog" aria-expanded="false" aria-controls="edulog-panel" data-focus="integration"'
    const conn = extra => `<span class="conn" data-tone="neutral"><span class="dot" aria-hidden="true"></span><span class="conn-text${extra}"></span></span>`
    const trigger = shown
      ? `<div class="bar"><button class="menu btn btn-icon" type="button" aria-expanded="false" data-focus="menu">${icon('menu', 'lg')}</button><span class="logo" aria-hidden="true">E</span>
        <div class="tb-title"><b class="title"></b><span class="tb-sub"></span></div>
        <div class="tb-actions">${conn(' conn-label')}<button class="primary btn btn-primary btn-sm" type="button" data-focus="primary" hidden><span class="primary-icon"></span><span class="primary-text"></span></button>
        <button class="integration btn btn-icon" type="button" ${opener}>${icon('more', 'lg')}</button></div></div><div class="notice" role="status" hidden></div>`
      : `<div class="dock"><div class="notice" role="status" hidden></div><button class="integration fab" type="button" ${opener}><span class="logo" aria-hidden="true">E</span><span class="fab-dot" data-tone="neutral" aria-hidden="true"></span></button></div>`
    root.innerHTML = `<style>${shell.styles}</style>${trigger}
    <section class="panel" id="edulog-panel" role="dialog" aria-labelledby="edulog-panel-title" tabindex="-1" data-place="${shown ? 'top' : 'bottom'}" hidden>
      <div class="fp-head"><span class="logo" aria-hidden="true">E</span><b class="panel-title" id="edulog-panel-title">EduLog</b><span class="spacer"></span>${conn('')}<button class="panel-close btn btn-icon" type="button">${icon('x', 'lg')}</button></div>
      <div class="fp-body"><div class="switch-slot"></div>
        <button class="panel-primary btn btn-primary btn-block" type="button" data-focus="panel-primary" hidden><span class="primary-icon"></span><span class="primary-text"></span></button>
        <div class="links"${shown ? '' : ' hidden'}><button class="linkrow open-workspace" type="button">${icon('dashboard')}<span class="open-workspace-text"></span></button><button class="linkrow open-work" type="button">${icon('history')}<span class="open-work-text"></span></button></div>
        <div class="fp-conn" data-tone="neutral"><span class="fp-icon"></span><div><p class="status" role="status" aria-live="polite"><span class="status-text"></span></p><p class="status-meta"></p></div></div>
        <div class="fp-actions"><button class="retry btn btn-secondary btn-sm" type="button" hidden></button></div>
        <details class="diagnostics" hidden><summary></summary><p class="diagnostic-text"></p></details></div>
      <details class="preferences fp-foot"><summary class="linkrow">${icon('settings')}<span class="preferences-label"></span><span class="chev">${icon('chevron')}</span></summary>
        <div class="prefs-body"><div class="toggle-slot"></div><div class="language-slot"></div><button class="settings btn btn-secondary btn-sm" type="button" hidden>${icon('external')}<span class="settings-text"></span></button></div></details>
    </section>`
    const part = selector => root.querySelector(selector)
    // Replace a text holder so a keyed binding never overwrites a raw message later.
    const put = (selector, key, params) => { const old = part(selector), fresh = old.cloneNode(false); delete fresh.dataset.i18n; old.replaceWith(fresh); if (key) label(fresh, key, params); return fresh }
    const putText = (selector, value) => { const element = put(selector); element.textContent = value; return element }
    for (const [selector, key] of [['.open-workspace-text', 'shell.openWorkspace'], ['.open-work-text', 'shell.workLog'], ['.preferences-label', 'ui.settings'], ['.settings-text', 'shell.integrationSettings'], ['.retry', 'shell.retry'], ['.diagnostics summary', 'shell.diagnostics']]) label(part(selector), key)
    label(part('.panel-close'), 'shell.close', {}, 'aria-label')
    if (shown) {
      label(part('.integration'), 'shell.more', {}, 'aria-label')
      label(part('.menu'), 'ui.navigation', {}, 'aria-label')
      // On class pages the title carries the short class name from the navigation bar.
      const currentClass = globalThis.edulogSiteNavigation?.currentClass(document)
      part('.title').textContent = currentClass ? currentClass.primary : tx(page.title)
      part('.tb-sub').textContent = currentClass ? tx(page.title) : ''
    } else label(part('.integration'), 'shell.fab', { state: '…' }, 'aria-label')
    const switchControl = (name, key, helpKey, checked) => {
      const control = document.createElement('button')
      control.type = 'button'; control.className = `switch ${name}`; control.dataset.focus = name
      control.setAttribute('role', 'switch'); control.setAttribute('aria-checked', String(checked))
      const text = document.createElement('span'), title = document.createElement('span'), help = document.createElement('small'), track = document.createElement('span')
      title.className = 'switch-label'; title.id = `${name}-label`; help.id = `${name}-help`; track.className = 'track'; track.setAttribute('aria-hidden', 'true')
      label(title, key); label(help, helpKey); text.append(title, help); control.append(text, track)
      control.setAttribute('aria-labelledby', title.id); control.setAttribute('aria-describedby', help.id)
      return control
    }
    // The page switch is offered while the theme is on; with the theme off the theme switch takes its place.
    const pageMode = switchControl('page-mode', 'shell.applyPage', 'shell.applyPageHelp', shown)
    pageMode.hidden = !enabled || (!shown && !pageOriginal(page))
    const themeToggle = switchControl('toggle', 'shell.theme', 'shell.themeHelp', enabled)
    part('.switch-slot').append(pageMode)
    part(enabled ? '.toggle-slot' : '.switch-slot').append(themeToggle)
    if (globalThis.edulogUi) {
      const language = document.createElement('label'), name = document.createElement('span')
      name.className = 'lbl'; label(name, 'ui.language'); language.className = 'field'; language.append(name, globalThis.edulogUi.languageSelect())
      part('.language-slot').append(language)
    }
    instance.stopLocale = globalThis.edulogUiLegacy?.watch(root)
    const banner = part('.notice')
    banner.textContent = notice
    banner.hidden = !notice
    themeToggle.addEventListener('click', async () => {
      enabled = !enabled
      revision++
      failedPath = null
      showNotice('')
      sync()
      if (failedPath) return // A failed application must not overwrite the saved preference.
      boot?.remember(enabled)
      try {
        const result = await message({ type: 'set-ui-preferences', enabled })
        if (result?.error) throw new Error(tx('偏好設定暫時無法儲存。'))
        boot?.store({ enabled, pages: pageModes })
      } catch (error) { showNotice(tx('{message} 主題切換僅作用於當頁，偏好未儲存。', { message: error.message })) }
    })
    pageMode.addEventListener('click', async () => {
      const mode = pageOriginal(page) ? 'enhanced' : 'original'
      const { [page.kind]: _previous, ...others } = pageModes
      pageModes = mode === 'original' ? { ...others, [page.kind]: 'original' } : others
      revision++
      sync()
      try {
        const result = await message({ type: 'set-ui-preferences', page: page.kind, pageMode: mode })
        if (result?.error) throw new Error(tx('偏好設定暫時無法儲存。'))
        boot?.store({ enabled, pages: pageModes })
      } catch (error) { showNotice(tx('{message} 本頁切換僅作用於當頁，偏好未儲存。', { message: error.message })) }
    })
    part('.menu')?.addEventListener('click', event => {
      const open = document.documentElement.toggleAttribute('data-edulog-nav-open')
      event.currentTarget.setAttribute('aria-expanded', String(open))
      if (open) document.querySelector('#edulog-nav a, #edulog-nav button:not(.edulog-nav-close)')?.focus()
    })
    const panel = part('.panel'), integration = part('.integration'), closeButton = part('.panel-close'), retry = part('.retry')
    const actionKey = { class: 'shell.syncClass', report: 'shell.prefill' }[context.kind] || 'shell.openWorkspace'
    function applyStatus(result) {
      const state = presentation?.describe(result?.status) || { tone: 'neutral', key: 'conn.unavailable', chip: '' }
      const chip = () => globalThis.edulogUi?.t(`${state.key}.chip`) ?? state.chip
      for (const element of root.querySelectorAll('.conn')) element.dataset.tone = state.tone
      for (const element of root.querySelectorAll('.conn-text')) label(element, `${state.key}.chip`)
      const dot = part('.fab-dot')
      if (dot) { dot.dataset.tone = state.tone; label(integration, 'shell.fab', () => ({ state: chip() }), 'aria-label') }
      const connected = result?.status === 'connected'
      const action = presentation?.primaryAction(context, result?.capabilities) || { flow: 'import', icon: 'dashboard', ready: true }
      for (const button of root.querySelectorAll('.primary, .panel-primary')) {
        button.dataset.flow = action.flow
        button.querySelector('.primary-icon').innerHTML = icon(action.icon)
        label(button.querySelector('.primary-text'), actionKey)
        button.disabled = !action.ready
      }
      const toolbarPrimary = part('.primary')
      if (toolbarPrimary) toolbarPrimary.hidden = !connected || !action.ready
      part('.panel-primary').hidden = shown || !connected
      part('.open-workspace').hidden = shown && connected && context.kind === 'other'
      part('.fp-conn').dataset.tone = state.tone
      part('.fp-icon').innerHTML = icon(connected ? 'check' : state.tone === 'danger' ? 'alert' : 'plug')
      if (connected) {
        let origin = result.origin || ''
        try { origin = new URL(origin).host } catch { /* Keep the raw value. */ }
        putText('.status-text', origin || chip())
        if (!action.ready) put('.status-meta', 'shell.notReady')
        else if (result.lastVerifiedAt) put('.status-meta', 'shell.verified', { time: new Date(result.lastVerifiedAt).toLocaleString() })
        else put('.status-meta')
      } else {
        put('.status-text', `${state.key}.label`)
        put('.status-meta', ['not-connected', 'expired', 'revoked', 'pairing-expired'].includes(result?.status) ? 'shell.connectHint' : `${state.key}.detail`)
      }
      part('.diagnostics').hidden = !result?.diagnostic
      part('.diagnostic-text').textContent = result?.diagnostic ? [result.diagnostic.code, result.diagnostic.message, result.diagnostic.requestId ? tx('請求編號：{id}', { id: result.diagnostic.requestId }) : ''].filter(Boolean).join(' — ') : ''
      retry.hidden = !['unavailable', 'forbidden'].includes(result?.status)
      part('.settings').hidden = !connected
      part('.settings').disabled = !result?.settingsUrl
    }
    const checkConnection = async () => {
      put('.status-text', 'shell.checking'); put('.status-meta')
      retry.disabled = true
      try {
        const result = await message({ type: 'get-edulog-integration-status' })
        lastStatus = result; lastStatusAt = Date.now()
        if (isCurrent()) applyStatus(result)
      } catch (error) {
        if (!isCurrent()) return
        putText('.status-text', bridge.invalidated ? tx('通訊已停止；清晰主題與原站操作仍可使用。') : error.message)
        retry.hidden = bridge.invalidated
      } finally { if (isCurrent()) retry.disabled = false }
    }
    retry.addEventListener('click', () => { void checkConnection() })
    const runFlow = async (flow, button) => {
      button.disabled = true
      try {
        const result = await message({ type: 'open-integration-workspace', flow })
        if (!result?.opened) throw new Error(result?.error?.message || globalThis.edulogUi?.t('shell.openFailed') || tx('無法開啟整合工作台。'))
      } catch (error) { if (isCurrent()) putText('.status-meta', error.message) }
      finally { if (isCurrent()) button.disabled = false }
    }
    for (const button of root.querySelectorAll('.primary, .panel-primary')) button.addEventListener('click', () => { void runFlow(button.dataset.flow, button) })
    part('.open-workspace').addEventListener('click', event => { void runFlow('import', event.currentTarget) })
    part('.open-work').addEventListener('click', event => { void runFlow('work', event.currentTarget) })
    // A manual popover keeps the panel in the top layer; click-outside and Esc stay ours.
    const popover = typeof panel.showPopover === 'function'
    if (popover) panel.setAttribute('popover', 'manual')
    const openPanel = () => {
      panel.hidden = false
      if (popover && !panel.matches(':popover-open')) panel.showPopover()
      integration.setAttribute('aria-expanded', 'true')
      // The dialog itself takes focus; Tab then reaches its first control.
      panel.focus({ preventScroll: true })
      void checkConnection()
    }
    const closePanel = (restoreFocus = false) => {
      if (popover && panel.matches(':popover-open')) panel.hidePopover()
      panel.hidden = true
      integration.setAttribute('aria-expanded', 'false')
      if (restoreFocus && integration.isConnected) integration.focus()
    }
    closeButton.addEventListener('click', () => closePanel(true))
    const dismissOutside = event => {
      const path = event.composedPath()
      if (isCurrent() && !panel.hidden && !path.includes(panel) && !path.includes(integration)) closePanel()
    }
    instance.dismissOutside = dismissOutside
    ownerDocument.addEventListener('pointerdown', dismissOutside, true)
    integration.addEventListener('click', () => { if (panel.hidden) openPanel(); else closePanel() })
    part('.settings').addEventListener('click', async () => {
      const result = await message({ type: 'open-edulog-settings' }).catch(error => { if (isCurrent()) showNotice(error.message); return null })
      if (isCurrent() && !result?.opened) putText('.status-meta', tx('請點選瀏覽器工具列的 EduLog 圖示，設定伺服器並完成配對。'))
    })
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) closePanel(true)
    })
    if (lastStatus) applyStatus(lastStatus)
    document.body.append(toolbarHost)
    if (!lastStatus || Date.now() - lastStatusAt > 30000) void checkConnection()
    instance.observer = new MutationObserver(() => {
      if (instance.host.isConnected) return
      disposeToolbar(instance)
    })
    instance.observer.observe(document.body, { childList: true, subtree: true })
    if (shown) {
      const html = document.documentElement
      heightState = { value: html.style.getPropertyValue('--edulog-toolbar-height'), priority: html.style.getPropertyPriority('--edulog-toolbar-height'), hadStyle: html.hasAttribute('style') }
      const updateHeight = () => { if (isCurrent()) html.style.setProperty('--edulog-toolbar-height', `${Math.max(48, part('.bar').getBoundingClientRect().height + banner.getBoundingClientRect().height)}px`) }
      updateHeight()
      if (typeof ResizeObserver !== 'undefined') {
        instance.resizeObserver = resizeObserver = new ResizeObserver(updateHeight)
        instance.resizeObserver.observe(part('.bar'))
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
    const toolbarFocus = host?.shadowRoot.activeElement?.dataset.focus
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
    const unsupportedLocale = wanted && sourceLocale && !SOURCE_READY.has(sourceLocale)
    const health = !wanted ? null : unsupportedLocale ? { ok: false, reason: 'locale' } : adapter.checkPage?.(document, page.kind)
    if (health?.reason === 'denied') { shown = false; boot?.mode(false); teardown(); return }
    shown = wanted && health?.ok !== false
    if (wanted && !shown) {
      // Provider markup no longer matches the lexicon: keep the native page usable.
      healthNotice = true
      showNotice(health?.reason === 'locale' ? tx('原站目前的語言尚未支援；請切回繁體中文以使用 EduLog 功能。') : tx('此頁暫用原站畫面：原站版面可能已更新，EduLog 暫時無法辨識。'))
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
    } else if (toolbarFocus) {
      // A control inside the closed panel cannot take focus; its opener can.
      const target = host.shadowRoot.querySelector(`[data-focus="${toolbarFocus}"]`)
      target?.focus({ preventScroll: true })
      if (host.shadowRoot.activeElement !== target) host.shadowRoot.querySelector('.integration')?.focus({ preventScroll: true })
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
      showNotice(tx('本頁清晰主題暫時無法套用，已使用原站主題。可重新套用或重新整理。'))
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
    showNotice(tx('擴充套件已更新，請先儲存正在編輯的內容，再重新整理分頁。'))
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
    if (!enabled && !bridge.invalidated && ['timeout', 'unavailable'].includes(prefs?.reason)) showNotice(tx('未能及時讀取主題偏好，已保留原站。可在當頁套用清晰主題。'))
    recordSiteLocale()
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
