(() => {
  if (globalThis.edulogPageController || window.top !== window) return
  const adapter = globalThis.edulogSiteAdapter
  if (!adapter?.matchesHost(location.hostname)) return
  globalThis.edulogPageController = true
  let enabled = true, enhancement, host, suspended = false, timer, resizeObserver, heightState
  let view = {}, lastPath = location.pathname
  const bridge = globalThis.edulogRuntime
  const message = data => bridge.send(data)
  let notice = ''
  function showNotice(text) {
    notice = text
    const element = host?.shadowRoot.querySelector('.notice')
    if (element) { element.textContent = text; element.hidden = !text }
  }

  function teardown() {
    clearTimeout(timer)
    enhancement?.restore()
    enhancement = null
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
  function sync() {
    if (suspended) return
    const active = document.activeElement
    const search = active?.dataset.edulogSearch
    const cursor = search ? [active.selectionStart, active.selectionEnd] : null
    const toolbarFocus = host?.shadowRoot.activeElement?.className
    teardown()
    if (lastPath !== location.pathname) { view = {}; lastPath = location.pathname }
    const page = adapter.matchPage(location.pathname)
    if (!page || !document.querySelector('#page-body > .content')) return
    if (enabled) enhancement = adapter.enhancePage(document, view)
    toolbar(page)
    if (search) {
      const input = document.querySelector(`[data-edulog-search="${search}"]`)
      input?.focus({ preventScroll: true })
      if (input && cursor) input.setSelectionRange(...cursor)
    } else if (['toggle', 'menu', 'integration'].includes(toolbarFocus)) {
      host.shadowRoot.querySelector(`.${toolbarFocus}`)?.focus({ preventScroll: true })
    }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(sync, 80) }
  const observer = new MutationObserver(records => {
    const nativeChange = records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement
      if (target?.closest('[data-edulog-owned]')) return false
      const changed = [...record.addedNodes, ...record.removedNodes]
      if (!target?.closest('#page-body') && !changed.some(node => node.nodeType === 1 && (node.id === 'page-body' || node.querySelector('#page-body')))) return false
      return changed.some(node => node.nodeType !== 1 || !node.hasAttribute('data-edulog-owned'))
    })
    if (nativeChange) schedule()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  for (const event of ['turbo:before-cache', 'turbo:before-render']) document.addEventListener(event, () => { suspended = true; teardown() })
  for (const event of ['turbo:load', 'turbo:render', 'turbo:frame-load']) document.addEventListener(event, () => { suspended = false; schedule() })
  window.addEventListener('popstate', schedule)
  bridge.onInvalidated(() => showNotice('擴充套件已更新，請先儲存正在編輯的內容，再重新整理分頁。'))
  bridge.listen(data => {
    if (data?.type === 'ui-preferences-changed') { enabled = data.enabled !== false; sync() }
  })
  // UI is independent of pairing and backend availability.
  void message({ type: 'get-ui-preferences' }).then(prefs => { enabled = prefs?.enabled !== false; sync() }).catch(sync)
})()
