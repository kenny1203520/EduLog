import { pathToFileURL } from 'node:url'
export { fileURLToPath } from 'node:url'

export async function loadPlaywright(modulePath) {
  const api = await (modulePath ? import(pathToFileURL(modulePath).href) : import('@playwright/test'))
  return api.chromium ? api : api.default
}
export function browserTargets() {
  const channels = (process.env.EXTENSION_BROWSERS || 'chrome,msedge').split(',').map(s => s.trim())
  if (!channels.length || channels.some(c => !['chrome', 'msedge', 'chromium'].includes(c))) throw new Error('EXTENSION_BROWSERS must contain chrome, msedge or chromium')
  // Pin the UI language: the checks assert zh-TW copy, and CI runners default to en-US.
  const lang = process.env.EXTENSION_TEST_LOCALE || 'zh-TW'
  return channels.map(channel => [channel === 'msedge' ? 'edge' : channel, { channel, headless: true, args: [`--lang=${lang}`] }])
}
export async function launchBrowser(chromium) {
  const [[, options]] = browserTargets()
  return chromium.launch(options)
}
