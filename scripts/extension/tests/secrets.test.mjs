import test from 'node:test'
import assert from 'node:assert/strict'
import { assertNoSecrets, secretFindings } from '../secrets.mjs'
import { config, validateRuntime } from '../release.mjs'

test('public keys and environment expressions are safe to share', () => {
  assert.doesNotThrow(() => assertNoSecrets(new Map([['manifest.json', Buffer.from(JSON.stringify({ key: config.sideloadPublicKey }))], ['workflow.yml', Buffer.from('token: ${{ secrets.EXTENSION_API_TOKEN }}')]])))
})

test('credential findings expose locations without exposing values', () => {
  const value = 'ghp_' + 'A'.repeat(36)
  const files = new Map([['worker.js', Buffer.from('const prefix = 1\nconst stolen = "' + value + '"')]])
  assert.deepEqual(secretFindings(files), [{ path: 'worker.js', line: 2, rule: 'github-token' }])
  assert.throws(() => assertNoSecrets(files), error => error.message.includes('worker.js:2') && !error.message.includes(value))
})

test('private keys, embedded tokens, service JWTs and credential URLs fail closed', () => {
  const jwt = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ role: 'service_role', iss: 'test' })).toString('base64url'), 's'.repeat(43)].join('.')
  const values = ['-----BEGIN ' + 'PRIVATE KEY-----', 'const token = "' + 'a'.repeat(64) + '"', jwt, 'postgresql://user:' + 'p'.repeat(12) + '@db.test/app']
  for (const value of values) assert.throws(() => assertNoSecrets(new Map([['assets/config.json', Buffer.from(value)]])), /Potential credentials/)
})

test('the actual runtime validation rejects credentials hidden in otherwise allowed JS files', () => {
  assert.throws(() => validateRuntime(new Map([['worker.js', Buffer.from('const secret = "' + 'ya29.' + 'x'.repeat(36) + '"')]])), /google-access-token/)
})
