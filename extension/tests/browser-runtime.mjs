import { pathToFileURL } from 'node:url'
export { fileURLToPath } from 'node:url'

export async function loadPlaywright(modulePath) {
  const api = await (modulePath ? import(pathToFileURL(modulePath).href) : import('@playwright/test'))
  return api.chromium ? api : api.default
}
export function browserTargets() {
  const channels = (process.env.EXTENSION_BROWSERS || 'chrome,msedge').split(',').map(s => s.trim())
  if (!channels.length || channels.some(c => !['chrome', 'msedge', 'chromium'].includes(c))) throw new Error('EXTENSION_BROWSERS must contain chrome, msedge or chromium')
  return channels.map(channel => [channel === 'msedge' ? 'edge' : channel, { channel, headless: true }])
}
export async function launchBrowser(chromium) {
  const [[, options]] = browserTargets()
  return chromium.launch(options)
}
