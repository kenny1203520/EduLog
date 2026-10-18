globalThis.edulogUi?.bind(document)
globalThis.edulogUiLegacy?.watch(document.body)
const localeHost=document.getElementById('popup-language');if(localeHost&&globalThis.edulogUi)localeHost.append(globalThis.edulogUi.languageSelect())
const bridge = globalThis.edulogRuntime
const presentation = globalThis.edulogConnectionUi
const ui = id => document.getElementById(id)
const STORAGE_KEY = 'edulogExtension'
let settings = {}, connection = { status: 'checking' }, busy = false, editing = false, generation = 0, expirationTimer
// The active tab decides the one primary action; unknown or unreadable tabs fall back to the workspace.
let context = { kind: 'other', supported: false }, tabTitle = ''
void bridge.call(() => chrome.tabs.query({ active: true, currentWindow: true })).then(([tab] = []) => {
  context = presentation.pageContext(tab?.url); tabTitle = presentation.tabHeading(tab?.title)
}).catch(() => {}).finally(() => render())
let installation
const installationReady = bridge.send({ type: 'get-edulog-installation' }).then(value => {
  if (!value?.installation_id) throw new Error('無法辨識瀏覽器安裝，請重新開啟擴充套件。')
  installation = value
  if (!ui('device-name').value) ui('device-name').value = value.device_name
  return value
})
// The promise is awaited again at pairing; this catch prevents startup rejection.
void installationReady.catch(error => notice(error.message, true))

function normalizeInstance(value) {
  const url = new URL(value.trim())
  if (url.username || url.password || url.search || url.hash) throw new Error('請輸入不含帳密或參數的伺服器網址。')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('正式伺服器必須使用 HTTPS。')
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('請輸入伺服器來源網址；API 端點需由此網址的 /api 提供。')
  return url.origin
}
function browserUrl(value) {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('伺服器回傳的頁面網址無效。')
  return url.href
}
const readSettings = async () => (await bridge.call(() => chrome.storage.local.get(STORAGE_KEY)))[STORAGE_KEY] || {}
const writeSettings = value => bridge.call(() => chrome.storage.local.set({ [STORAGE_KEY]: value }))
function notice(text = '', error = false) { ui('status').textContent = text; ui('status').dataset.error = String(error) }
function diagnostic(value) {
  ui('diagnostics').hidden = !value
  ui('diagnostic-text').textContent = value ? [value.code, value.message, value.requestId ? `請求編號：${value.requestId}` : ''].filter(Boolean).join('\n') : ''
}
function apiError(body, response) {
  const error = body?.error || {}
  const result = new Error(error.code === 'PAIRING_NOT_APPROVED' ? '配對尚未核准，請先在 EduLog 授權頁核准。'
    : error.code === 'EXTENSION_ORIGIN_FORBIDDEN' ? '伺服器尚未允許此擴充套件，請檢查 API_EXTENSION_ALLOWED_ORIGINS。' : '無法完成操作，請查看診斷資訊。')
  result.diagnostic = { code: error.code || `HTTP_${response.status}`, message: error.message || 'API 回應失敗。', requestId: error.request_id }
  return result
}
function showError(error) {
  notice(error.message || '無法完成操作。', true)
  diagnostic(error.diagnostic || { code: error.code || 'OPERATION_FAILED', message: error.message })
  if (error.code === 'CONTEXT_INVALIDATED') connection = { ...connection, status: 'context-invalidated' }
  render()
}
const useIcon = (node, name) => node.setAttribute('href', `#i-${name}`)
const connectForm = state => ['not-connected', 'expired', 'revoked', 'pairing-expired'].includes(state)
function renderContext(state, display) {
  let icon = 'plug', title = display.label, detail = display.detail
  if (editing) { title = '變更伺服器'; detail = '連接新的伺服器後需重新配對。' }
  else if (state === 'connected' && context.kind === 'class') { icon = 'users'; title = tabTitle || '本班'; detail = '同步學生、報告與出席紀錄到 EduLog；不會修改原站。' }
  else if (state === 'connected' && context.kind === 'report') { icon = 'file'; title = tabTitle || '本報告'; detail = '以 EduLog 的課堂紀錄預填欄位，送出前由你檢查。' }
  else if (state === 'connected') { icon = 'dashboard'; title = '這一頁沒有可同步的班級'; detail = '到工作台從「我的班級」挑一班同步。' }
  else if (['unavailable', 'forbidden'].includes(state)) icon = 'alert'
  else if (state === 'pending') icon = 'clock'
  useIcon(ui('context-use'), icon)
  ui('context-title').textContent = title
  ui('state-detail').textContent = detail
}
function render() {
  const state = connection.status
  const display = presentation.describe(state)
  ui('state-label').textContent = display.chip; ui('state-badge').dataset.tone = display.tone
  ui('state-badge').setAttribute('aria-label', `連線狀態：${display.label}`)
  ui('connection-card').dataset.state = state
  ui('connection-card').dataset.context = context.kind
  renderContext(state, display)
  ui('server-row').hidden = !connection.origin
  ui('server-value').textContent = connection.origin || ''
  ui('verified-row').hidden = !connection.lastVerifiedAt
  ui('verified-value').textContent = connection.lastVerifiedAt ? new Date(connection.lastVerifiedAt).toLocaleString() : ''
  ui('open-settings').hidden = state !== 'connected'
  ui('open-settings').disabled = busy || !connection.settingsUrl
  ui('settings-hint').hidden = state !== 'connected' || Boolean(connection.settingsUrl)
  ui('retry').hidden = editing || !['unavailable', 'forbidden'].includes(state)
  ui('retry').disabled = busy
  ui('change').hidden = editing || !settings.origin || !['connected', 'unavailable', 'forbidden', 'pending'].includes(state)
  ui('change').disabled = busy
  ui('device-row').hidden = !connection.deviceName
  ui('device-value').textContent = connection.deviceName || ''
  // Connected: one primary action for this tab, plus the workspace as a quiet link on class pages.
  const action = presentation.primaryAction(context, connection.capabilities)
  ui('feature-list').hidden = editing || state !== 'connected'
  ui('primary-label').textContent = action.label; useIcon(ui('primary-icon'), action.icon)
  ui('primary-action').dataset.flow = action.flow
  ui('primary-action').disabled = busy || !action.ready
  ui('open-workspace').hidden = context.kind !== 'class'
  ui('feature-hint').hidden = action.ready
  ui('feature-hint').textContent = action.ready ? '' : '此操作未就緒：這個連線未提供這項功能，請重新檢查連線或查看診斷。'
  ui('work-row').hidden = state !== 'connected'
  ui('server-form').hidden = !editing && !connectForm(state)
  ui('form-title').hidden = !editing
  ui('pair-label').textContent = busy ? '處理中…' : editing ? '連接新的伺服器' : ['expired', 'revoked', 'pairing-expired'].includes(state) ? '重新連接 EduLog' : '連接 EduLog'
  ui('pair').disabled = busy || state === 'checking'
  ui('instance').disabled = busy
  ui('device-name').disabled = busy
  ui('cancel').hidden = !editing; ui('cancel').disabled = busy
  ui('change-hint').hidden = !editing
  ui('pending-card').hidden = state !== 'pending' || editing
  ui('open-approval').disabled = busy; ui('finish').disabled = busy
  clearTimeout(expirationTimer)
  if (state === 'pending' && settings.pending) {
    const expires = new Date(settings.pending.expiresAt)
    ui('pending-detail').textContent = `配對有效至 ${expires.toLocaleString()}。核准後請按「完成核准配對」。`
    expirationTimer = setTimeout(() => { connection = { ...connection, status: 'pairing-expired' }; render() }, Math.max(0, expires.getTime() - Date.now()))
  }
}
async function verify(force = false) {
  const current = ++generation
  connection = { ...connection, status: 'checking' }; notice(); diagnostic(null); render()
  try {
    const stored = await readSettings()
    const result = await bridge.send({ type: 'get-edulog-integration-status', force })
    if (current !== generation) return
    if (result?.status === 'stale') { connection.status = 'unavailable'; render(); return }
    settings = stored
    if (!editing && (result?.deviceName || stored.connection?.device_name)) ui('device-name').value = result?.deviceName || stored.connection.device_name
    connection = result?.status ? result : { status: 'unavailable', origin: stored.origin }
    if (!editing) ui('instance').value = settings.origin || ''
    diagnostic(connection.diagnostic)
  } catch (error) {
    if (current !== generation) return
    connection = { ...connection, status: error.code === 'CONTEXT_INVALIDATED' ? 'context-invalidated' : 'unavailable' }
    showError(error)
  }
  if (current === generation) render()
  if (connection.status === 'connected') {
    try {
      const summary = await bridge.send({ type: 'get-integration-work-summary' })
      if (current === generation && summary?.count != null) {
        ui('work-count').hidden = !summary.count; ui('work-count').textContent = String(summary.count)
        ui('work-count').setAttribute('aria-label', `${summary.count} 個未完成工作`)
      }
    } catch { /* Connection remains usable when the summary is temporarily unavailable. */ }
  }
}
async function startPairing() {
  if (busy) return
  try {
    const origin = normalizeInstance(ui('instance').value)
    // Preserve Chromium's permission-request user gesture before any await.
    const permission = bridge.call(() => chrome.permissions.request({ origins: [`${origin}/*`] }))
    busy = true; ++generation; notice(); diagnostic(null); render()
    if (!await permission) throw new Error('需要允許擴充套件連接此 EduLog 網址。')
    await installationReady
    const deviceName = ui('device-name').value.trim()
    if (!deviceName || deviceName.length > 80) { ui('device-name').closest('details').open = true; ui('device-name').focus(); throw new Error('請輸入 1–80 字的瀏覽器連線名稱。') }
    const old = await readSettings()
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
    const challenge = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))), byte => byte.toString(16).padStart(2, '0')).join('')
    const response = await fetch(`${origin}/api/extension/pair-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...installation, device_name: deviceName, code_challenge: challenge }), signal: AbortSignal.timeout(15000) })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw apiError(body, response)
    const authorizeUrl = browserUrl(body.data.authorize_url)
    if (typeof body.data.id !== 'string' || !(new Date(body.data.expires_at).getTime() > Date.now())) throw new Error('API 回傳的配對資料無效。')
    const settingsUrl = new URL(authorizeUrl); settingsUrl.searchParams.delete('extension_pair')
    settings = { ...(old.origin === origin ? old : {}), origin, pending: { id: body.data.id, verifier, expiresAt: body.data.expires_at, authorizeUrl, settingsUrl: settingsUrl.href } }
    await writeSettings(settings)
    editing = false; connection = { status: 'pending', origin }
    await bridge.call(() => chrome.tabs.create({ url: authorizeUrl, active: true }))
  } catch (error) { showError(error) }
  finally { busy = false; render() }
}
async function finishPairing() {
  if (busy) return
  busy = true; ++generation; notice(); diagnostic(null); render()
  try {
    const stored = await readSettings(), pending = stored.pending
    if (!pending || !(new Date(pending.expiresAt).getTime() > Date.now())) { connection.status = 'pairing-expired'; throw new Error('配對已逾時，請重新開始。') }
    const response = await fetch(`${stored.origin}/api/extension/pair-requests/${encodeURIComponent(pending.id)}/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code_verifier: pending.verifier }), signal: AbortSignal.timeout(15000) })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw apiError(body, response)
    if (typeof body?.data?.token !== 'string') throw new Error('API 回應格式不正確。')
    await writeSettings({ origin: stored.origin, settingsUrl: pending.settingsUrl, token: body.data.token, tokenId: body.data.token_id, tokenExpiresAt: body.data.expires_at })
    await verify()
  } catch (error) { showError(error) }
  finally { busy = false; render() }
}
// The worker reads the active tab itself, so a class or report tab becomes the workspace source.
async function openWorkspace(flow, button) {
  button.disabled = true
  try { const result = await bridge.send({ type: 'open-integration-workspace', flow }); if (!result?.opened) throw new Error(result?.error?.message || '無法開啟整合工作台。') }
  catch (error) { showError(error) }
  finally { button.disabled = false; render() }
}
function showSettings(open) {
  ui('settings-view').hidden = !open; ui('main-view').hidden = open
  ;(open ? ui('close-settings') : ui('open-settings-panel')).focus()
}
ui('server-form').addEventListener('submit', event => { event.preventDefault(); void startPairing() })
ui('finish').addEventListener('click', () => { void finishPairing() })
ui('retry').addEventListener('click', () => { void verify(true) })
ui('primary-action').addEventListener('click', () => { void openWorkspace(ui('primary-action').dataset.flow, ui('primary-action')) })
ui('open-workspace').addEventListener('click', () => { void openWorkspace('import', ui('open-workspace')) })
ui('open-work').addEventListener('click', () => { void openWorkspace('work', ui('open-work')) })
ui('open-settings-panel').addEventListener('click', () => showSettings(true))
ui('close-settings').addEventListener('click', () => showSettings(false))
ui('change').addEventListener('click', () => { editing = true; ui('instance').value = settings.origin || ''; notice(); showSettings(false); render(); ui('instance').focus() })
ui('cancel').addEventListener('click', () => { editing = false; ui('instance').value = settings.origin || ''; ui('device-name').value = connection.deviceName || installation?.device_name || ''; notice(); render() })
ui('open-approval').addEventListener('click', async () => {
  try {
    const pending = (await readSettings()).pending
    const link = pending?.authorizeUrl || (pending?.settingsUrl ? (() => { const url = new URL(pending.settingsUrl); url.searchParams.set('extension_pair', pending.id); return url.href })() : null)
    if (!link) throw new Error('缺少授權連結，請重新配對。')
    await bridge.call(() => chrome.tabs.create({ url: browserUrl(link), active: true }))
  } catch (error) { showError(error) }
})
ui('open-settings').addEventListener('click', async () => {
  try {
    const result = await bridge.send({ type: 'open-edulog-settings' })
    if (!result?.opened) throw new Error('無法開啟整合設定，請重新檢查連線。')
  } catch (error) { showError(error) }
})
bridge.onInvalidated(() => { ++generation; connection.status = 'context-invalidated'; notice('擴充套件已更新，請重新開啟此視窗。', true); render() })
const uiToggle = ui('ui-enabled')
void bridge.send({ type: 'get-ui-preferences' }).then(prefs => {
  if (prefs?.error) throw new Error('無法讀取 UI 偏好。')
  uiToggle.checked = prefs?.enabled !== false
  ui('ui-status').textContent = uiToggle.checked ? '已套用清晰主題，支援頁面會自動使用此風格。' : '目前使用原站主題。'
}).catch(error => { ui('ui-status').textContent = error.message })
uiToggle.addEventListener('change', async () => {
  uiToggle.disabled = true
  try {
    const result = await bridge.send({ type: 'set-ui-preferences', enabled: uiToggle.checked })
    if (result?.error) throw new Error('設定未儲存，請再試一次。')
    uiToggle.checked = result?.enabled !== false
    ui('ui-status').textContent = uiToggle.checked ? '已套用清晰主題，已同步開啟中的支援頁面。' : '已使用原站主題。'
  } catch (error) { uiToggle.checked = !uiToggle.checked; ui('ui-status').textContent = error.message }
  finally { uiToggle.disabled = false }
})
void verify()
