import assert from 'node:assert/strict'
import { createHash, createPrivateKey, randomBytes, randomUUID, sign } from 'node:crypto'

const auth = new URL(process.env.AUTH_SMOKE_TEST_URL || 'http://127.0.0.1:9999')
const privateJwk = JSON.parse(process.env.AUTH_SMOKE_TEST_ADMIN_JWK || 'null')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(auth.hostname), 'Use an isolated loopback GoTrue fixture')
assert.ok(privateJwk?.d && privateJwk.alg === 'ES256', 'An isolated fixture administrator JWK is required')

function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url') }
const unsigned = [encode({ alg: privateJwk.alg, kid: privateJwk.kid, typ: 'JWT' }), encode({
  role: 'service_role', exp: Math.floor(Date.now() / 1000) + 300,
})].join('.')
const admin = unsigned + '.' + sign('sha256', Buffer.from(unsigned), { key: createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url')

async function request(path, { method = 'GET', body, form, token, expected = 200, headers = {} } = {}) {
  const response = await fetch(new URL(path, auth), {
    method,
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: form ? new URLSearchParams(form) : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
    redirect: 'manual',
  })
  assert.equal(response.status, expected, path.split('?')[0] + ' status')
  if (response.status === 302) return new URL(response.headers.get('location'))
  if (response.status !== 204 && response.ok) return response.json()
}

const settings = await request('/.well-known/openid-configuration')
assert.ok(settings.authorization_endpoint.endsWith('/oauth/authorize'))
assert.ok((await request('/.well-known/jwks.json')).keys.some(key => ['ES256', 'RS256'].includes(key.alg)))

const email = randomUUID() + '@example.test'
const password = randomUUID()
const user = await request('/admin/users', { method: 'POST', token: admin, body: { email, password, email_confirm: true, role: 'authenticated' } })
let client
try {
  const callback = 'https://client.fixture.test/callback'
  client = await request('/admin/oauth/clients', {
    method: 'POST', token: admin, expected: 201,
    body: { client_name: 'EduLog OIDC test', redirect_uris: [callback], token_endpoint_auth_method: 'client_secret_basic' },
  })
  assert.ok(client.client_secret)
  assert.ok((await request('/admin/oauth/clients', { token: admin })).clients.some(item => item.client_id === client.client_id))
  const firstParty = await request('/token?grant_type=password', { method: 'POST', body: { email, password } })
  const verifier = randomBytes(48).toString('base64url')
  const state = randomUUID()
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const params = new URLSearchParams({
    client_id: client.client_id, redirect_uri: callback, response_type: 'code',
    scope: 'openid email', state, code_challenge: challenge, code_challenge_method: 'S256',
  })
  const begin = () => request('/oauth/authorize?' + params, { expected: 302 })
  const consent = await begin()
  assert.equal(consent.pathname, '/oauth/consent')
  const id = consent.searchParams.get('authorization_id')
  assert.match(id, /^[A-Za-z0-9_-]{10,128}$/)
  const token = firstParty.access_token
  const details = await request('/oauth/authorizations/' + id, { token })
  assert.equal(details.client.id, client.client_id)
  assert.equal(details.user.id, user.id)
  const approve = await request('/oauth/authorizations/' + id + '/consent', {
    method: 'POST', token, body: { action: 'approve' },
  })
  const redirect = new URL(approve.redirect_url)
  assert.equal(redirect.origin, 'https://client.fixture.test')
  assert.equal(redirect.searchParams.get('state'), state)
  const exchange = {
    method: 'POST',
    form: { grant_type: 'authorization_code', code: redirect.searchParams.get('code'), redirect_uri: callback, code_verifier: verifier },
    headers: { Authorization: 'Basic ' + Buffer.from(client.client_id + ':' + client.client_secret).toString('base64') },
  }
  const external = await request('/oauth/token', exchange)
  const jwt = value => JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString())
  assert.equal(jwt(external.id_token).sub, user.id)
  assert.equal(jwt(external.access_token).client_id, client.client_id)
  assert.equal((await request('/oauth/userinfo', { token: external.access_token })).sub, user.id)
  if (process.env.AUTH_SMOKE_TEST_POSTGREST_URL) {
    const postgrest = new URL(process.env.AUTH_SMOKE_TEST_POSTGREST_URL)
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(postgrest.hostname))
    const resource = new URL('/rpc/edulog_reject_external_oauth', postgrest)
    const call = accessToken => fetch(resource, {
      method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(10_000),
    })
    const firstPartyResponse = await call(token)
    assert.ok(firstPartyResponse.ok, 'First-party token may invoke PostgREST (' + firstPartyResponse.status + '): ' + (firstPartyResponse.ok ? '' : await firstPartyResponse.text()))
    const deniedResponse = await call(external.access_token)
    assert.equal(deniedResponse.status, 403)
    assert.equal((await deniedResponse.json()).code, '42501')
  }
  await request('/oauth/token', { ...exchange, expected: 400 })

  assert.ok((await request('/user/oauth/grants', { token })).some(grant => grant.client.id === client.client_id))
  await request('/user/oauth/grants?client_id=' + client.client_id, { token, method: 'DELETE', expected: 204 })
  assert.deepEqual(await request('/user/oauth/grants', { token }), [])

  const cancel = (await begin()).searchParams.get('authorization_id')
  await request('/oauth/authorizations/' + cancel, { token })
  const denied = await request('/oauth/authorizations/' + cancel + '/consent', { method: 'POST', token, body: { action: 'deny' } })
  assert.equal(new URL(denied.redirect_url).searchParams.get('error'), 'access_denied')
} finally {
  if (client) await request('/admin/oauth/clients/' + client.client_id, { token: admin, method: 'DELETE', expected: 204 })
  await request('/admin/users/' + user.id, { token: admin, method: 'DELETE' })
}

console.log('GoTrue outbound OIDC registration, consent, UserInfo, replay rejection and revocation passed.')
