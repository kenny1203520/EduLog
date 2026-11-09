import assert from 'node:assert/strict'
import test from 'node:test'
import { optionalEnv, requireEnv } from './env.mjs'

test('optionalEnv treats unset and empty values as missing', () => {
  assert.equal(optionalEnv('A', 'fallback', {}), 'fallback')
  assert.equal(optionalEnv('A', 'fallback', { A: '' }), 'fallback')
  assert.equal(optionalEnv('A', 'fallback', { A: 'set' }), 'set')
  assert.equal(optionalEnv('A', undefined, {}), undefined)
})

test('requireEnv names the missing variable', () => {
  assert.equal(requireEnv('TOKEN', { TOKEN: 'x' }), 'x')
  assert.throws(() => requireEnv('TOKEN', {}), /Missing required environment variable TOKEN/)
  assert.throws(() => requireEnv('TOKEN', { TOKEN: '' }), /TOKEN/)
})
