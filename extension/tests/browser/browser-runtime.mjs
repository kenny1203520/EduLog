import { resolveNativeAssetFile, resolveNativeAssetsDirectory, resolveScreenshotDirectory } from '../../../scripts/extension/paths.mjs'
export { fileURLToPath } from 'node:url'

// The checks assert zh-TW copy and the UI follows navigator.language. CI runners default to en-US
// and Linux Chrome ignores --lang, so every page and context gets an explicit Playwright locale.
const locale = process.env.EXTENSION_TEST_LOCALE || 'zh-TW'
function withLocale(browser) {
  for (const method of ['newPage', 'newContext']) {
    const original = browser[method].bind(browser)
    browser[method] = (options = {}) => original({ locale, ...options })
  }
  return browser
}
export async function loadPlaywright() {
  const imported = await import('@playwright/test')
  const api = imported.chromium ? imported : imported.default
  const launch = api.chromium.launch.bind(api.chromium)
  return { ...api, chromium: Object.assign(Object.create(api.chromium), { launch: async options => withLocale(await launch(options)) }) }
}
export { resolveNativeAssetFile, resolveNativeAssetsDirectory, resolveScreenshotDirectory }
export function browserTargets() {
  const channels = (process.env.EXTENSION_BROWSERS || 'chrome,msedge').split(',').map(s => s.trim())
  if (!channels.length || channels.some(c => !['chrome', 'msedge', 'chromium'].includes(c))) throw new Error('EXTENSION_BROWSERS must contain chrome, msedge or chromium')
  return channels.map(channel => [channel === 'msedge' ? 'edge' : channel, { channel, headless: true }])
}
export async function launchBrowser(chromium) {
  const [[, options]] = browserTargets()
  return chromium.launch(options)
}

// Remove every <script>...</script> element from trusted test HTML. Scans without a
// regular expression and repeats until no opening tag is left, so nested or split
// tags such as <scr<script>ipt> cannot survive.
export function stripScriptElements(html) {
  let result = String(html)
  for (;;) {
    const lower = result.toLowerCase()
    const start = lower.indexOf('<script')
    if (start < 0) return result
    const close = lower.indexOf('</script', start)
    const end = close < 0 ? -1 : lower.indexOf('>', close)
    result = result.slice(0, start) + (end < 0 ? '' : result.slice(end + 1))
  }
}
