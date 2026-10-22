// Site scripts by the short names tests use, in manifest load order. 'workflows' is every page
// file under sites/orange-apple/pages/ (shared helpers first, the dispatcher last).
const P = 'sites/orange-apple/'
const PAGES = ['common', 'hours', 'profile', 'class', 'report-table', 'history', 'unfilled', 'renewals', 'sign-in', 'classes', 'overview', 'calendar', 'dialogs', 'index'].map(name => `${P}pages/${name}.js`)
export const SITE = Object.freeze({
  lexicon: `${P}core/lexicon.js`, model: `${P}core/model.js`, navigation: `${P}core/navigation.js`, adapter: `${P}core/adapter.js`,
  todo: `${P}features/todo.js`, 'session-cards': `${P}features/session-cards.js`, 'attendance-export': `${P}features/attendance-export.js`,
  'quick-attendance': `${P}features/quick-attendance.js`, accounts: `${P}features/accounts.js`, roster: `${P}features/roster.js`,
  'report-editor': `${P}features/report-editor.js`, renewals: `${P}features/renewal-status.js`, integration: `${P}integration/integration.js`,
  workflows: PAGES, css: `${P}site.css`,
})
// Extension-relative paths for these names, e.g. siteFiles('lexicon', 'model', 'workflows').
export function siteFiles(...names) {
  return names.flat().flatMap(name => {
    if (!(name in SITE)) throw new Error(`Unknown site script: ${name}`)
    return SITE[name]
  })
}
