// Side panel page for one source tab: frames the paired EduLog web editor and relays its 回填
// request to the background. Only its own frame of the web app origin is listened to, and only the
// channel issued for this panel is forwarded.
const tx = (text, params = {}) => globalThis.edulogUi?.tx(text, params) ?? String(text).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
const tabId = Number(new URLSearchParams(location.search).get('tab'))
const key = `edulogPanel:${tabId}`
const REPORT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const $ = id => document.getElementById(id)
const frame = $('editor')
let current = null, connected = true

function show(tone, text, { allow = false } = {}) {
  $('message').hidden = false; $('message').dataset.tone = tone
  $('message-text').textContent = text
  $('allow').hidden = !allow
  frame.hidden = true
}
function render() {
  $('title').textContent = tx('EduLog 報告編輯')
  $('reload').setAttribute('aria-label', tx('重新載入編輯器')); $('reload').title = tx('重新載入編輯器')
  $('open-tab').setAttribute('aria-label', tx('在新分頁開啟')); $('open-tab').title = tx('在新分頁開啟')
  $('allow').textContent = tx('允許存取 EduLog 網站')
  const state = current
  $('label').textContent = state?.label || ''
  const ready = connected && state?.state === 'ready'
  $('reload').hidden = !ready
  $('open-tab').hidden = !state?.url
  if (state?.url) { const url = new URL(state.url); url.searchParams.delete('source_fill'); $('open-tab').href = url.href }
  if (!connected) return show('error', tx('EduLog 尚未連線。請從擴充功能選單連接 EduLog 後，在原站報告按「在 EduLog 編輯」。'))
  if (!state) return show('idle', tx('在原站的報告中按「在 EduLog 編輯」，這裡就會開啟該學生當天的 EduLog 報告。'))
  if (state.state === 'loading') return show('loading', tx('正在開啟 EduLog 編輯器…'))
  if (state.state === 'error') return show('error', tx(state.message || '無法開啟 EduLog 編輯器。'))
  if (state.state === 'no-access') return show('idle', tx('側邊欄會使用你在 EduLog 網站的登入，需要允許擴充功能存取 {origin}。', { origin: state.origin }), { allow: true })
  $('message').hidden = true
  frame.hidden = false
  frame.title = tx('EduLog 報告編輯器')
  if (frame.dataset.src !== state.url) { frame.dataset.src = state.url; frame.src = state.url }
}

async function load() {
  current = Number.isInteger(tabId) ? (await chrome.storage.session.get(key))[key] || null : null
  render()
}
async function checkConnection() {
  const status = await globalThis.edulogRuntime.send({ type: 'get-edulog-integration-status' }).catch(() => null)
  connected = status?.status === 'connected'
  render()
}

$('allow').addEventListener('click', async () => {
  if (!current?.origin) return
  // The teacher's click grants access to the web app origin only, so the framed app can use its sign-in.
  const granted = await chrome.permissions.request({ origins: [`${current.origin}/*`] }).catch(() => false)
  if (granted) await chrome.storage.session.set({ [key]: { ...current, state: 'ready' } })
})
$('reload').addEventListener('click', () => { if (current?.url) { frame.dataset.src = ''; render() } })

const reply = (data, origin) => frame.contentWindow?.postMessage(data, origin)
window.addEventListener('message', event => {
  if (!current || current.state !== 'ready' || event.source !== frame.contentWindow || event.origin !== current.origin) return
  const data = event.data
  if (data?.type === 'edulog:bridge-ping') return reply({ type: 'edulog:bridge-ready' }, current.origin)
  if (data?.type !== 'edulog:source-fill') return
  const origin = current.origin, channel = current.channel
  if (data.channel !== channel || !REPORT.test(String(data.reportId))) return reply({ type: 'edulog:source-fill-result', channel: String(data.channel || '').slice(0, 32), ok: false, reason: 'INVALID_REQUEST' }, origin)
  globalThis.edulogRuntime.send({ type: 'source-fill-request', tabId, channel, reportId: data.reportId })
    .then(result => reply({ type: 'edulog:source-fill-result', channel, ok: result?.ok === true, reason: result?.ok ? null : String(result?.reason || 'EXTENSION_UNAVAILABLE').slice(0, 60),
      ...(result?.ok ? { applied: result.applied, skipped: result.skipped, review: result.review === true } : {}) }, origin),
      () => reply({ type: 'edulog:source-fill-result', channel, ok: false, reason: 'EXTENSION_UNAVAILABLE' }, origin))
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[key]) { current = changes[key].newValue || null; render() }
  if (area === 'local' && changes.edulogExtension) void checkConnection()
})
globalThis.edulogUi?.subscribe?.(render)
globalThis.edulogUi?.bind?.(document)
void load().then(checkConnection)
