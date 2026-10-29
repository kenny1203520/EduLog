import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/

export function parseTag(tag) {
  const match = TAG_PATTERN.exec(tag)
  if (!match || tag.length - 1 > 128) throw new Error(`Invalid release tag: ${tag}`)
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(id => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) {
    throw new Error(`Invalid SemVer prerelease identifier in tag: ${tag}`)
  }
  return {
    tag,
    version: tag.slice(1),
    major: match[1],
    minor: `${match[1]}.${match[2]}`,
    stable: prerelease.length === 0,
    prerelease,
  }
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

export function compareVersions(left, right) {
  const a = parseTag(`v${left}`)
  const b = parseTag(`v${right}`)
  const coreA = left.split('-')[0].split('.').map(BigInt)
  const coreB = right.split('-')[0].split('.').map(BigInt)
  for (let i = 0; i < 3; i++) {
    if (coreA[i] !== coreB[i]) return coreA[i] < coreB[i] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    if (a.prerelease[i] === undefined) return -1
    if (b.prerelease[i] === undefined) return 1
    const compared = compareIdentifiers(a.prerelease[i], b.prerelease[i])
    if (compared !== 0) return compared
  }
  return 0
}

export function selectPreviousTag(tags, target, { isAncestor = () => true } = {}) {
  const parsedTarget = parseTag(target)
  return tags
    .filter(tag => {
      try {
        const parsed = parseTag(tag)
        return tag !== target && (parsedTarget.stable ? parsed.stable : true)
          && compareVersions(parsed.version, parsedTarget.version) < 0 && isAncestor(tag)
      } catch { return false }
    })
    .sort((a, b) => compareVersions(b.slice(1), a.slice(1)))
    .at(0) ?? null
}

export function extractChangelogSection(markdown, version) {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex(line => new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\](?:\\s|$)`).test(line))
  if (start < 0) return ''
  let end = start + 1
  while (end < lines.length && !/^## \[/.test(lines[end])) end++
  return lines.slice(start + 1, end).join('\n').trim()
}

function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', shell: false }).trim() // NOSONAR: This CLI intentionally uses the caller's Git installation; arguments are passed without a shell.
}

export function validateRelease({ tag, cwd = process.cwd(), outputPath, git = runGit }) {
  const parsed = parseTag(tag)
  const commit = git(['rev-parse', '--verify', '--end-of-options', `refs/tags/${tag}^{commit}`], cwd)
  const pkg = JSON.parse(readFileSync(`${cwd}/app/package.json`, 'utf8'))
  if (pkg.version !== parsed.version) throw new Error(`Tag ${tag} does not match app/package.json version ${pkg.version}`)
  if (outputPath) {
    appendFileSync(outputPath, `tag=${tag}\nversion=${parsed.version}\nmajor=${parsed.major}\nminor=${parsed.minor}\nstable=${parsed.stable}\ncommit=${commit}\n`)
  }
  return { ...parsed, commit }
}

function commitNotes({ base, sha, cwd, repository, git = runGit }) {
  const range = base ? `${base}..${sha}` : sha
  const log = git(['log', '--no-merges', '--reverse', '--format=%H%x09%s', range], cwd)
  const commits = log ? log.split(/\r?\n/).map(line => {
    const [commit, ...parts] = line.split('\t')
    return `- ${parts.join('\t')} ([${commit.slice(0, 7)}](${repository}/commit/${commit}))`
  }) : []
  return commits.length ? `## Commits\n\n${commits.join('\n')}` : 'No commits found in this version range.'
}

function imageNotes({ version, frontendDigest, apiDigest, previous }) {
  const repositoryUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? 'kenny1203520/EduLog'}`
  const comparisonUrl = previous
    ? `${repositoryUrl}/compare/${previous}...${process.env.RELEASE_TAG || `v${version}`}`
    : `${repositoryUrl}/commits/${process.env.RELEASE_TAG || `v${version}`}`
  return [
    '## Container images', '',
    `- Frontend: \`ghcr.io/kenny1203520/edulog:${version}\` (digest \`${frontendDigest}\`)`,
    `- API: \`ghcr.io/kenny1203520/edulog-api:${version}\` (digest \`${apiDigest}\`)`, '',
    '```sh',
    `docker pull ghcr.io/kenny1203520/edulog:${version}`,
    `docker pull ghcr.io/kenny1203520/edulog-api:${version}`,
    '```', '',
    `Full comparison: ${comparisonUrl}`,
  ].join('\n')
}

export async function publishRelease({
  tag, sha, cwd = process.cwd(), repository = process.env.GITHUB_REPOSITORY,
  frontendDigest, apiDigest, gh = defaultGh, git = runGit,
}) {
  const parsed = parseTag(tag)
  const tags = git(['tag', '--merged', sha, '--list', 'v*'], cwd).split(/\r?\n/).filter(Boolean)
  const previous = selectPreviousTag(tags, tag, { isAncestor: candidate => {
    try { git(['merge-base', '--is-ancestor', candidate, sha], cwd); return true } catch { return false }
  } })
  const releases = (await gh(['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`])).flat()
  const existing = releases.find(release => release.tag_name === tag)
  if (existing && !existing.draft) return { status: 'already-published', tag }

  let releaseNotes = ''
  if (previous) {
    const response = await gh(['api', `repos/${repository}/releases/generate-notes`, '-f', `tag_name=${tag}`, '-f', `target_commitish=${sha}`, '-f', `previous_tag_name=${previous}`])
    releaseNotes = response.body ?? ''
  } else {
    releaseNotes = commitNotes({ base: null, sha, cwd, repository, git })
  }
  if (!/\(#\d+\)|\/pull\/\d+/i.test(releaseNotes)) {
    const commits = commitNotes({ base: previous, sha, cwd, repository, git })
    releaseNotes = [releaseNotes.trim(), commits].filter(Boolean).join('\n\n')
  }

  let authoredNotes = ''
  try { authoredNotes = readFileSync(`${cwd}/.github/releases/${tag}.md`, 'utf8').trim() } catch { /* optional file */ }
  if (!authoredNotes) {
    try { authoredNotes = extractChangelogSection(readFileSync(`${cwd}/CHANGELOG.md`, 'utf8'), parsed.version) } catch { /* optional file */ }
  }
  const deployments = [authoredNotes, releaseNotes, imageNotes({ version: parsed.version, frontendDigest, apiDigest, previous })].filter(Boolean).join('\n\n---\n\n')
  const fields = ['-X', existing ? 'PATCH' : 'POST', existing ? `repos/${repository}/releases/${existing.id}` : `repos/${repository}/releases`, '-f', `tag_name=${tag}`, '-f', `name=${tag}`, '-f', `body=${deployments}`, '-F', `draft=${false}`, '-F', `prerelease=${!parsed.stable}`, '-f', `make_latest=${parsed.stable ? 'legacy' : 'false'}`]
  await gh(['api', ...fields])
  return { status: existing ? 'published-draft' : 'published', tag, previous }
}

async function defaultGh(args) {
  const result = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], shell: false }) // NOSONAR: This CLI intentionally uses the caller's GitHub CLI installation; arguments are passed without a shell.
  return result.trim() ? JSON.parse(result) : null
}

async function main() {
  const [command, tag] = process.argv.slice(2)
  if (command === 'validate') {
    const result = validateRelease({ tag, outputPath: process.env.GITHUB_OUTPUT })
    console.log(`Validated ${result.tag} at ${result.commit}`)
  } else if (command === 'publish') {
    const result = await publishRelease({
      tag, sha: process.env.RELEASE_SHA, frontendDigest: process.env.FRONTEND_DIGEST,
      apiDigest: process.env.API_DIGEST,
    })
    console.log(`Release ${result.tag}: ${result.status}`)
  } else {
    throw new Error('Usage: node scripts/release/release.mjs <validate|publish> <tag>')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
