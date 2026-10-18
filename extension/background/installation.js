// A stable, local installation ID; never use sync storage or device fingerprints.
(() => {
  let loading
  const platform = () => {
    const value = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || ''
    return /win/i.test(value) ? 'Windows' : /mac/i.test(value) ? 'macOS' : /cros/i.test(value) ? 'ChromeOS' : /android/i.test(value) ? 'Android' : /linux/i.test(value) ? 'Linux' : /iphone|ipad|ios/i.test(value) ? 'iOS' : 'Unknown'
  }
  globalThis.edulogInstallation = Object.freeze({
    load() {
      loading ??= (async () => {
        const key = 'edulogInstallation'
        const stored = (await chrome.storage.local.get(key))[key]
        if (stored?.installation_id) return stored
        const agent = globalThis.navigator?.userAgent || ''
        const brands = globalThis.navigator?.userAgentData?.brands || []
        const browser = /Edg\//.test(agent) || brands.some(b => /Microsoft Edge/i.test(b.brand)) ? 'Edge' : /Chrome\//.test(agent) || brands.some(b => b.brand === 'Google Chrome') ? 'Chrome' : 'Chromium'
        const system = platform()
        const value = { installation_id: crypto.randomUUID(), device_name: `${browser} · ${system}`, browser_name: browser, platform_name: system, extension_version: chrome.runtime.getManifest().version }
        await chrome.storage.local.set({ [key]: value })
        return value
      })().catch(error => { loading = null; throw error })
      return loading
    },
  })
})()
