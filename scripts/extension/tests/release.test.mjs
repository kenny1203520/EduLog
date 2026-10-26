import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipFiles, unzipFiles, safePath } from '../archive.mjs'
import { buildRelease, config, extensionId, parseTag, parseVersion, readExtensionFileAtCommit, resolveCommit, sha256, validateGitRef, validateRuntime, verifyRelease } from '../release.mjs'
import { publishExtensionRelease } from '../github-release.mjs'
import { checkCompatibility } from '../preflight.mjs'
import { githubApiUrl, publishRelease, releaseState, renderReceipt, readReceipt, createStoreClient, compareVersions } from '../store.mjs'
import { repoRoot, resolveNativeAssetFile, resolveProjectPath, resolveReleaseArchive, resolveScreenshotDirectory, resolveWithin } from '../paths.mjs'

const key = config.sideloadPublicKey, item = extensionId(key)
function fixture() {
  const manifest = { manifest_version: 3, name: 'EduLog BETA', version: '0.1.1.1', version_name: '0.1.1-beta.1', key, action: { default_popup: 'popup/popup.html' }, background: { service_worker: 'background/worker.js', type: 'module' } }
  const files = new Map([['manifest.json', Buffer.from(JSON.stringify(manifest))], ['popup/popup.html', Buffer.from('<script src="popup.js"></script>')], ['popup/popup.js', Buffer.from('const value = 1')], ['background/worker.js', Buffer.from('export const ready = true')]])
  const archive = zipFiles(files)
  return { archive, files, metadata: { channel: 'beta', distribution: 'store', version: manifest.version, versionName: manifest.version_name, extensionId: item, sha256: sha256(archive), files: Object.fromEntries([...files].map(([name, data]) => [name, sha256(data)])) } }
}
const revision = (version, state) => ({ state, distributionChannels: [{ crxVersion: version }] })

test('tags and versions reject malformed, overflowing and channel-confused input', () => {
  assert.equal(parseTag('extension/beta/v0.1.1.1').versionName, '0.1.1-beta.1')
  assert.equal(parseTag('extension/stable/v1.2.3').channel, 'stable')
  for (const tag of ['v1.2.3', 'extension/beta/v1.2.3', 'extension/stable/v1.2.3.1', 'extension/beta/v1.2.3.0', 'extension/beta/v01.2.3.1', 'extension/beta/v1.2.65536.1']) assert.throws(() => parseTag(tag))
  assert.throws(() => parseVersion('1.2.3', 'unknown'))
  assert.equal(compareVersions('0.1.1.10', '0.1.1.2'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0.0'), 0)
})
test('CLI refs and file paths reject argument and directory traversal', () => {
  assert.equal(validateGitRef('HEAD'), 'HEAD')
  assert.equal(validateGitRef('extension/beta/v0.1.1.1'), 'extension/beta/v0.1.1.1')
  for (const ref of ['--upload-pack=payload', '../outside', 'extension//beta', 'branch@{1}']) assert.throws(() => validateGitRef(ref))

  const temporary = mkdtempSync(join(tmpdir(), 'edulog-safe-paths-'))
  try {
    assert.equal(resolveReleaseArchive(temporary, 'EduLog-Teaching-Tools-beta-0.1.1.1.zip'), join(temporary, 'EduLog-Teaching-Tools-beta-0.1.1.1.zip'))
    assert.throws(() => resolveReleaseArchive(temporary, '../../.env'), /Invalid release archive/)
    assert.throws(() => resolveWithin(temporary, '../outside', 'Test path'), /allowed directory/)
    assert.throws(() => resolveProjectPath(join(temporary, 'release.json'), 'Metadata path'), /allowed directory/)
    assert.equal(resolveScreenshotDirectory(join(temporary, 'screenshots'), 'test'), join(temporary, 'screenshots'))
    assert.throws(() => resolveScreenshotDirectory(repoRoot, 'test'), /Screenshot directory/)
    assert.throws(() => resolveNativeAssetFile(temporary, '../../.env'), /Invalid native CSS asset/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
test('GitHub release API requests stay on the authenticated API origin', () => {
  const url = githubApiUrl('kenny1203520/EduLog', { kind: 'tag', tag: 'extension/beta/v0.1.1.1' })
  assert.equal(url.origin, 'https://api.github.com')
  assert.equal(url.pathname, '/repos/kenny1203520/EduLog/releases/tags/extension%2Fbeta%2Fv0.1.1.1')
  assert.throws(() => githubApiUrl('owner/../../attacker', { kind: 'releases', page: 1 }))
  assert.throws(() => githubApiUrl('kenny1203520/EduLog', { kind: 'tag', tag: 'https://attacker.invalid' }))
  assert.throws(() => githubApiUrl('kenny1203520/EduLog', { kind: 'release', id: '../secret' }))
})
test('sideload ID is stable; public key is validated', () => {
  assert.equal(item, 'caefagceiajdhjnmogiaicaijckmplge')
  assert.throws(() => extensionId('not a public key'))
})
test('deterministic ZIP rejects traversal, corruption and truncation', () => {
  const { files, archive } = fixture()
  assert.deepEqual(zipFiles(new Map([...files].reverse())), archive)
  assert.deepEqual(unzipFiles(archive), files)
  for (const path of ['../private', '/absolute', 'C:/private', 'a\\b', 'a/../b', 'a//b', 'a\0b']) assert.throws(() => safePath(path))
  const changed = Buffer.from(archive); changed[40] ^= 0xff
  assert.throws(() => unzipFiles(changed))
  assert.throws(() => unzipFiles(archive.subarray(0, archive.length - 1)))
})
test('runtime validation rejects missing dependencies, syntax errors and unexpected files', () => {
  const { files } = fixture()
  validateRuntime(files)
  const missing = new Map(files); missing.delete('popup/popup.js')
  assert.throws(() => validateRuntime(missing), /missing file/)
  const broken = new Map(files); broken.set('background/worker.js', Buffer.from('const incomplete ='))
  assert.throws(() => validateRuntime(broken), /syntax failure/)
  const external = new Map(files); external.set('background/worker.js', Buffer.from("import 'external-package'"))
  assert.throws(() => validateRuntime(external), /bundled/)
  const secret = new Map(files); secret.set('.env', Buffer.from('secret'))
  assert.throws(() => validateRuntime(secret), /Unexpected/)
})
test('verification binds ZIP bytes, manifest ID/version and the complete file inventory', () => {
  const { archive, metadata } = fixture()
  verifyRelease(archive, metadata)
  assert.throws(() => verifyRelease(Buffer.concat([archive, Buffer.from('x')]), metadata), /SHA-256/)
  assert.throws(() => verifyRelease(archive, { ...metadata, extensionId: 'a'.repeat(32) }), /metadata mismatch/)
  assert.throws(() => verifyRelease(archive, { ...metadata, files: {} }), /file list/)
})
test('packaging is reproducible from pinned committed Git objects and excludes non-runtime files', () => {
  const commit = resolveCommit('HEAD')
  const args = { ref: commit, version: '0.1.1.1' }
  const first = buildRelease(args), second = buildRelease(args)
  assert.deepEqual(first.archive, second.archive)
  assert.equal(second.metadata.commit, commit)
  assert.equal(second.metadata.distribution, 'zip')
  assert.deepEqual(second.files.get('background/service-worker.js'), readExtensionFileAtCommit(commit, 'extension/background/service-worker.js'))
  assert.throws(() => readExtensionFileAtCommit(commit, '../../.git/config'), /Unsafe archive path/)
  for (const name of second.files.keys()) assert.doesNotMatch(name, /(^|\/)(tests|dist|node_modules)|README|package\.json|\.pem$|\.env/)
  assert.throws(() => buildRelease({ ...args, channel: 'stable', version: '0.1.1' }), /configured store/)
  assert.throws(() => buildRelease({ ...args, distribution: 'store' }), /CWS_PUBLIC_KEY/)
})

test('GitHub publisher creates a draft, uploads verified release files, then publishes it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'edulog-publish-test-'))
  try {
    const { archive, metadata } = buildRelease({ version: '0.1.1.1' })
    writeFileSync(resolveReleaseArchive(directory, metadata.archive), archive)
    writeFileSync(join(directory, `${metadata.archive}.sha256`), `${metadata.sha256}  ${metadata.archive}\n`)
    writeFileSync(join(directory, 'release.json'), JSON.stringify(metadata, null, 2) + '\n')
    writeFileSync(join(directory, 'TESTING.md'), readFileSync(new URL('../../../docs/deployment/extension-testing.md', import.meta.url)))

    const events = []
    const uploadUrl = 'https://uploads.github.com/repos/kenny1203520/EduLog/releases/42/assets{?name,label}'
    const fetchImpl = async (input, options = {}) => {
      const url = new URL(input)
      const method = options.method || 'GET'
      if (url.origin === 'https://api.github.com' && url.pathname.includes('/commits/')) {
        events.push('commit')
        return Response.json({ sha: metadata.commit })
      }
      if (url.origin === 'https://api.github.com' && url.pathname.endsWith('/releases') && method === 'GET') {
        events.push('list')
        return Response.json([])
      }
      if (url.origin === 'https://api.github.com' && url.pathname.endsWith('/releases') && method === 'POST') {
        const body = JSON.parse(options.body)
        assert.equal(body.draft, true)
        assert.equal(body.make_latest, 'false')
        events.push('create')
        return Response.json({ id: 42, tag_name: body.tag_name, upload_url: uploadUrl, draft: true, assets: [] }, { status: 201 })
      }
      if (url.origin === 'https://uploads.github.com' && method === 'POST') {
        assert.equal(options.headers['Content-Type'], url.searchParams.get('name').endsWith('.zip') ? 'application/zip' : 'application/octet-stream')
        events.push(`upload:${url.searchParams.get('name')}`)
        return Response.json({ name: url.searchParams.get('name') }, { status: 201 })
      }
      if (url.origin === 'https://api.github.com' && url.pathname.endsWith('/releases/42') && method === 'PATCH') {
        const body = JSON.parse(options.body)
        assert.equal(body.draft, false)
        events.push('publish')
        return Response.json({ id: 42, ...body })
      }
      throw new Error(`Unexpected mocked GitHub request: ${method} ${url}`)
    }

    await publishExtensionRelease({
      repository: 'kenny1203520/EduLog',
      releaseTag: 'extension/beta/v0.1.1.1',
      metadataPath: join(directory, 'release.json'),
      token: 'test-token',
      fetchImpl,
    })
    assert.deepEqual(events, [
      'commit', 'list', 'create',
      `upload:${metadata.archive}`,
      `upload:${metadata.archive}.sha256`,
      'upload:release.json',
      'upload:TESTING.md',
      'publish',
    ])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('readiness uses exact origin and fails closed for missing settings, permissions or capabilities', async () => {
  const metadata = { extensionId: item, requiredCapabilities: ['report_prefill'], minimumMigration: '1000141' }
  let call
  const options = { url: 'https://edulog.example', token: 'synthetic-token', fetchImpl: async (url, init) => {
    call = { url, init }
    return { ok: true, json: async () => ({ data: { user_id: 'test', connection: { installation_id: 'test-install' }, capabilities: { report_prefill: true }, integration_limits: { batch_records: 50, batch_bytes: 180000 } } }) }
  } }
  assert.equal((await checkCompatibility(metadata, options)).compatible, true)
  assert.equal(call.init.headers.origin, 'chrome-extension://' + item)
  assert.equal(call.init.redirect, 'error')
  assert.equal(call.url, 'https://edulog.example/api/extension/v1/me')
  await assert.rejects(checkCompatibility(metadata, { ...options, token: '' }), /required/)
  await assert.rejects(checkCompatibility(metadata, { ...options, url: 'http://edulog.example' }), /HTTPS/)
  await assert.rejects(checkCompatibility({ ...metadata, requiredCapabilities: ['missing'] }, options), /lacks/)
  await assert.rejects(checkCompatibility(metadata, { ...options, fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/)
})
test('store state tracks the requested version rather than an older published revision', () => {
  const status = { publishedItemRevisionStatus: revision('0.1.0', 'PUBLISHED_TO_TESTERS'), submittedItemRevisionStatus: revision('0.1.1.1', 'PENDING_REVIEW') }
  assert.equal(releaseState(status, '0.1.1.1'), 'pending')
  assert.equal(releaseState(status, '0.1.0'), 'published')
  assert.equal(releaseState({ submittedItemRevisionStatus: revision('0.1.1.1', 'REJECTED') }, '0.1.1.1'), 'rejected')
  assert.throws(() => releaseState({ takenDown: true }, '0.1.1.1'), /policy/)
  assert.equal(releaseState({ publishedItemRevisionStatus: revision('0.2.0', 'PUBLISHED') }, '0.1.1.1', { detectSuperseded: true }), 'superseded')
})
test('store API uses V2 media upload and default publish without leaking response bodies', async () => {
  const calls = [], client = createStoreClient({ publisher: 'test-publisher', item, token: 'test-only', fetchImpl: async (url, init) => {
    calls.push({ url, init }); return { ok: true, json: async () => ({}) }
  } })
  await client.status(); await client.upload(Buffer.from('zip')); await client.publish()
  assert.match(calls[1].url, /\/upload\/v2\/publishers\/test-publisher\/items\/[a-p]+:upload$/)
  assert.equal(calls[1].init.headers['content-type'], 'application/zip')
  assert.deepEqual(JSON.parse(calls[2].init.body), { publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true })
  const denied = createStoreClient({ publisher: 'test', item, token: 'test', fetchImpl: async () => ({ ok: false, status: 401 }) })
  await assert.rejects(denied.status(), /HTTP 401/)
})
test('publish persists intent before upload and submission; rerun does not duplicate either', async () => {
  const { metadata, archive } = fixture(), events = []
  let remote = { publicKey: key }
  const client = {
    status: async () => remote,
    upload: async () => { events.push('upload'); return { uploadState: 'SUCCEEDED', crxVersion: metadata.version } },
    publish: async () => { events.push('publish'); remote = { publicKey: key, submittedItemRevisionStatus: revision(metadata.version, 'PENDING_REVIEW') }; return { state: 'PENDING_REVIEW' } },
  }
  const receipt = await publishRelease({ client, metadata, archive, item, save: async r => events.push(r.state) })
  assert.deepEqual(events, ['uploading', 'upload', 'uploaded', 'submitting', 'publish', 'pending'])
  events.length = 0
  await publishRelease({ client, metadata, archive, item, previous: receipt, save: async r => events.push(r.state) })
  assert.deepEqual(events, ['pending'])
})
test('lost upload response and failed intent persistence never cause a blind retry', async () => {
  const { metadata, archive } = fixture()
  let receipt, uploads = 0
  const client = { status: async () => ({ publicKey: key }), upload: async () => { uploads++; throw new Error('lost response') } }
  const args = { client, metadata, archive, item, save: async r => { receipt = r } }
  await assert.rejects(publishRelease(args), /lost response/)
  await assert.rejects(publishRelease({ ...args, previous: receipt }), /Ambiguous/)
  assert.equal(uploads, 1)
  await assert.rejects(publishRelease({ ...args, save: async () => { throw new Error('journal unavailable') } }), /journal unavailable/)
  assert.equal(uploads, 1)
})
test('version rollback, another review and changed bytes are blocked before mutation', async () => {
  const { metadata, archive } = fixture()
  const args = { metadata, archive, item, save: async () => {} }
  await assert.rejects(publishRelease({ ...args, client: { status: async () => ({ publicKey: key, publishedItemRevisionStatus: revision('0.2.0', 'PUBLISHED') }) } }), /must exceed/)
  await assert.rejects(publishRelease({ ...args, client: { status: async () => ({ publicKey: key, submittedItemRevisionStatus: revision('0.1.2.1', 'PENDING_REVIEW') }) } }), /Another version/)
  await assert.rejects(publishRelease({ ...args, previous: { sha256: 'wrong', version: metadata.version, item } }), /different package/)
  await assert.rejects(publishRelease({ ...args, client: { status: async () => ({ publicKey: key, submittedItemRevisionStatus: revision(metadata.version, 'PENDING_REVIEW') }) } }), /without this release receipt/)
  await assert.rejects(publishRelease({ ...args, previous: { sha256: metadata.sha256, version: metadata.version, item, state: 'unknown' } }), /Invalid previous/)
  await assert.rejects(publishRelease({ ...args, client: { status: async () => ({ publicKey: key }) }, previous: { sha256: metadata.sha256, version: metadata.version, item, state: 'superseded' } }), /terminal previous/)
})
test('a saved successful upload resumes submission without uploading the package again', async () => {
  const { metadata, archive } = fixture(), states = []
  const result = await publishRelease({ metadata, archive, item,
    previous: { sha256: metadata.sha256, version: metadata.version, item, state: 'uploaded' },
    save: async r => states.push(r.state),
    client: { status: async () => ({ publicKey: key }), upload: async () => assert.fail('must not upload twice'), publish: async () => ({ state: 'PENDING_REVIEW' }) },
  })
  assert.equal(result.state, 'pending')
  assert.deepEqual(states, ['submitting', 'pending'])
})
test('lost submission response recovers from the matching pending store revision', async () => {
  const { metadata, archive } = fixture()
  let receipt
  const client = {
    status: async () => ({ publicKey: key }),
    upload: async () => ({ uploadState: 'SUCCEEDED', crxVersion: metadata.version }),
    publish: async () => { throw new Error('publish response lost') },
  }
  const args = { metadata, archive, item, client, save: async r => { receipt = r } }
  await assert.rejects(publishRelease(args), /response lost/)
  assert.equal(receipt.state, 'submitting')
  client.status = async () => ({ publicKey: key, submittedItemRevisionStatus: revision(metadata.version, 'PENDING_REVIEW') })
  assert.equal((await publishRelease({ ...args, previous: receipt })).state, 'pending')
})
test('asynchronous upload polling and rejected submission are recorded separately', async () => {
  const { metadata, archive } = fixture(), states = []
  const result = await publishRelease({ metadata, archive, item, sleep: async () => {}, save: async r => states.push(r.state), client: {
    status: async () => ({ publicKey: key, lastAsyncUploadState: 'SUCCEEDED' }),
    upload: async () => ({ uploadState: 'IN_PROGRESS' }), publish: async () => ({ state: 'REJECTED' }),
  } })
  assert.equal(result.state, 'rejected')
  assert.deepEqual(states, ['uploading', 'uploaded', 'submitting', 'rejected'])
})
test('receipt rendering preserves release notes and does not accumulate stale state lines', () => {
  const receipt = { state: 'pending', version: '0.1.1.1' }, text = renderReceipt('Tester instructions', receipt)
  assert.deepEqual(readReceipt(text), receipt)
  const updated = renderReceipt(text, { ...receipt, state: 'published' })
  assert.ok(updated.startsWith('Tester instructions'))
  assert.equal(updated.split('Chrome Web Store：').length, 2)
  assert.equal(readReceipt(updated).state, 'published')
})
