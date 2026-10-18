import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { buildRelease, repoRoot, verifyRelease } from './release.mjs'

try {
  const { values } = parseArgs({ options: {
    channel: { type: 'string', default: 'beta' }, version: { type: 'string' }, ref: { type: 'string', default: 'HEAD' },
    distribution: { type: 'string', default: 'zip' }, out: { type: 'string', default: join(repoRoot, 'extension/dist/beta') },
    verify: { type: 'boolean', default: false }, metadata: { type: 'string' },
  } })
  const output = resolve(values.out)
  if (values.verify) {
    const metadataPath = values.metadata || join(output, 'release.json'), metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    verifyRelease(readFileSync(join(dirname(metadataPath), metadata.archive)), metadata)
    console.log(`Verified ${metadata.archive}: ${metadata.extensionId} @ ${metadata.commit}`)
  } else {
    if (!values.version) throw new Error('--version is required')
    const { archive, metadata } = buildRelease({ ...values, publicKey: process.env.CWS_PUBLIC_KEY })
    mkdirSync(output, { recursive: true })
    // Metadata is written last, after the bytes on disk have passed verification.
    writeFileSync(join(output, metadata.archive), archive)
    verifyRelease(readFileSync(join(output, metadata.archive)), metadata)
    writeFileSync(join(output, `${metadata.archive}.sha256`), `${metadata.sha256}  ${metadata.archive}\n`)
    writeFileSync(join(output, 'TESTING.md'), readFileSync(new URL('../../docs/deployment/extension-testing.md', import.meta.url)))
    writeFileSync(join(output, 'release.json'), JSON.stringify(metadata, null, 2) + '\n')
    console.log(`Packaged ${join(output, metadata.archive)}\nID: ${metadata.extensionId}\nCommit: ${metadata.commit}\nSHA-256: ${metadata.sha256}`)
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
