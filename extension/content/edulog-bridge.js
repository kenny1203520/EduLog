// Runs on the paired EduLog web app only. It tells the page the extension is present and passes
// one request type to the extension: 回填 a saved report (channel and report id, nothing else).
(() => {
  if (window.top !== window || globalThis.edulogWebBridge || !globalThis.chrome?.runtime?.id) return
  globalThis.edulogWebBridge = true
  const CHANNEL = /^[a-f0-9]{32}$/, REPORT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const reply = (channel, result) => window.postMessage({ type: 'edulog:source-fill-result', channel, ok: result?.ok === true, reason: result?.ok ? null : String(result?.reason || 'EXTENSION_UNAVAILABLE').slice(0, 60) }, location.origin)
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return
    const data = event.data
    if (data?.type === 'edulog:bridge-ping') { window.postMessage({ type: 'edulog:bridge-ready' }, location.origin); return }
    if (data?.type !== 'edulog:source-fill') return
    if (!CHANNEL.test(String(data.channel)) || !REPORT.test(String(data.reportId))) return reply(String(data.channel || '').slice(0, 32), { ok: false, reason: 'INVALID_REQUEST' })
    let sent
    try { sent = chrome.runtime.sendMessage({ type: 'source-fill-request', channel: data.channel, reportId: data.reportId }) }
    catch { return reply(data.channel, { ok: false, reason: 'EXTENSION_RELOADED' }) }
    sent.then(result => reply(data.channel, result), () => reply(data.channel, { ok: false, reason: 'EXTENSION_UNAVAILABLE' }))
  })
  document.documentElement.dataset.edulogBridge = 'ready'
  window.postMessage({ type: 'edulog:bridge-ready' }, location.origin)
})()
