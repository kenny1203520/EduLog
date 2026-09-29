// Site-specific route matching lives in this adapter. Keep provider names,
// page selectors, and source terminology out of the shared extension UI.
globalThis.edulogSiteAdapter = Object.freeze({
  id: 'orange-apple',
  matchesHost(hostname) {
    return hostname === 'corp.orangeapple.co'
  },
  matchesTeachingPage(pathname) {
    return /(?:^|\/)(?:students?|courses?|classrooms?|classes?|sessions?|reports?|lessons?)(?:\/|$)/i.test(pathname)
  },
})
