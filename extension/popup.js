const input = document.querySelector('#instance')
const status = document.querySelector('#status')
const connection = document.querySelector('#connection')
const finishButton = document.querySelector('#finish')
const pairButton = document.querySelector('#pair')
const STORAGE_KEY = 'edulogExtension'

function normalizeInstance(value) {
  const url = new URL(value.trim())
  if (url.username || url.password || url.search || url.hash) throw new Error('請輸入不含帳密或參數的伺服器網址。')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('正式伺服器必須使用 HTTPS。')
  return url.origin
}

async function getSettings() { return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? {} }
async function setStatus(message, error = false) { status.textContent = message; status.style.color = error ? '#b91c1c' : '#334155' }

async function saveInstance() {
  try {
    const origin = normalizeInstance(input.value)
    const old = await getSettings()
    const changed = Boolean(old.origin && old.origin !== origin)
    const next = changed ? { origin } : { ...old, origin }
    await chrome.storage.local.set({ [STORAGE_KEY]: next })
    input.value = origin
    connection.textContent = `目前伺服器：${origin}`
    await setStatus('伺服器網址已儲存。')
    return origin
  } catch (error) { await setStatus(error.message || '伺服器網址無效。', true); throw error }
}

async function allowServer(origin) {
  const pattern = `${origin}/*`
  // Call permissions.request directly from the click handler before its first
  // await; Chromium requires a live user gesture for optional permissions.
  return chrome.permissions.request({ origins: [pattern] })
}

async function startPairing() {
  pairButton.disabled = true
  try {
    const origin = normalizeInstance(input.value)
    const permissionRequest = allowServer(origin)
    await saveInstance()
    if (!await permissionRequest) throw new Error('需要允許擴充套件連接此 EduLog 網址。')
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const challenge = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const response = await fetch(`${origin}/api/extension/pair-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code_challenge: challenge }) })
    const body = await response.json()
    if (!response.ok) throw new Error(body?.error?.message || '無法開始配對，請檢查伺服器設定。')
    const settings = await getSettings()
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...settings, origin, pending: { id: body.data.id, verifier, expiresAt: body.data.expires_at } } })
    await chrome.tabs.create({ url: body.data.authorize_url, active: true })
    finishButton.classList.remove('hidden')
    await setStatus('請在 EduLog 設定頁核准，再回到此視窗完成配對。')
  } catch (error) { await setStatus(error.message || '配對失敗。', true) }
  finally { pairButton.disabled = false }
}

async function finishPairing() {
  finishButton.disabled = true
  try {
    const settings = await getSettings()
    const pending = settings.pending
    if (!pending) throw new Error('沒有等待中的配對請求。')
    if (new Date(pending.expiresAt).getTime() <= Date.now()) throw new Error('配對已逾時，請重新開始。')
    const response = await fetch(`${settings.origin}/api/extension/pair-requests/${encodeURIComponent(pending.id)}/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code_verifier: pending.verifier }) })
    const body = await response.json()
    if (!response.ok) throw new Error(body?.error?.message || 'EduLog 尚未核准此配對。')
    await chrome.storage.local.set({ [STORAGE_KEY]: { origin: settings.origin, token: body.data.token, tokenId: body.data.token_id, tokenExpiresAt: body.data.expires_at } })
    finishButton.classList.add('hidden')
    await setStatus('EduLog 已連線。')
    await render()
  } catch (error) { await setStatus(error.message || '無法完成配對。', true) }
  finally { finishButton.disabled = false }
}

async function render() {
  const settings = await getSettings()
  input.value = settings.origin || ''
  connection.textContent = settings.origin ? `目前伺服器：${settings.origin}` : '尚未設定 EduLog 伺服器。'
  if (settings.pending) finishButton.classList.remove('hidden')
  else finishButton.classList.add('hidden')
  if (!settings.token) return
  if (new Date(settings.tokenExpiresAt).getTime() <= Date.now()) {
    await setStatus('EduLog 連線憑證已過期，請重新連接。', true)
    return
  }
  try {
    const response = await fetch(`${settings.origin}/api/extension/v1/me`, { headers: { authorization: `Bearer ${settings.token}` } })
    if (!response.ok) throw new Error('EduLog 已撤銷或無法驗證此連線，請重新連接。')
    const body = await response.json()
    const capabilities = body?.data?.capabilities
    if (!capabilities?.teaching_data_import || !capabilities?.report_prefill) {
      await setStatus('EduLog 已連線；教學資料匯入與報告預填尚未啟用。')
    } else {
      await setStatus('EduLog 已連線。')
    }
  } catch (error) {
    await setStatus(error.message || '無法驗證 EduLog 連線。', true)
  }
}

document.querySelector('#save').addEventListener('click', () => { void saveInstance().catch(() => undefined) })
pairButton.addEventListener('click', () => { void startPairing() })
finishButton.addEventListener('click', () => { void finishPairing() })
void render()
