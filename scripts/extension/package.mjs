import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { buildRelease, repoRoot, verifyRelease } from './release.mjs'
import { resolveProjectPath, resolveReleaseArchive } from './paths.mjs'
import { optionalEnv } from '../lib/env.mjs'

try {
  const { values } = parseArgs({ options: {
    channel: { type: 'string', default: 'beta' }, version: { type: 'string' }, ref: { type: 'string', default: 'HEAD' },
    distribution: { type: 'string', default: 'zip' }, out: { type: 'string', default: join(repoRoot, 'extension/dist/beta') },
    verify: { type: 'boolean', default: false }, metadata: { type: 'string' },
  } })
  const output = resolveProjectPath(resolve(values.out), 'Package output directory')
  if (values.verify) {
    const metadataPath = resolveProjectPath(resolve(values.metadata || join(output, 'release.json')), 'Release metadata path')
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    verifyRelease(readFileSync(resolveReleaseArchive(dirname(metadataPath), metadata.archive)), metadata)
    console.log('Extension package verified')
  } else {
    if (!values.version) throw new Error('--version is required')
    const { archive, metadata } = buildRelease({ ...values, publicKey: optionalEnv('CWS_PUBLIC_KEY') })
    mkdirSync(output, { recursive: true })
    const archivePath = resolveReleaseArchive(output, metadata.archive)
    // Metadata is written last, after the bytes on disk have passed verification.
    writeFileSync(archivePath, archive)
    verifyRelease(readFileSync(archivePath), metadata)
    writeFileSync(`${archivePath}.sha256`, `${metadata.sha256}  ${metadata.archive}\n`)
    writeFileSync(join(output, 'TESTING.md'), readFileSync(new URL('../../docs/deployment/extension-testing.md', import.meta.url)))
    writeFileSync(join(output, 'release.json'), JSON.stringify(metadata, null, 2) + '\n')
    console.log('Extension package created and verified')
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
