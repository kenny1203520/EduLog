import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'

// UI wording in sites/ and content/ goes through edulogUi.tx() (or keyed t()). What remains as bare
// Chinese literals is source-site vocabulary: lexicon patterns, header/label matching, status keys
// and import evidence stored with records. A literal in tx(a ? '…' : '…') also counts here.
// These counts only go down: wrap new UI text in tx(); raise a count only for real source data
// (the lexicon's term table holds the site's zh-TW / zh-CN / English wording).
const BARE_LITERALS = {
  'content/bootstrap.js': 2,
  'content/content.js': 0,
  'content/editor-prefill.js': 20,
  'sites/orange-apple/features/accounts.js': 7,
  'sites/orange-apple/features/attendance-export.js': 14,
  'sites/orange-apple/integration/integration.js': 145,
  'sites/orange-apple/core/lexicon.js': 230,
  'sites/orange-apple/core/model.js': 7,
  'sites/orange-apple/core/navigation.js': 2,
  'sites/orange-apple/features/quick-attendance.js': 5,
  'sites/orange-apple/features/renewal-status.js': 11,
  'sites/orange-apple/features/report-editor.js': 32,
  'sites/orange-apple/features/roster.js': 8,
  'sites/orange-apple/features/session-cards.js': 38,
  'sites/orange-apple/features/todo.js': 5,
  'sites/orange-apple/pages/calendar.js': 5,
  'sites/orange-apple/pages/class.js': 5,
  'sites/orange-apple/pages/classes.js': 8,
  'sites/orange-apple/pages/common.js': 4,
  'sites/orange-apple/pages/dialogs.js': 32,
  'sites/orange-apple/pages/history.js': 14,
  'sites/orange-apple/pages/hours.js': 2,
  'sites/orange-apple/pages/profile.js': 14,
  'sites/orange-apple/pages/renewals.js': 7,
  'sites/orange-apple/pages/report-table.js': 15,
  'sites/orange-apple/pages/sign-in.js': 3,
  'sites/orange-apple/pages/unfilled.js': 5,
  'sites/orange-apple/core/adapter.js': 21,
}
const root = new URL('../../', import.meta.url)
const CJK = /[一-鿿]/
function bareLiterals(source) {
  const code = source.split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join('\n')
  const found = []
  for (const match of code.matchAll(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)) {
    if (!CJK.test(match[0])) continue
    if (code.slice(Math.max(0, match.index - 3), match.index) === 'tx(') continue
    found.push(match[0].slice(0, 60))
  }
  return found
}
const scanned = dir => readdirSync(new URL(dir, root), {recursive: true}).filter(name => String(name).endsWith('.js')).map(name => `${dir}/${String(name).replace(/\\/g, '/')}`)

test('no new hard-coded Chinese UI text in content scripts', () => {
  for (const file of [...scanned('content'), ...scanned('sites')]) {
    const bare = bareLiterals(readFileSync(new URL(file, root), 'utf8'))
    const limit = BARE_LITERALS[file] ?? 0
    assert.ok(bare.length <= limit, `${file}: ${bare.length} bare Chinese literals (limit ${limit}). Wrap UI text in tx(). Newest candidates:\n${bare.slice(-5).join('\n')}`)
  }
})

test('every tx() wording in content scripts has an English phrase', () => {
  const source = readFileSync(new URL('shared/ui-phrases.js', root), 'utf8')
  const book = JSON.parse(source.match(/registerPhrases\((\{[\s\S]*\})\)/)[1])
  const missing = []
  for (const file of [...scanned('content'), ...scanned('sites'), 'shared/connection-ui.js', 'shared/integration-ui.js']) {
    for (const match of readFileSync(new URL(file, root), 'utf8').matchAll(/tx\('((?:[^'\\\n]|\\.)*)'/g)) {
      const key = match[1].replace(/\\n/g, '\n').replace(/\\'/g, "'")
      if (CJK.test(key) && !book[key]) missing.push(`${file}: ${key}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('route titles and menu labels shown by the toolbar and navigation have English phrases', () => {
  const book = JSON.parse(readFileSync(new URL('shared/ui-phrases.js', root), 'utf8').match(/registerPhrases\((\{[\s\S]*\})\)/)[1])
  const lexicon = readFileSync(new URL('sites/orange-apple/core/lexicon.js', root), 'utf8')
  const titles = [...lexicon.matchAll(/title: '([^']+)'/g)].map(match => match[1])
  const labels = [...lexicon.match(/labels: Object\.freeze\(\{([^}]*)\}/)[1].matchAll(/: '([^']+)'/g)].map(match => match[1])
  const groups = [...lexicon.match(/groupLabels: Object\.freeze\(\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(match => match[1])
  assert.deepEqual([...titles, ...labels, ...groups].filter(key => !book[key]), [])
})
