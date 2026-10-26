import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function isWithin(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function existingAncestor(path) {
  let current = path
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) throw new Error('Could not resolve the path')
    current = parent
  }
  return realpathSync(current)
}

export function resolveWithin(root, input, label) {
  if (typeof input !== 'string' || input.trim() === '') throw new Error(`${label} is required`)

  const canonicalRoot = realpathSync(root)
  const candidate = resolve(canonicalRoot, input)
  if (!isWithin(canonicalRoot, candidate) || !isWithin(canonicalRoot, existingAncestor(candidate))) {
    throw new Error(`${label} must stay within the allowed directory`)
  }
  return candidate
}

export function resolveProjectPath(input, label) {
  return resolveWithin(repoRoot, input, label)
}

export function resolveReleaseArchive(directory, archive) {
  if (typeof archive !== 'string' || !/^EduLog-Teaching-Tools-(?:beta|stable)-\d+\.\d+\.\d+(?:\.\d+)?\.zip$/.test(archive)) {
    throw new Error('Invalid release archive name')
  }
  return resolveWithin(directory, archive, 'Release archive')
}

export function resolveScreenshotDirectory(input, suite) {
  if (input === undefined || input === '') return mkdtempSync(join(tmpdir(), `edulog-${suite}-`))

  const candidate = resolve(input)
  const roots = [tmpdir(), join(repoRoot, 'app/tests/artifacts'), join(repoRoot, 'extension/tests/artifacts')]
  for (const root of roots) {
    if (!isWithin(resolve(root), candidate)) continue
    mkdirSync(root, { recursive: true })
    const canonicalRoot = realpathSync(root)
    if (isWithin(canonicalRoot, candidate)) return resolveWithin(canonicalRoot, candidate, 'Screenshot directory')
  }
  throw new Error('Screenshot directory must be under the system temporary directory or a test artifacts directory')
}

export function resolveNativeAssetsDirectory(input) {
  if (input === undefined || input === '') return undefined

  const candidate = resolve(input)
  const roots = [join(repoRoot, 'node_modules'), join(repoRoot, 'app/node_modules'), join(repoRoot, 'extension/node_modules')]
  for (const root of roots) {
    if (!existsSync(root)) continue
    const canonicalRoot = realpathSync(root)
    if (isWithin(canonicalRoot, candidate)) return resolveWithin(canonicalRoot, candidate, 'Native asset directory')
  }
  throw new Error('Native asset directory must be inside a project node_modules directory')
}

export function resolveNativeAssetFile(directory, filename) {
  if (typeof filename !== 'string' || !/^(?:application-[A-Za-z0-9._-]+|flatpickr\.min|style\.min|all|jquery\.dataTables\.min|bootstrap-table\.min|selectize\.bootstrap5)\.css$/.test(filename)) {
    throw new Error('Invalid native CSS asset name')
  }
  return resolveWithin(directory, filename, 'Native CSS asset')
}
