import { createHash, createPublicKey } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { safePath, zipFiles, unzipFiles } from './archive.mjs'
import { assertNoSecrets } from './secrets.mjs'
import { repoRoot } from './paths.mjs'

export { repoRoot }

export const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'))
export const sha256 = data => createHash('sha256').update(data).digest('hex')
const gitExecutable = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git'
const gitOptions = { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024, shell: false }

function validateCommit(commit) {
  if (typeof commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid Git commit ID')
  return commit
}

export function validateGitRef(ref) {
  if (typeof ref !== 'string' || !/^(?:HEAD|[a-f0-9]{40}|[a-f0-9]{64}|[A-Za-z0-9][A-Za-z0-9._/-]{0,127})$/.test(ref) || /(?:\.\.|\/\/|\/(?:\.|\.\.)\/|\/$|\.$)/.test(ref)) {
    throw new Error('Invalid Git reference')
  }
  return ref
}

export function resolveCommit(ref) {
  const safeRef = validateGitRef(ref)
  const resolved = execFileSync(gitExecutable, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    ...gitOptions,
    input: `${safeRef}^{commit}\n`,
  }).toString().trim()
  const [commit, objectType] = resolved.split(' ')
  if (objectType !== 'commit') throw new Error('Git reference must resolve to a commit')
  return validateCommit(commit)
}

function listExtensionTree(commit) {
  const safeCommit = validateCommit(commit)
  return execFileSync(gitExecutable, ['ls-tree', '-r', '-z', safeCommit, '--', 'extension/'], gitOptions).toString().split('\0').filter(Boolean).map(entry => {
    const separator = entry.indexOf('\t')
    if (separator < 0) throw new Error('Invalid Git tree entry')
    const [mode, type, objectId] = entry.slice(0, separator).split(' ')
    const path = entry.slice(separator + 1)
    safePath(path)
    if (!path.startsWith('extension/') || type !== 'blob' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(objectId)) throw new Error('Invalid extension tree entry')
    return { mode, objectId, path }
  })
}

const legalFileNames = new Set(['LICENSE', 'NOTICE'])
function listRootLegalFiles(commit) {
  const safeCommit = validateCommit(commit)
  return execFileSync(gitExecutable, ['ls-tree', '-z', safeCommit, '--', ...legalFileNames], gitOptions).toString().split('\0').filter(Boolean).map(entry => {
    const separator = entry.indexOf('\t')
    if (separator < 0) throw new Error('Invalid root legal-file tree entry')
    const [mode, type, objectId] = entry.slice(0, separator).split(' ')
    const path = entry.slice(separator + 1)
    safePath(path)
    if (!legalFileNames.has(path) || type !== 'blob' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(objectId)) throw new Error('Invalid root legal-file tree entry')
    return { mode, objectId, path }
  })
}

function readGitBlob(objectId) {
  if (typeof objectId !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(objectId)) throw new Error('Invalid Git object ID')
  return execFileSync(gitExecutable, ['cat-file', 'blob', objectId], gitOptions)
}

export function readExtensionFileAtCommit(commit, path) {
  const safeCommit = validateCommit(commit)
  const safeFilePath = safePath(path)
  if (!safeFilePath.startsWith('extension/')) throw new Error('File must be inside the extension directory')
  const entry = listExtensionTree(safeCommit).find(file => file.path === safeFilePath)
  if (!entry) throw new Error('Extension file does not exist at the selected commit')
  if (entry.mode !== '100644' && entry.mode !== '100755') throw new Error(`Unsupported runtime file mode: ${safeFilePath}`)
  return readGitBlob(entry.objectId)
}

export function readRootLegalFileAtCommit(commit, path) {
  const safeCommit = validateCommit(commit)
  if (!legalFileNames.has(path)) throw new Error('File is not a required root legal document')
  const entry = listRootLegalFiles(safeCommit).find(file => file.path === path)
  if (!entry) throw new Error(`Selected commit is missing required ${path}`)
  if (entry.mode !== '100644') throw new Error(`Unsupported legal file mode: ${path}`)
  return readGitBlob(entry.objectId)
}

function readCommitDate(commit) {
  const safeCommit = validateCommit(commit)
  return execFileSync(gitExecutable, ['show', '-s', '--format=%cI', safeCommit], gitOptions).toString().trim()
}

export function assertReleaseBranchAncestry(branch) {
  if (branch !== 'develop' && branch !== 'master') throw new Error('Invalid release branch')
  execFileSync(gitExecutable, ['merge-base', '--is-ancestor', 'HEAD', `origin/${branch}`], gitOptions)
}

export function parseVersion(version, channel) {
  if (!['beta', 'stable'].includes(channel)) throw new Error('Channel must be beta or stable')
  const parts = String(version).split('.')
  if (parts.length !== (channel === 'beta' ? 4 : 3) || parts.some(p => !/^(0|[1-9][0-9]*)$/.test(p) || Number(p) > 65535) || parts.every(p => Number(p) === 0) || (channel === 'beta' && parts[3] === '0')) throw new Error('Use M.m.p.build (build >= 1) for beta or M.m.p for stable; components are 0..65535')
  return { version, versionName: channel === 'beta' ? `${parts.slice(0, 3).join('.')}-beta.${parts[3]}` : version }
}
export function parseTag(tag) {
  const match = /^extension\/(beta|stable)\/v([0-9.]+)$/.exec(tag)
  if (!match) throw new Error('Invalid extension release tag')
  return { channel: match[1], ...parseVersion(match[2], match[1]) }
}
export function extensionId(key) {
  const bytes = Buffer.from(key, 'base64')
  if (bytes.toString('base64') !== key || createPublicKey({ key: bytes, type: 'spki', format: 'der' }).asymmetricKeyType !== 'rsa') throw new Error('Expected a base64 DER RSA public key')
  return sha256(bytes).slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + Number.parseInt(c, 16)))
}
export function runtimePath(path) {
  return path === 'manifest.json' || /^(background|content|popup|sidepanel|shared|sites|styles|workspace|icons|assets)\/(?!.*(?:^|\/)[.])[^\s]+\.(js|css|html|json|png|svg|jpg|jpeg|webp|woff2?)$/.test(path)
}
function reference(files, source, value) {
  if (!value || /^(?:[a-z]+:|#|\/\/)/i.test(value)) return
  const clean = value.split(/[?#]/)[0]
  const path = posix.normalize(posix.join(posix.dirname(source), clean))
  safePath(path)
  if (!files.has(path)) throw new Error(`${source} references missing file ${value}`)
}
export function validateRuntime(files) {
  assertNoSecrets(files)
  for (const name of files.keys()) if (!runtimePath(safePath(name)) && !legalFileNames.has(name)) throw new Error(`Unexpected runtime file: ${name}`)
  for (const name of legalFileNames) if (!files.has(name) || files.get(name).length === 0) throw new Error(`Release archive is missing ${name}`)
  const manifest = JSON.parse(files.get('manifest.json')?.toString() || 'null')
  if (manifest?.manifest_version !== 3 || !manifest.background?.service_worker || !manifest.action?.default_popup) throw new Error('Invalid MV3 runtime manifest')
  parseVersion(manifest.version, manifest.name.endsWith(' BETA') ? 'beta' : 'stable')
  extensionId(manifest.key)
  const refs = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons || {}), ...Object.values(manifest.action.default_icon || {}), ...(manifest.content_scripts || []).flatMap(s => [...(s.js || []), ...(s.css || [])])]
  for (const ref of refs) reference(files, 'manifest.json', ref)
  for (const [name, buffer] of files) {
    const text = buffer.toString('utf8')
    if (name.endsWith('.js')) {
      const checked = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: text, encoding: 'utf8' })
      if (checked.status !== 0) throw new Error(`JavaScript syntax failure: ${name}\n${checked.stderr}`)
      for (const match of text.matchAll(/\b(?:import|export)\s+(?:[^'";\n]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const ref = match[1] || match[2]
        if (ref.startsWith('.')) reference(files, name, ref)
        else throw new Error(`Runtime imports must be bundled: ${name}: ${ref}`)
      }
      for (const match of text.matchAll(/\bgetURL\(\s*['"]([^'"]+)['"]\s*\)/g)) reference(files, 'manifest.json', match[1])
    }
    if (name.endsWith('.html')) for (const match of text.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) reference(files, name, match[1])
    if (name.endsWith('.css')) for (const match of text.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) reference(files, name, match[1])
  }
  return manifest
}
export function buildRelease({ ref = 'HEAD', channel = 'beta', version, distribution = 'zip', publicKey }) {
  const parsed = parseVersion(version, channel)
  if (!['zip', 'store'].includes(distribution)) throw new Error('Distribution must be zip or store')
  if (channel === 'stable' && distribution !== 'store') throw new Error('Stable releases require a configured store item')
  const commit = resolveCommit(ref)
  const files = new Map()
  for (const { mode, objectId, path: fullPath } of listExtensionTree(commit)) {
    const name = fullPath.slice('extension/'.length)
    if (!runtimePath(name)) continue
    if (mode !== '100644' && mode !== '100755') throw new Error(`Unsupported runtime file mode: ${fullPath}`)
    files.set(name, readGitBlob(objectId))
  }
  for (const { mode, objectId, path } of listRootLegalFiles(commit)) {
    if (mode !== '100644') throw new Error(`Unsupported legal file mode: ${path}`)
    files.set(path, readGitBlob(objectId))
  }
  for (const name of legalFileNames) if (!files.has(name)) throw new Error(`Selected commit is missing required ${name}`)
  if (!files.has('manifest.json')) throw new Error('Selected commit does not contain an extension manifest')
  const manifest = JSON.parse(files.get('manifest.json').toString())
  const key = distribution === 'zip' ? config.sideloadPublicKey : publicKey
  if (!key) throw new Error('Store packaging requires CWS_PUBLIC_KEY from the item dashboard')
  manifest.name = manifest.name.replace(/ BETA$/, '') + (channel === 'beta' ? ' BETA' : '')
  manifest.description = channel === 'beta' ? 'THIS EXTENSION IS FOR BETA TESTING. Improve teaching system workflows with EduLog.' : manifest.description
  Object.assign(manifest, { version, version_name: parsed.versionName, key })
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  const archive = zipFiles(files), unpacked = unzipFiles(archive)
  validateRuntime(unpacked)
  for (const [name, content] of files) if (!unpacked.get(name)?.equals(content)) throw new Error(`Archive differs: ${name}`)
  const filename = `EduLog-Teaching-Tools-${channel}-${version}.zip`
  const metadata = {
    schemaVersion: 1, channel, distribution, ...parsed, commit,
    sourceDate: readCommitDate(commit),
    extensionId: extensionId(key), archive: filename, sha256: sha256(archive),
    minimumMigration: config.minimumMigration, requiredCapabilities: config.requiredCapabilities,
    files: Object.fromEntries([...unpacked].map(([name, data]) => [name, sha256(data)])),
  }
  return { archive, metadata, files: unpacked }
}
export function verifyRelease(archive, metadata) {
  if (sha256(archive) !== metadata.sha256) throw new Error('Archive SHA-256 mismatch')
  const files = unzipFiles(archive), manifest = validateRuntime(files)
  if (manifest.version !== metadata.version || manifest.version_name !== metadata.versionName || extensionId(manifest.key) !== metadata.extensionId) throw new Error('Manifest/release metadata mismatch')
  if (files.size !== Object.keys(metadata.files).length) throw new Error('Archive file list mismatch')
  for (const [name, data] of files) if (sha256(data) !== metadata.files[name]) throw new Error(`File SHA-256 mismatch: ${name}`)
  return files
}
