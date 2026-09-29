chrome.runtime.onInstalled.addListener(() => {
  // Do not expose extension credentials to page content scripts.
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
})

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'open-edulog-settings' || !sender.url?.startsWith('https://corp.orangeapple.co/')) return
  void chrome.storage.local.get('edulogExtension').then(({ edulogExtension }) => {
    const origin = edulogExtension?.origin
    if (typeof origin === 'string' && /^https:\/\//.test(origin)) {
      return chrome.tabs.create({ url: `${origin}/dashboard/settings?tab=integrations`, active: true })
    }
  })
})
