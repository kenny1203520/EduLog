import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './release.mjs'
import { browserTargets } from '../../extension/tests/browser/browser-runtime.mjs'

const require = createRequire(import.meta.url), playwright = require.resolve('@playwright/test')
const suites = [
  'browser-check', 'startup-browser-check', 'accounts-browser-check', 'hours-browser-check',
  'report-editor-browser-check', 'editor-date-browser-check', 'unfilled-rating-browser-check',
  'workspace-browser-check', 'history-browser-check', 'mapping-memory-browser-check',
  'review-save-browser-check', 'stale-recovery-browser-check', 'side-panel-browser-check',
]
const failed = []
for (const [name, options] of browserTargets()) {
  const env = { ...process.env, EXTENSION_BROWSERS: options.channel }
  for (const suite of suites) {
    const output = join(repoRoot, 'extension/tests/artifacts/ci', name, suite)
    mkdirSync(output, { recursive: true })
    console.log('Running synthetic suite: ' + name + '/' + suite)
    const result = spawnSync(process.execPath, [join(repoRoot, 'extension/tests/browser', suite + '.mjs'), playwright, output], { cwd: repoRoot, env, stdio: 'inherit' })
    if (result.status !== 0) failed.push(name + '/' + suite)
  }
  const reconciliation = spawnSync(process.execPath, [join(repoRoot, 'extension/tests/browser/mapping-memory-browser-check.mjs'), playwright, '--reconciliation'], { cwd: repoRoot, env, stdio: 'inherit' })
  if (reconciliation.status !== 0) failed.push(name + '/mapping reconciliation')
}
if (failed.length) { console.error('Failed synthetic suites: ' + failed.join(', ')); process.exitCode = 1 }
