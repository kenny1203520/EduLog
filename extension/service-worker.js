import './adapters/orange-apple.js'

chrome.runtime.onInstalled.addListener(() => {
  // Do not expose extension credentials to page content scripts.
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
})

function isTeachingPage(senderUrl) {
  try {
    const url = new URL(senderUrl)
    const adapter = globalThis.edulogSiteAdapter
    return url.protocol === 'https:' && adapter?.matchesHost(url.hostname) && adapter.matchesTeachingPage(url.pathname)
  } catch { return false }
}

async function getIntegrationStatus() {
  const { edulogExtension } = await chrome.storage.local.get('edulogExtension')
  if (!edulogExtension?.origin || !edulogExtension?.token) return { status: 'not-connected' }
  if (new Date(edulogExtension.tokenExpiresAt).getTime() <= Date.now()) return { status: 'expired' }
  try {
    const response = await fetch(`${edulogExtension.origin}/api/extension/v1/me`, {
      headers: { authorization: `Bearer ${edulogExtension.token}` },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    })
    if (response.status === 401) return { status: 'revoked' }
    if (!response.ok) return { status: 'unavailable' }
    const { data } = await response.json()
    return {
      status: 'connected',
      capabilities: {
        teaching_data_import: data?.capabilities?.teaching_data_import === true,
        report_prefill: data?.capabilities?.report_prefill === true,
      },
    }
  } catch { return { status: 'unavailable' } }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTeachingPage(sender.url)) return
  if (message?.type === 'get-edulog-integration-status') {
    void getIntegrationStatus().then(sendResponse, () => sendResponse({ status: 'unavailable' }))
    return true
  }
  if (message?.type === 'open-edulog-settings') {
    void chrome.storage.local.get('edulogExtension').then(({ edulogExtension }) => {
      const origin = edulogExtension?.origin
      if (typeof origin === 'string' && /^https:\/\//.test(origin)) {
        return chrome.tabs.create({ url: `${origin}/dashboard/settings?tab=integrations`, active: true })
      }
    })
  }
})
