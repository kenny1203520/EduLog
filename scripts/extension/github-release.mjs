import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { parseTag, verifyRelease, sha256 } from './release.mjs'
import { compareVersions } from './store.mjs'

const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
try {
  const path = process.argv[2], directory = dirname(path), metadata = JSON.parse(readFileSync(path, 'utf8'))
  verifyRelease(readFileSync(join(directory, metadata.archive)), metadata)
  const tag = process.env.RELEASE_TAG, parsed = parseTag(tag)
  if (parsed.version !== metadata.version || parsed.channel !== metadata.channel) throw new Error('Tag/package mismatch')
  const remoteCommit = gh(['api', 'repos/{owner}/{repo}/commits/' + encodeURIComponent(tag), '--jq', '.sha']).trim()
  if (remoteCommit !== metadata.commit) throw new Error('Tag no longer matches packaged commit')
  // An API failure is not treated as a missing release.
  const response = JSON.parse(gh(['api', '--paginate', '--slurp', 'repos/{owner}/{repo}/releases?per_page=100'])).flat()
  for (const existing of response) {
    if (!existing.tag_name.startsWith('extension/' + metadata.channel + '/v')) continue
    const version = parseTag(existing.tag_name).version
    if (compareVersions(metadata.version, version) < 0) throw new Error('A newer release already exists in this channel')
  }
  let release = response.find(r => r.tag_name === tag)
  let publishDraft = release?.draft === true
  if (!release) {
    const args = ['release', 'create', tag, '--verify-tag', '--draft', '--title', 'EduLog extension ' + parsed.channel + ' ' + parsed.version, '--notes-file', join(directory, 'TESTING.md'), '--latest=false']
    if (metadata.channel === 'beta') args.push('--prerelease')
    gh(args)
    publishDraft = true
    release = JSON.parse(gh(['release', 'view', tag, '--json', 'assets']))
  } else release.assets ||= []
  const names = [metadata.archive, metadata.archive + '.sha256', 'release.json', 'TESTING.md']
  const temporary = mkdtempSync(join(tmpdir(), 'edulog-release-verify-'))
  try {
    for (const name of names) if (release.assets.some(a => a.name === name)) {
      gh(['release', 'download', tag, '--pattern', name, '--dir', temporary])
      if (sha256(readFileSync(join(temporary, name))) !== sha256(readFileSync(join(directory, name)))) throw new Error('Existing release asset differs: ' + name)
    }
    for (const name of names) if (!release.assets.some(a => a.name === name)) gh(['release', 'upload', tag, join(directory, name)])
  } finally { rmSync(temporary, { recursive: true, force: true }) }
  if (publishDraft) gh(['release', 'edit', tag, '--draft=false', '--prerelease=' + (metadata.channel === 'beta'), '--latest=false'])
  console.log('Verified immutable release assets: ' + tag)
} catch (error) { console.error(error.message); process.exitCode = 1 }
