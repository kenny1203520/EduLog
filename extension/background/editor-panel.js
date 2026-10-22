// The EduLog web editor in the browser side panel, beside the source report form: one panel per
// source tab, one fill channel per opened report. The panel page frames the paired web app, which
// keeps its own sign-in there; 回填 sends only a channel and a report id back through the panel.
// The report itself is read through the extension API and reviewed in the source page before
// anything is written.
const CHANNELS = 'edulogEditorChannels', CHANNEL_TTL = 4 * 3600e3, MAX_CHANNELS = 20
const SETTINGS_SUFFIX = '/dashboard/settings'
export const PANEL_PAGE = 'sidepanel/panel.html'
export const panelKey = tabId => `edulogPanel:${tabId}`

// The web app base (origin plus any path prefix) from the settings URL the server reports.
export function frontendBase(settingsUrl) {
  try {
    const url = new URL(settingsUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.pathname.endsWith(SETTINGS_SUFFIX)) return null
    return url.origin + url.pathname.slice(0, -SETTINGS_SUFFIX.length)
  } catch { return null }
}
export const frontendOrigin = settingsUrl => { const base = frontendBase(settingsUrl); return base ? new URL(base).origin : null }

const hex = bytes => [...crypto.getRandomValues(new Uint8Array(bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
async function channels() {
  const stored = (await chrome.storage.session.get(CHANNELS))[CHANNELS] || {}
  const now = Date.now()
  return Object.fromEntries(Object.entries(stored).filter(([, entry]) => now - entry.at < CHANNEL_TTL))
}
export async function readChannel(id) {
  if (!/^[a-f0-9]{32}$/.test(String(id))) return null
  return (await channels())[id] || null
}

// Chrome opens a side panel only during the click that asked for it, so this runs synchronously
// from that message, before any lookup. The panel shows a loading state until preparePanel or
// panelFailed hands it the editor address or the reason it cannot open.
export function openPanel(tabId) {
  void chrome.storage.session.set({ [panelKey(tabId)]: { state: 'loading', at: Date.now() } })
  void chrome.sidePanel.setOptions({ tabId, path: `${PANEL_PAGE}?tab=${tabId}`, enabled: true }).catch(() => {})
  return chrome.sidePanel.open({ tabId })
}
export const panelFailed = (tabId, message) => chrome.storage.session.set({ [panelKey(tabId)]: { state: 'error', message: String(message || '').slice(0, 300), at: Date.now() } })

// Records the fill channel for this source form (replacing the tab's previous one) and gives the
// panel the editor address. Without access to the web app origin the framed app cannot use its
// sign-in, so the panel asks for that permission first.
export async function preparePanel({ sourceTab, base, enrollmentId, date, formId, binding, label }) {
  const stored = await channels()
  const previous = Object.entries(stored).find(([, entry]) => entry.sourceTabId === sourceTab.id)
  const id = hex(16)
  const url = new URL(`${base}/dashboard/reports/${encodeURIComponent(enrollmentId)}`)
  url.searchParams.set('date', date)
  url.searchParams.set('source_fill', id)
  if (previous) delete stored[previous[0]]
  stored[id] = { sourceTabId: sourceTab.id, sourcePath: new URL(sourceTab.url).pathname, formId, enrollmentId, date, instance: binding.instance, userId: binding.userId, at: Date.now() }
  const kept = Object.entries(stored).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CHANNELS)
  const origin = url.origin, access = await chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false)
  await chrome.storage.session.set({
    [CHANNELS]: Object.fromEntries(kept),
    [panelKey(sourceTab.id)]: { state: access ? 'ready' : 'no-access', url: url.href, origin, channel: id, label: String(label || '').slice(0, 160), at: Date.now() },
  })
  return { channel: id, access }
}

// A closed tab takes its panel state and fill channel with it.
export async function forgetTab(tabId) {
  const stored = await channels()
  for (const [id, entry] of Object.entries(stored)) if (entry.sourceTabId === tabId) delete stored[id]
  await chrome.storage.session.set({ [CHANNELS]: stored })
  await chrome.storage.session.remove(panelKey(tabId))
}
