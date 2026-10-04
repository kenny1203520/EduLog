import './adapters/orange-apple.js'
import './installation.js'
import { installWorkspaceBroker } from './workspace-broker.js'

chrome.runtime.onInstalled.addListener(() => {
  // Do not expose extension credentials to page content scripts.
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
})

function isTeachingPage(senderUrl) {
  try {
    const url = new URL(senderUrl)
    const adapter = globalThis.edulogSiteAdapter
    return url.protocol === 'https:' && adapter?.matchesHost(url.hostname) && Boolean(adapter.matchesIntegrationPage?.(url.pathname) ?? adapter.matchesTeachingPage(url.pathname))
  } catch { return false }
}

function validSettingsUrl(value) {
  try {
    const url = new URL(value)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return !url.username && !url.password && (url.protocol === 'https:' || (local && url.protocol === 'http:')) ? url.href : null
  } catch { return null }
}

const statusCache = new Map(), statusRequests = new Map()
chrome.storage.onChanged?.addListener((changes, area) => {
  const change = changes.edulogExtension
  if (area === 'local' && change && (change.oldValue?.origin !== change.newValue?.origin || change.oldValue?.token !== change.newValue?.token || change.oldValue?.userId !== change.newValue?.userId)) {
    statusCache.clear(); statusRequests.clear()
  }
})

async function verifyIntegrationStatus() {
  const { edulogExtension } = await chrome.storage.local.get('edulogExtension')
  const metadata = { origin: edulogExtension?.origin || null, settingsUrl: validSettingsUrl(edulogExtension?.settingsUrl), lastVerifiedAt: edulogExtension?.lastVerifiedAt || null }
  if (edulogExtension?.pending) return { ...metadata, status: new Date(edulogExtension.pending.expiresAt).getTime() > Date.now() ? 'pending' : 'pairing-expired' }
  if (!edulogExtension?.origin || !edulogExtension?.token) return { ...metadata, status: 'not-connected' }
  if (!(new Date(edulogExtension.tokenExpiresAt).getTime() > Date.now())) return { ...metadata, status: 'expired' }
  try {
    const response = await fetch(`${edulogExtension.origin}/api/extension/v1/me`, {
      headers: { authorization: `Bearer ${edulogExtension.token}` },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const error = body?.error
      const status = response.status === 401 && error?.code === 'EXTENSION_AUTH_INVALID' ? 'revoked'
        : error?.code === 'EXTENSION_ORIGIN_FORBIDDEN' ? 'forbidden' : 'unavailable'
      return { ...metadata, status, diagnostic: {
        code: typeof error?.code === 'string' ? error.code.slice(0, 100) : `HTTP_${response.status}`,
        message: typeof error?.message === 'string' ? error.message.slice(0, 300) : 'API 回應失敗。',
        requestId: typeof error?.request_id === 'string' ? error.request_id.slice(0, 120) : null,
      } }
    }
    let data = body?.data
    if (!data || typeof data.user_id !== 'string') throw new Error('API 回應格式不正確。')
    if (data.connection && data.connection.installation_id === null) {
      const installation = await globalThis.edulogInstallation.load()
      const current = (await chrome.storage.local.get('edulogExtension')).edulogExtension
      if (current?.origin !== edulogExtension.origin || current?.token !== edulogExtension.token) return { status: 'stale' }
      const adopted = await fetch(`${edulogExtension.origin}/api/extension/v1/installation`, {
        method: 'PATCH', headers: { authorization: `Bearer ${edulogExtension.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(installation), cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
      })
      if (!adopted.ok) throw new Error('無法更新瀏覽器安裝資訊，請重新配對或稍後再試。')
      const refreshed = await fetch(`${edulogExtension.origin}/api/extension/v1/me`, { headers: { authorization: `Bearer ${edulogExtension.token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) })
      if (!refreshed.ok) throw new Error('更新後無法驗證連線。')
      data = (await refreshed.json()).data
      if (!data || typeof data.user_id !== 'string') throw new Error('API 回應格式不正確。')
    }
    const settingsUrl = validSettingsUrl(data.settings_url) || metadata.settingsUrl
    const lastVerifiedAt = new Date().toISOString()
    const current = (await chrome.storage.local.get('edulogExtension')).edulogExtension
    if (current?.origin !== edulogExtension.origin || current?.token !== edulogExtension.token) return { status: 'stale' }
    await chrome.storage.local.set({ edulogExtension: { ...current, settingsUrl, lastVerifiedAt, connection: data.connection, userId: data.user_id } })
    return {
      ...metadata, status: 'connected', settingsUrl, lastVerifiedAt, userId: data.user_id,
      deviceName: data.connection?.device_name || null,
      limits: { batchBytes: Number.isInteger(data.integration_limits?.batch_bytes) ? data.integration_limits.batch_bytes : 180000 },
      capabilities: {
        teaching_data_import: data?.capabilities?.teaching_data_import === true,
        report_prefill: data?.capabilities?.report_prefill === true,
        catalog_v1: data?.capabilities?.catalog_v1 === true,
        multi_course_import: data?.capabilities?.multi_course_import === true,
        mapping_memory: data?.capabilities?.mapping_memory === true,
        student_enrollment_catalog: data?.capabilities?.student_enrollment_catalog === true,
        enrollment_reconciliation: data?.capabilities?.enrollment_reconciliation === true,
        transferred_occurrence_import: data?.capabilities?.transferred_occurrence_import === true,
        nearest_report_candidates: data?.capabilities?.nearest_report_candidates === true,
      },
    }
  } catch (error) { return { ...metadata, status: 'unavailable', diagnostic: { code: 'CONNECTION_UNAVAILABLE', message: error?.message || '無法連接伺服器。' } } }
}

async function getIntegrationStatus({ force = false } = {}) {
  const extension = (await chrome.storage.local.get('edulogExtension')).edulogExtension
  const key = extension?.origin && extension?.token ? `${extension.origin}\n${extension.token}\n${extension.userId || ''}` : ''
  const cached = key && statusCache.get(key)
  if (!force && cached && cached.expiresAt > Date.now()) return cached.status
  if (!force && key && statusRequests.has(key)) return statusRequests.get(key)
  const request = verifyIntegrationStatus().then(status => {
    const verifiedKey = extension?.origin && extension?.token && status.userId ? `${extension.origin}\n${extension.token}\n${status.userId}` : key
    if (verifiedKey && status.status === 'connected') return chrome.storage.local.get('edulogExtension').then(({ edulogExtension: current }) => {
      if (current?.origin === extension.origin && current?.token === extension.token && current?.userId === status.userId) statusCache.set(verifiedKey, { status, expiresAt: Date.now() + 30000 })
      return status
    })
    return status
  }).finally(() => { if (key && statusRequests.get(key) === request) statusRequests.delete(key) })
  if (key) statusRequests.set(key, request)
  return request
}

installWorkspaceBroker(getIntegrationStatus)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fromPopup = sender.id === chrome.runtime.id && sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  if (fromPopup && message?.type === 'get-edulog-installation') {
    void globalThis.edulogInstallation.load().then(sendResponse, () => sendResponse({ error: 'INSTALLATION_UNAVAILABLE' }))
    return true
  }
  if ((fromPopup || isTeachingPage(sender.url)) && ['get-ui-preferences', 'set-ui-preferences'].includes(message?.type)) {
    void (async () => {
      const key = 'edulogUiPreferences'
      const stored = (await chrome.storage.local.get(key))[key] || {}
      if (message.type === 'set-ui-preferences' && typeof message.enabled === 'boolean') {
        stored[globalThis.edulogSiteAdapter.id] = { enabled: message.enabled }
        await chrome.storage.local.set({ [key]: stored })
        const tabs = await chrome.tabs.query({})
        await Promise.allSettled(tabs.filter(tab => isTeachingPage(tab.url)).map(tab => chrome.tabs.sendMessage(tab.id, { type: 'ui-preferences-changed', enabled: message.enabled })))
      }
      return { enabled: stored[globalThis.edulogSiteAdapter.id]?.enabled !== false }
    })().then(sendResponse, () => sendResponse({ error: 'PREFERENCES_UNAVAILABLE' }))
    return true
  }
  if (!fromPopup && !isTeachingPage(sender.url)) return
  if (message?.type === 'get-edulog-integration-status') {
    const force = sender.url === chrome.runtime.getURL('popup.html') && message.force === true
    void getIntegrationStatus({ force }).then(sendResponse, () => sendResponse({ status: 'unavailable' }))
    return true
  }
  if (message?.type === 'open-edulog-settings') {
    void chrome.storage.local.get('edulogExtension').then(async ({ edulogExtension }) => {
      // The authorization URL identifies the frontend; the API origin may differ.
      const url = validSettingsUrl(edulogExtension?.settingsUrl)
      if (!url) return { opened: false }
      await chrome.tabs.create({ url, active: true })
      return { opened: true }
    }).then(sendResponse, () => sendResponse({ opened: false }))
    return true
  }
})
