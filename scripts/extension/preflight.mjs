import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolveProjectPath } from './paths.mjs'

export async function checkCompatibility(metadata, { url, token, fetchImpl = fetch }) {
  if (!url || !token) throw new Error('EXTENSION_API_URL and EXTENSION_API_TOKEN are required for a tagged release')
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) throw new Error('Release API URL must be HTTPS without credentials, query or fragment')
  if (!/^[a-p]{32}$/.test(metadata.extensionId)) throw new Error('Invalid release extension ID')
  const response = await fetchImpl(target.href.replace(/\/$/, '') + '/api/extension/v1/me', {
    headers: { authorization: 'Bearer ' + token, origin: 'chrome-extension://' + metadata.extensionId },
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('Extension readiness failed: HTTP ' + response.status + '; check pairing, expiry and exact ID allowlist')
  const data = (await response.json()).data
  if (!data?.user_id || !data?.connection?.installation_id) throw new Error('Readiness requires a named, paired CI installation')
  const missing = metadata.requiredCapabilities.filter(name => data.capabilities?.[name] !== true)
  if (missing.length) throw new Error('API lacks release capabilities: ' + missing.join(', '))
  if (data.integration_limits?.batch_records !== 50 || !(data.integration_limits?.batch_bytes > 0)) throw new Error('Invalid integration limits')
  return { compatible: true, extensionId: metadata.extensionId, minimumMigration: metadata.minimumMigration }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const metadataPath = resolveProjectPath(process.argv[2], 'Release metadata path')
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    await checkCompatibility(metadata, { url: process.env.EXTENSION_API_URL, token: process.env.EXTENSION_API_TOKEN })
    console.log('Extension release compatibility check passed')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
