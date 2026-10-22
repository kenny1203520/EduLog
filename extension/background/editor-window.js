// The EduLog web editor beside the source report form: a window tiled next to the source window,
// one fill channel per opened report, and the bridge script that lets the web app ask for 回填.
// The web app sends only a channel and a report id; the report itself is read through the
// extension API and reviewed in the source page before anything is written.
const CHANNELS = 'edulogEditorChannels', CHANNEL_TTL = 4 * 3600e3, MAX_CHANNELS = 20
const BRIDGE_ID = 'edulog-web-bridge'
const SETTINGS_SUFFIX = '/dashboard/settings'

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

function screenArea(value) {
  const numbers = ['left', 'top', 'width', 'height'].map(key => Number(value?.[key]))
  if (!numbers.every(Number.isFinite)) return null
  const [left, top, width, height] = numbers.map(Math.round)
  return width >= 320 && height >= 320 && width <= 20000 && height <= 20000 ? { left, top, width, height } : null
}
// Wide screens: source window on the left half, editor on the right. Narrow screens: the editor
// opens as its own window and the source window is left as it is.
const TILE_MIN_WIDTH = 1200
async function place(sourceTab, url, screen, previousTabId) {
  const area = screenArea(screen)
  const tiled = area && area.width >= TILE_MIN_WIDTH
  const half = tiled ? Math.floor(area.width / 2) : 0
  if (tiled) await chrome.windows.update(sourceTab.windowId, { state: 'normal', left: area.left, top: area.top, width: half, height: area.height }).catch(() => {})
  const editorBox = tiled ? { left: area.left + half, top: area.top, width: area.width - half, height: area.height } : {}
  if (Number.isInteger(previousTabId)) {
    const previous = await chrome.tabs.get(previousTabId).catch(() => null)
    if (previous?.windowId) {
      await chrome.tabs.update(previous.id, { url, active: true })
      await chrome.windows.update(previous.windowId, { focused: true, ...(tiled ? { state: 'normal', ...editorBox } : {}) }).catch(() => {})
      return previous.id
    }
  }
  const created = await chrome.windows.create({ url, type: 'normal', focused: true, ...editorBox })
  return created.tabs?.[0]?.id ?? null
}

// Opens (or reuses) the editor window for this source form and records the fill channel.
export async function openEditor({ sourceTab, base, enrollmentId, date, formId, binding, screen }) {
  const stored = await channels()
  const previous = Object.entries(stored).find(([, entry]) => entry.sourceTabId === sourceTab.id)
  const id = hex(16)
  const url = new URL(`${base}/dashboard/reports/${encodeURIComponent(enrollmentId)}`)
  url.searchParams.set('date', date)
  url.searchParams.set('source_fill', id)
  const editorTabId = await place(sourceTab, url.href, screen, previous?.[1].editorTabId)
  if (previous) delete stored[previous[0]]
  stored[id] = { sourceTabId: sourceTab.id, sourceWindowId: sourceTab.windowId, sourcePath: new URL(sourceTab.url).pathname, formId, enrollmentId, date, editorTabId, instance: binding.instance, userId: binding.userId, at: Date.now() }
  const kept = Object.entries(stored).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CHANNELS)
  await chrome.storage.session.set({ [CHANNELS]: Object.fromEntries(kept) })
  return { channel: id, bridge: await bridgeAllowed(new URL(base).origin) }
}

const bridgeAllowed = origin => chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false)
// Registers the bridge for the paired web app origin, and removes it when the pairing goes away.
export async function syncWebBridge(status) {
  const origin = status?.status === 'connected' ? frontendOrigin(status.settingsUrl) : null
  const wanted = origin && await bridgeAllowed(origin) ? `${origin}/*` : null
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_ID] }).catch(() => [])
  const current = existing[0]?.matches?.[0] || null
  if (current === wanted) return
  if (current) await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] }).catch(() => {})
  if (wanted) await chrome.scripting.registerContentScripts([{ id: BRIDGE_ID, matches: [wanted], js: ['content/edulog-bridge.js'], runAt: 'document_idle', persistAcrossSessions: true }])
}
