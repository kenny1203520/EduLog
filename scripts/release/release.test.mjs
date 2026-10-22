import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  compareVersions, extractChangelogSection, parseTag, publishRelease,
  selectPreviousTag, validateRelease,
} from './release.mjs'

test('accepts stable and prerelease SemVer tags, including valid identifiers', () => {
  assert.equal(parseTag('v2.0.0').stable, true)
  assert.equal(parseTag('v2.0.0-rc.1').stable, false)
  assert.equal(parseTag('v0.1.0-alpha-x.12').version, '0.1.0-alpha-x.12')
})

test('rejects malformed, noncanonical and oversized tags', () => {
  for (const tag of ['v01.0.0', 'v1.2', 'v1.2.3+build.1', 'v1.2.3-alpha..1', 'v1.2.3-alpha.01', `v1.2.3-${'a'.repeat(128)}`]) {
    assert.throws(() => parseTag(tag), undefined, tag)
  }
})

test('compares SemVer prerelease identifiers numerically and stable above prerelease', () => {
  assert.equal(compareVersions('2.0.0-alpha.2', '2.0.0-alpha.10'), -1)
  assert.equal(compareVersions('2.0.0-rc.1', '2.0.0'), -1)
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0)
})

test('selects the highest lower stable tag for stable, and highest lower version for prerelease', () => {
  const tags = ['v1.9.0', 'v2.0.0-alpha.1', 'v2.0.0-alpha.2', 'v2.0.0', 'v1.9.0a', 'extension/beta/v9.0.0']
  assert.equal(selectPreviousTag(tags, 'v2.0.0'), 'v1.9.0')
  assert.equal(selectPreviousTag(tags, 'v2.0.0-alpha.3'), 'v2.0.0-alpha.2')
  assert.equal(selectPreviousTag(['v1.0.0'], 'v0.1.0'), null)
  assert.equal(selectPreviousTag(['v1.0.0', 'v2.0.0'], 'v3.0.0', { isAncestor: tag => tag === 'v1.0.0' }), 'v1.0.0')
})

test('validates the tag commit and exact app package version', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'edulog-release-'))
  try {
    mkdirSync(join(cwd, 'app'))
    writeFileSync(join(cwd, 'app/package.json'), JSON.stringify({ version: '2.0.0-alpha.3' }))
    const result = validateRelease({ tag: 'v2.0.0-alpha.3', cwd, git: () => 'abc123' })
    assert.equal(result.commit, 'abc123')
    assert.throws(() => validateRelease({ tag: 'v2.0.0', cwd, git: () => 'abc123' }), /does not match/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('extracts only the exact changelog section and permits a missing section', () => {
  const input = '## [2.0.0]\nStable notes\n\n## [2.0.0-alpha.1]\nAlpha notes\n'
  assert.equal(extractChangelogSection(input, '2.0.0-alpha.1'), 'Alpha notes')
  assert.equal(extractChangelogSection(input, '2.0.1'), '')
})

test('prefers tag-specific release notes over the changelog section', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'edulog-release-notes-'))
  try {
    mkdirSync(join(cwd, '.github/releases'), { recursive: true })
    writeFileSync(join(cwd, '.github/releases/v2.0.0-alpha.3.md'), 'Manual migration notes')
    writeFileSync(join(cwd, 'CHANGELOG.md'), '## [2.0.0-alpha.3]\nGenerated changelog section')
    const harness = publicationHarness()
    await publishRelease({
      tag: 'v2.0.0-alpha.3', sha: 'sha123', cwd, repository: 'kenny1203520/EduLog',
      frontendDigest: 'sha256:front', apiDigest: 'sha256:api', ...harness,
    })
    const create = harness.ghCalls.at(-1)
    assert.ok(create.some(value => value.includes('Manual migration notes')))
    assert.ok(!create.some(value => value.includes('Generated changelog section')))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

function publicationHarness({ releases = [], generated = '## Changes\n\n- A change (#42)', ghOverride } = {}) {
  const ghCalls = []
  const git = args => {
    if (args[0] === 'tag') return 'v1.0.0\nv2.0.0-alpha.1\nv2.0.0-alpha.2\nextension/beta/v99.0.0'
    if (args[0] === 'merge-base') return ''
    if (args[0] === 'log') return 'abc123456789\tfix: correct roster'
    throw new Error(`Unexpected git command: ${args.join(' ')}`)
  }
  const gh = ghOverride ?? (async args => {
    ghCalls.push(args)
    if (args[0] === 'api' && args[1] === '--paginate') return [releases]
    if (args[0] === 'api' && args[1].endsWith('/generate-notes')) return { body: generated }
    if (args[0] === 'api') return { id: 123 }
    throw new Error(`Unexpected gh command: ${args.join(' ')}`)
  })
  return { ghCalls, git, gh }
}

test('generates notes, adds commits when GitHub notes have no PR, and creates a stable release', async () => {
  const harness = publicationHarness({ generated: 'No pull requests were included.' })
  const result = await publishRelease({
    tag: 'v2.0.0', sha: 'sha123', cwd: process.cwd(), repository: 'kenny1203520/EduLog',
    frontendDigest: 'sha256:front', apiDigest: 'sha256:api', ...harness,
  })
  assert.equal(result.status, 'published')
  assert.ok(harness.ghCalls.some(args => args.includes('previous_tag_name=v1.0.0')))
  const create = harness.ghCalls.at(-1)
  assert.ok(create.includes('repos/kenny1203520/EduLog/releases'))
  assert.ok(create.includes('prerelease=false'))
  assert.ok(create.includes('make_latest=legacy'))
  assert.ok(create.some(value => value.includes('fix: correct roster')))
  assert.ok(create.some(value => value.includes('sha256:front')))
})

test('uses full history without a prior release tag and marks prereleases accordingly', async () => {
  const harness = publicationHarness({ releases: [], generated: '' })
  const result = await publishRelease({
    tag: 'v0.1.0-alpha.1', sha: 'sha123', cwd: process.cwd(), repository: 'kenny1203520/EduLog',
    frontendDigest: 'sha256:front', apiDigest: 'sha256:api', ...harness,
  })
  assert.equal(result.previous, null)
  const create = harness.ghCalls.at(-1)
  assert.ok(create.includes('prerelease=true'))
  assert.ok(create.includes('make_latest=false'))
  assert.ok(create.some(value => value.includes('fix: correct roster')))
})

test('leaves published releases untouched and completes an existing draft', async () => {
  const published = publicationHarness({ releases: [{ id: 7, tag_name: 'v2.0.0-alpha.3', draft: false }] })
  assert.equal((await publishRelease({ tag: 'v2.0.0-alpha.3', sha: 'sha', repository: 'o/r', ...published })).status, 'already-published')
  assert.equal(published.ghCalls.length, 1)

  const draft = publicationHarness({ releases: [{ id: 8, tag_name: 'v2.0.0-alpha.3', draft: true }] })
  assert.equal((await publishRelease({ tag: 'v2.0.0-alpha.3', sha: 'sha', repository: 'o/r', ...draft })).status, 'published-draft')
  assert.ok(draft.ghCalls.at(-1).includes('repos/o/r/releases/8'))
  assert.ok(draft.ghCalls.at(-1).includes('-X'))
})

test('fails closed when GitHub API access fails', async () => {
  const harness = publicationHarness({ ghOverride: async () => { throw new Error('API rate limit') } })
  await assert.rejects(publishRelease({ tag: 'v2.0.0-alpha.3', sha: 'sha', repository: 'o/r', ...harness }), /API rate limit/)
})
