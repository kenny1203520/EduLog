import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseTag, verifyRelease, sha256, repoRoot } from './release.mjs'
import { compareVersions } from './store.mjs'
import { resolveReleaseArchive } from './paths.mjs'

const apiRoot = 'https://api.github.com'
const apiVersion = '2022-11-28'

function repositoryName(value = '') {
  const parts = value.split('/')
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) {
    throw new Error('GITHUB_REPOSITORY must be owner/name')
  }
  return value
}

function token(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('GH_TOKEN is required')
  return value
}

function releaseUploadUrl(repository, release) {
  if (!Number.isSafeInteger(release.id) || release.id <= 0 || typeof release.upload_url !== 'string') throw new Error('Invalid GitHub release upload URL')
  const url = new URL(release.upload_url.replace(/\{\?name,label\}$/, ''))
  if (url.protocol !== 'https:' || url.hostname !== 'uploads.github.com' || url.pathname !== `/repos/${repository}/releases/${release.id}/assets`) {
    throw new Error('Unexpected GitHub release upload URL')
  }
  return url
}

function createGitHubClient(authToken, fetchImpl) {
  async function request(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': apiVersion,
        ...options.headers,
      },
    })
    if (!response.ok) throw new Error(`GitHub API request failed (${response.status})`)
    return response.status === 204 ? null : response.json()
  }

  return {
    request,
    async listReleases(repository) {
      const releases = []
      for (let page = 1; page <= 100; page++) {
        const batch = await request(`${apiRoot}/repos/${repository}/releases?per_page=100&page=${page}`)
        if (!Array.isArray(batch)) throw new Error('Invalid GitHub releases response')
        releases.push(...batch)
        if (batch.length < 100) return releases
      }
      throw new Error('GitHub release list exceeded the pagination limit')
    },
    async downloadAsset(repository, assetId) {
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
    async uploadAsset(uploadUrl, name, bytes) {
      const url = new URL(uploadUrl)
      url.searchParams.set('name', name)
      await request(url, {
        method: 'POST',
        headers: { 'Content-Type': name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream' },
        body: bytes,
      })
    },
  }
}

export async function publishExtensionRelease({
  repository: repositoryValue = process.env.GITHUB_REPOSITORY || '',
  releaseTag = process.env.RELEASE_TAG || '',
  metadataPath = join(repoRoot, 'extension/dist/release/release.json'),
  token: tokenValue = process.env.GH_TOKEN,
  fetchImpl = fetch,
} = {}) {
  const repository = repositoryName(repositoryValue)
  const client = createGitHubClient(token(tokenValue), fetchImpl)
  const parsed = parseTag(releaseTag)
  const tag = `extension/${parsed.channel}/v${parsed.version}`
  const directory = dirname(metadataPath)
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  const archivePath = resolveReleaseArchive(directory, metadata.archive)
  verifyRelease(readFileSync(archivePath), metadata)
  if (parsed.version !== metadata.version || parsed.channel !== metadata.channel) throw new Error('Tag/package mismatch')

  const remoteCommit = await client.request(`${apiRoot}/repos/${repository}/commits/${encodeURIComponent(tag)}`)
  if (remoteCommit.sha !== metadata.commit) throw new Error('Tag no longer matches packaged commit')

  const releases = await client.listReleases(repository)
  for (const existing of releases) {
    if (!existing.tag_name.startsWith(`extension/${metadata.channel}/v`)) continue
    const version = parseTag(existing.tag_name).version
    if (compareVersions(metadata.version, version) < 0) throw new Error('A newer release already exists in this channel')
  }

  let release = releases.find(item => item.tag_name === tag)
  let publishDraft = release?.draft === true
  if (!release) {
    release = await client.request(`${apiRoot}/repos/${repository}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: `EduLog extension ${parsed.channel} ${parsed.version}`,
        body: readFileSync(join(directory, 'TESTING.md'), 'utf8'),
        draft: true,
        prerelease: metadata.channel === 'beta',
        make_latest: 'false',
      }),
    })
    publishDraft = true
    release.assets = []
  }

  const names = [metadata.archive, `${metadata.archive}.sha256`, 'release.json', 'TESTING.md']
  for (const name of names) {
    const localBytes = readFileSync(join(directory, name))
    const existing = release.assets.find(asset => asset.name === name)
    if (existing) {
      const remoteBytes = await client.downloadAsset(repository, existing.id)
      if (sha256(remoteBytes) !== sha256(localBytes)) throw new Error(`Existing release asset differs: ${name}`)
    } else {
      await client.uploadAsset(releaseUploadUrl(repository, release), name, localBytes)
    }
  }

  if (publishDraft) {
    await client.request(`${apiRoot}/repos/${repository}/releases/${release.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: false, prerelease: metadata.channel === 'beta', make_latest: 'false' }),
    })
  }
  console.log(`Verified immutable release assets: ${tag}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishExtensionRelease().catch(error => { console.error(error.message); process.exitCode = 1 })
}
