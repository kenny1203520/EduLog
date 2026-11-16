import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { readyGoTrueFixture } from './auth-gotrue-fixture.mjs'

const base = await readyGoTrueFixture()
const secret = process.env.AUTH_SMOKE_TEST_JWT_SECRET
assert.ok(secret, 'AUTH_SMOKE_TEST_JWT_SECRET must match the disposable fixture')
const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url')
const data = [encode({ alg: 'HS256', typ: 'JWT' }), encode({
  role: 'service_role', exp: Math.floor(Date.now() / 1000) + 300,
})].join('.')
const admin = data + '.' + createHmac('sha256', secret).update(data).digest('base64url')

async function request(path, { method = 'GET', body, token, expected = 200 } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
    redirect: 'manual',
  })
  assert.equal(response.status, expected, path + ' status')
  if (response.status !== 204) return response.json()
}

function authenticatorCode(secret) {
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = Array.from(secret).map(digit => {
    assert.ok(digits.includes(digit))
    return digits.indexOf(digit).toString(2).padStart(5, '0')
  }).join('')
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => Number.parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const hash = createHmac('sha1', key).update(counter).digest()
  return ((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0')
}

const health = await request('/health')
assert.equal(health.version, 'v2.197.0')
const settings = await request('/settings')
assert.equal(settings.external.email, true)
const initial = await request('/admin/custom-providers', { token: admin })
assert.ok(Array.isArray(initial.providers))

const identifier = 'custom:fixture-' + randomUUID().slice(0, 8)
const providerPath = '/admin/custom-providers/' + identifier
const provider = await request('/admin/custom-providers', {
  method: 'POST', token: admin, expected: 201, body: {
    identifier,
    name: 'Fixture OAuth',
    provider_type: 'oauth2',
    client_id: randomUUID(),
    client_secret: randomUUID(),
    authorization_url: 'https://example.com/authorize',
    token_url: 'https://example.com/token',
    userinfo_url: 'https://example.com/userinfo',
    pkce_enabled: true,
    enabled: false,
  },
})
try {
  assert.equal(provider.enabled, false)
  assert.equal((await request(providerPath, { token: admin })).identifier, identifier)
  const activated = await request(providerPath, { method: 'PUT', token: admin, body: { enabled: true } })
  assert.equal(activated.enabled, true)
  const rotated = await request(providerPath, { method: 'PUT', token: admin, body: { client_secret: randomUUID() } })
  assert.equal(rotated.enabled, true)
  assert.equal((await request(providerPath, { method: 'PUT', token: admin, body: { enabled: false } })).enabled, false)
} finally {
  await request(providerPath, { method: 'DELETE', token: admin, expected: 204 })
}

const email = randomUUID() + '@example.test'
const password = randomUUID()
const user = await request('/admin/users', { method: 'POST', token: admin, body: { email, password, email_confirm: true } })
try {
  const session = await request('/token?grant_type=password', { method: 'POST', body: { email, password } })
  const access = session.access_token
  const factor = await request('/factors', {
    method: 'POST', token: access, body: { factor_type: 'totp', friendly_name: 'EduLog smoke test' },
  })
  const endpoint = '/factors/' + factor.id
  const challenge = await request(endpoint + '/challenge', { method: 'POST', token: access, body: {} })
  const verified = await request(endpoint + '/verify', {
    method: 'POST', token: access, body: { challenge_id: challenge.id, code: authenticatorCode(factor.totp.secret) },
  })
  const claims = JSON.parse(Buffer.from(verified.access_token.split('.')[1], 'base64url').toString())
  assert.equal(claims.aal, 'aal2')
  const verifiedUser = await request('/user', { token: verified.access_token })
  assert.ok(verifiedUser.factors.some(item => item.id === factor.id && item.status === 'verified'))
} finally {
  await request('/admin/users/' + user.id, { method: 'DELETE', token: admin })
}

console.log('GoTrue v2.197.0 capability, private discovery, password and TOTP checks passed.')
