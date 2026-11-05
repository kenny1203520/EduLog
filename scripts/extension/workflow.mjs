import { appendFileSync } from 'node:fs'
import { assertReleaseBranchAncestry, parseTag, extensionId, config } from './release.mjs'
import { optionalEnv } from '../lib/env.mjs'

try {
  const tagged = optionalEnv('GITHUB_REF_TYPE') === 'tag'
  const release = tagged ? parseTag(optionalEnv('GITHUB_REF_NAME')) : { channel: 'beta', version: '0.0.0.1' }
  if (tagged) {
    const branch = release.channel === 'beta' ? 'develop' : 'master'
    assertReleaseBranchAncestry(branch)
    if (release.channel === 'stable' && optionalEnv('STABLE_ENABLED') !== 'true') throw new Error('Stable store channel has not been enabled')
  }
  const distribution = tagged ? (release.channel === 'stable' ? 'store' : optionalEnv('BETA_DISTRIBUTION', 'zip')) : 'zip'
  if (!['zip', 'store'].includes(distribution)) throw new Error('Invalid extension distribution configuration')
  const publicKey = distribution === 'zip' ? config.sideloadPublicKey : optionalEnv(release.channel === 'beta' ? 'BETA_PUBLIC_KEY' : 'STABLE_PUBLIC_KEY')
  const item = distribution === 'store' ? optionalEnv(release.channel === 'beta' ? 'BETA_ITEM' : 'STABLE_ITEM') : extensionId(publicKey)
  if (!publicKey || extensionId(publicKey) !== item) throw new Error('Configure a matching Chrome Web Store item ID and public key')
  const output = { ...release, distribution, item, public_key: publicKey, tagged: String(tagged) }
  const githubOutput = optionalEnv('GITHUB_OUTPUT')
  if (githubOutput) for (const [name, value] of Object.entries(output)) appendFileSync(githubOutput, name + '=' + value + '\n')
  console.log(JSON.stringify({ ...release, distribution, item, tagged }))
} catch (error) { console.error(error.message); process.exitCode = 1 }
