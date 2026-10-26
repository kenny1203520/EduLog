import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extensionId, parseTag, verifyRelease } from './release.mjs'
import { resolveProjectPath, resolveReleaseArchive } from './paths.mjs'

const liveStates = new Set(['PUBLISHED', 'PUBLISHED_TO_TESTERS'])
const versions = revision => (revision?.distributionChannels || []).map(c => c.crxVersion).filter(Boolean)
export const compareVersions = (a, b) => {
  const left = a.split('.').map(Number), right = b.split('.').map(Number)
  for (let i = 0; i < 4; i++) if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0) ? 1 : -1
  return 0
}
export function releaseState(status, version, { detectSuperseded = false } = {}) {
  if (status.takenDown || status.warned) throw new Error('Store item has a policy warning or takedown; inspect the dashboard')
  const submitted = status.submittedItemRevisionStatus
  if (versions(submitted).includes(version)) {
    if (submitted.state === 'REJECTED' || submitted.state === 'CANCELLED') return 'rejected'
    if (submitted.state === 'PENDING_REVIEW') return 'pending'
    if (submitted.state === 'STAGED') throw new Error('Unexpected staged publish; inspect the dashboard')
    if (liveStates.has(submitted.state)) return 'published'
  }
  const published = status.publishedItemRevisionStatus
  if (liveStates.has(published?.state) && versions(published).includes(version)) return 'published'
  if (detectSuperseded && versions(published).some(current => compareVersions(current, version) > 0)) return 'superseded'
  return null
}
export function createStoreClient({ publisher, item, token, fetchImpl = fetch }) {
  if (!/^[a-zA-Z0-9_-]+$/.test(publisher || '') || !/^[a-p]{32}$/.test(item || '') || !token) throw new Error('CWS_PUBLISHER_ID, CWS_EXTENSION_ID and CWS_ACCESS_TOKEN are required')
  const name = 'publishers/' + publisher + '/items/' + item
  async function request(suffix, body, media = false) {
    const response = await fetchImpl('https://chromewebstore.googleapis.com/' + (media ? 'upload/' : '') + 'v2/' + name + ':' + suffix, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': media ? 'application/zip' : 'application/json' }) },
      body: body === undefined ? undefined : media ? body : JSON.stringify(body),
    })
    // Never echo server bodies: credentials and user data do not belong in Actions logs.
    if (!response.ok) throw new Error('Chrome Web Store ' + suffix + ' failed: HTTP ' + response.status + '; inspect the developer dashboard')
    return response.json()
  }
  return { status: () => request('fetchStatus'), upload: bytes => request('upload', bytes, true), publish: () => request('publish', { publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true }) }
}
export async function publishRelease({ client, metadata, archive, item, previous, save, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  verifyRelease(archive, metadata)
  if (metadata.distribution !== 'store' || metadata.extensionId !== item) throw new Error('Store package/target ID mismatch')
  if (previous && (previous.sha256 !== metadata.sha256 || previous.version !== metadata.version || previous.item !== item)) throw new Error('Release already records different package bytes or item')
  if (previous && !['packed', 'uploading', 'uploaded', 'submitting', 'pending', 'published', 'rejected', 'superseded'].includes(previous.state)) throw new Error('Invalid previous release receipt state')
  let receipt = previous || { schemaVersion: 1, state: 'packed', channel: metadata.channel, version: metadata.version, sha256: metadata.sha256, item }
  const record = async state => { receipt = { ...receipt, state }; await save(receipt); return receipt }
  let status = await client.status()
  if (!status.publicKey || extensionId(status.publicKey) !== item) throw new Error('Store public key/target ID mismatch')
  const state = releaseState(status, metadata.version)
  if (state) {
    if (!previous) throw new Error('Remote version exists without this release receipt; cannot prove identical package bytes')
    return record(state)
  }
  if (status.submittedItemRevisionStatus?.state === 'PENDING_REVIEW') throw new Error('Another version is under review; leave its submission intact')
  const remoteVersions = [...versions(status.publishedItemRevisionStatus), ...versions(status.submittedItemRevisionStatus)]
  if (remoteVersions.some(v => compareVersions(metadata.version, v) <= 0)) throw new Error('Release version must exceed every remote version')
  if (['uploading', 'submitting', 'rejected', 'published', 'pending', 'superseded'].includes(receipt.state)) throw new Error('Ambiguous or terminal previous state: ' + receipt.state + '; inspect dashboard before using a higher version')
  if (receipt.state === 'packed') {
    if (['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(status.lastAsyncUploadState)) throw new Error('A different upload is in progress')
    // Persist intent before mutations. A lost response never triggers a blind re-upload.
    await record('uploading')
    const uploaded = await client.upload(archive)
    if (!['SUCCEEDED', 'UPLOAD_SUCCESS', 'IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(uploaded.uploadState)) throw new Error('Store upload failed')
    if (['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(uploaded.uploadState)) {
      let ready = false
      for (let attempt = 0; attempt < 20; attempt++) {
        await sleep(3000); status = await client.status()
        if (['SUCCEEDED', 'UPLOAD_SUCCESS'].includes(status.lastAsyncUploadState)) { ready = true; break }
        if (!['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(status.lastAsyncUploadState)) throw new Error('Async upload failed or disappeared')
      }
      if (!ready) throw new Error('Async upload timed out; inspect dashboard before retry')
    } else if (uploaded.crxVersion !== metadata.version) throw new Error('Uploaded version does not match package')
    await record('uploaded')
  }
  await record('submitting')
  const published = await client.publish()
  if (published.state === 'REJECTED' || published.state === 'CANCELLED') return record('rejected')
  if (liveStates.has(published.state)) return record('published')
  if (published.state !== 'PENDING_REVIEW') throw new Error('Unexpected submission state; inspect dashboard')
  return record('pending')
}

const marker = /\n?<!-- edulog-extension-state\n([\s\S]*?)\n-->\n?/
export function readReceipt(body = '') { const match = marker.exec(body); return match ? JSON.parse(match[1]) : null }
export function renderReceipt(body, receipt) {
  const labels = { packed: '已封裝', uploading: '上傳處理中', uploaded: '已上傳', submitting: '送審處理中', pending: '審查中', published: '已上線', rejected: '遭拒或已取消', superseded: '已有較新上線版本；舊送審結果請查商店後台' }
  const clean = body.replace(marker, '\n').replace(/\nChrome Web Store：[^\n]*/g, '').trim()
  return clean + '\n\nChrome Web Store：' + labels[receipt.state] + '（' + receipt.version + '）\n\n<!-- edulog-extension-state\n' + JSON.stringify(receipt) + '\n-->\n'
}
export function githubApiUrl(repository, endpoint) {
  const [owner, name] = (repository || '').split('/')
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner || '') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,98}$/.test(name || '') || name === '.' || name === '..') {
    throw new Error('Invalid GitHub repository')
  }
  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  const url = new URL('https://api.github.com')
  if (endpoint.kind === 'releases') {
    if (!Number.isSafeInteger(endpoint.page) || endpoint.page < 1) throw new Error('Invalid release page')
    url.pathname = `${repositoryPath}/releases`
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(endpoint.page))
  } else if (endpoint.kind === 'tag') {
    parseTag(endpoint.tag)
    url.pathname = `${repositoryPath}/releases/tags/${encodeURIComponent(endpoint.tag)}`
  } else if (endpoint.kind === 'release') {
    if (!/^[1-9][0-9]*$/.test(String(endpoint.id))) throw new Error('Invalid GitHub release ID')
    url.pathname = `${repositoryPath}/releases/${endpoint.id}`
  } else {
    throw new Error('Invalid GitHub release request')
  }
  if (url.origin !== 'https://api.github.com') throw new Error('Invalid GitHub API origin')
  return url
}

function githubClient() {
  const repository = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN required for durable release state')
  return async (endpoint, body) => {
    const response = await fetch(githubApiUrl(repository, endpoint), {
      method: body === undefined ? 'GET' : 'PATCH', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) throw new Error('GitHub release state failed: HTTP ' + response.status)
    return response.json()
  }
}
async function main() {
  const gh = githubClient(), token = process.env.CWS_ACCESS_TOKEN, publisher = process.env.CWS_PUBLISHER_ID
  if (process.argv[2] === 'monitor') {
    // Follow all historical pending submissions, not just the most recent page.
    for (let page = 1; ; page++) {
      const releases = await gh({ kind: 'releases', page })
      for (const release of releases) {
        const receipt = readReceipt(release.body || '')
        if (!receipt || !['pending', 'submitting'].includes(receipt.state)) continue
        const client = createStoreClient({ publisher: receipt.publisher, item: receipt.item, token })
        const state = releaseState(await client.status(), receipt.version, { detectSuperseded: true })
        if (state && state !== receipt.state) {
          await gh({ kind: 'release', id: release.id }, { body: renderReceipt(release.body || '', { ...receipt, state }) })
          console.log(release.tag_name + ': ' + state)
          if (state === 'rejected') process.exitCode = 1
        }
      }
      if (releases.length < 100) break
    }
    return
  }
  const metadataPath = resolveProjectPath(process.argv[2], 'Release metadata path')
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  const archive = readFileSync(resolveReleaseArchive(dirname(metadataPath), metadata.archive)), item = process.env.CWS_EXTENSION_ID
  const releaseTag = process.env.RELEASE_TAG || ''
  parseTag(releaseTag)
  const release = await gh({ kind: 'tag', tag: releaseTag })
  const client = createStoreClient({ publisher, item, token })
  const receipt = await publishRelease({ client, metadata, archive, item, previous: readReceipt(release.body || ''), save: async receipt => {
    await gh({ kind: 'release', id: release.id }, { body: renderReceipt(release.body || '', { ...receipt, publisher }) })
  } })
  console.log('Chrome Web Store: ' + receipt.state)
  if (receipt.state === 'rejected') process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
