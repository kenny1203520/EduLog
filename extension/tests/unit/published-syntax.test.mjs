import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const runtimeDirectories = ['background', 'content', 'popup', 'shared', 'sites/orange-apple', 'styles', 'workspace'].map(directory => join(extensionRoot, directory))
const scripts = runtimeDirectories.flatMap(directory => readdirSync(directory, { withFileTypes: true, recursive: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
  .map(entry => join(entry.parentPath, entry.name)))

test('all published extension JavaScript parses as complete modules', () => {
  assert.ok(scripts.length > 0, 'expected runtime scripts in the extension package')
  const failures = scripts.flatMap(script => {
    const result = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' })
    return result.status === 0 ? [] : [`${script}\n${result.stderr || result.stdout}`]
  })
  assert.deepEqual(failures, [], failures.join('\n\n'))
})
