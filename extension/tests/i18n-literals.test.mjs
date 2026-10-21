import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'

// UI wording in sites/ and content/ goes through edulogUi.tx() (or keyed t()). What remains as bare
// Chinese literals is source-site vocabulary: lexicon patterns, header/label matching, status keys
// and import evidence stored with records. A literal in tx(a ? '…' : '…') also counts here.
// These counts only go down: wrap new UI text in tx(); raise a count only for real source data.
const BARE_LITERALS = {
  'content/bootstrap.js': 2,
  'content/content.js': 0,
  'content/editor-prefill.js': 20,
  'sites/orange-apple/orange-apple-accounts.js': 7,
  'sites/orange-apple/orange-apple-attendance-export.js': 14,
  'sites/orange-apple/orange-apple-integration.js': 127,
  'sites/orange-apple/orange-apple-lexicon.js': 25,
  'sites/orange-apple/orange-apple-model.js': 7,
  'sites/orange-apple/orange-apple-navigation.js': 2,
  'sites/orange-apple/orange-apple-quick-attendance.js': 5,
  'sites/orange-apple/orange-apple-report-editor.js': 32,
  'sites/orange-apple/orange-apple-roster.js': 8,
  'sites/orange-apple/orange-apple-session-cards.js': 38,
  'sites/orange-apple/orange-apple-todo.js': 5,
  'sites/orange-apple/orange-apple-workflows.js': 86,
  'sites/orange-apple/orange-apple.js': 21,
}
const root = new URL('../', import.meta.url)
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
