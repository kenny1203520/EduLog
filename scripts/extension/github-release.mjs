import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseTag, verifyRelease, sha256, repoRoot } from './release.mjs'
import { compareVersions } from './store.mjs'
import { resolveReleaseArchive } from './paths.mjs'
import { optionalEnv } from '../lib/env.mjs'

const apiRoot = 'https://api.github.com'
const apiVersion = '2022-11-28'
const uploadRoot = 'https://uploads.github.com'
// Publishing is pinned to this canonical repository; never derive a request host or repo from job input.
const repository = 'kenny1203520/EduLog'

function token(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('GH_TOKEN is required')
  return value
}

function createGitHubClient(authToken, fetchImpl) {
  const headers = {
    Authorization: `Bearer ${authToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': apiVersion,
  }
  const json = async (response, action) => {
    if (!response.ok) throw new Error(`${action} failed (${response.status})`)
    return response.status === 204 ? null : response.json()
  }

  return {
    async getCommit(tag) {
      const response = await fetchImpl(`${apiRoot}/repos/${repository}/commits/${encodeURIComponent(tag)}`, { headers })
      return json(response, 'GitHub commit lookup')
    },
    async listReleases() {
      const releases = []
      for (let page = 1; page <= 100; page++) {
        const response = await fetchImpl(`${apiRoot}/repos/${repository}/releases?per_page=100&page=${page}`, { headers })
        const batch = await json(response, 'GitHub release listing')
        if (!Array.isArray(batch)) throw new Error('Invalid GitHub releases response')
        releases.push(...batch)
        if (batch.length < 100) return releases
      }
      throw new Error('GitHub release list exceeded the pagination limit')
    },
    async createRelease(body) {
      const response = await fetchImpl(`${apiRoot}/repos/${repository}/releases`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return json(response, 'GitHub release creation')
    },
    async downloadAsset(assetId) {
      if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('Invalid release asset ID')
      const response = await fetchImpl(`${apiRoot}/repos/${repository}/releases/assets/${assetId}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          Accept: 'application/octet-stream',
          'X-GitHub-Api-Version': apiVersion,
        },
      })
      if (!response.ok) throw new Error(`GitHub asset download failed (${response.status})`)
      return Buffer.from(await response.arrayBuffer())
    },
    async uploadAsset(releaseId, name, bytes) {
      if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error('Invalid GitHub release ID')
      if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Invalid release asset name')
      const response = await fetchImpl(`${uploadRoot}/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream' },
        body: bytes,
      })
      await json(response, 'GitHub release asset upload')
    },
    async publishRelease(releaseId, body) {
      if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error('Invalid GitHub release ID')
      const releaseIdSegment = String(releaseId)
      if (!/^[1-9][0-9]{0,15}$/.test(releaseIdSegment)) throw new Error('Invalid GitHub release ID')
      const response = await fetchImpl(`${apiRoot}/repos/${repository}/releases/${encodeURIComponent(releaseIdSegment)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await json(response, 'GitHub release publishing')
    },
  }
}

export async function publishExtensionRelease({
  releaseTag = optionalEnv('RELEASE_TAG', ''),
  metadataPath = join(repoRoot, 'extension/dist/release/release.json'),
  token: tokenValue = optionalEnv('GH_TOKEN'),
  fetchImpl = fetch,
} = {}) {
  const client = createGitHubClient(token(tokenValue), fetchImpl)
  const parsed = parseTag(releaseTag)
  const tag = `extension/${parsed.channel}/v${parsed.version}`
  const directory = dirname(metadataPath)
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  const archivePath = resolveReleaseArchive(directory, metadata.archive)
  verifyRelease(readFileSync(archivePath), metadata)
  if (parsed.version !== metadata.version || parsed.channel !== metadata.channel) throw new Error('Tag/package mismatch')

  const remoteCommit = await client.getCommit(tag)
  if (remoteCommit.sha !== metadata.commit) throw new Error('Tag no longer matches packaged commit')

  const releases = await client.listReleases()
  for (const existing of releases) {
    if (!existing.tag_name.startsWith(`extension/${metadata.channel}/v`)) continue
    const version = parseTag(existing.tag_name).version
    if (compareVersions(metadata.version, version) < 0) throw new Error('A newer release already exists in this channel')
  }

  let release = releases.find(item => item.tag_name === tag)
  let publishDraft = release?.draft === true
  if (!release) {
    release = await client.createRelease({
      tag_name: tag,
      name: `EduLog extension ${parsed.channel} ${parsed.version}`,
      body: readFileSync(join(directory, 'TESTING.md'), 'utf8'),
      draft: true,
      prerelease: metadata.channel === 'beta',
      make_latest: 'false',
    })
    publishDraft = true
    release.assets = []
  }

  const names = [metadata.archive, `${metadata.archive}.sha256`, 'release.json', 'TESTING.md']
  for (const name of names) {
    const localBytes = readFileSync(join(directory, name))
    const existing = release.assets.find(asset => asset.name === name)
    if (existing) {
      const remoteBytes = await client.downloadAsset(existing.id)
      if (sha256(remoteBytes) !== sha256(localBytes)) throw new Error(`Existing release asset differs: ${name}`)
    } else {
      await client.uploadAsset(release.id, name, localBytes)
    }
  }

  if (publishDraft) {
    await client.publishRelease(release.id, { draft: false, prerelease: metadata.channel === 'beta', make_latest: 'false' })
  }
  console.log(`Verified immutable release assets: ${tag}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishExtensionRelease().catch(error => { console.error(error.message); process.exitCode = 1 })
}
