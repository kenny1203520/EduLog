import type { OutgoingHttpHeaders } from 'node:http'
import type { ServerOptions as HttpsServerOptions } from 'node:https'
import { readFileSync } from 'node:fs'

export type ViteAllowedHosts = string[] | true | undefined

export const DEFAULT_HSTS_HEADER = 'max-age=31536000; includeSubDomains; preload'

export const DEFAULT_CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests'
].join('; ')

export function parseAllowedHosts(value?: string): ViteAllowedHosts {
  if (!value?.trim()) return undefined

  const hosts = value
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)

  if (hosts.includes('*')) return true
  return hosts.length > 0 ? hosts : undefined
}

export function buildSecurityHeaders(env: Record<string, string | undefined>): OutgoingHttpHeaders {
  return {
    'Strict-Transport-Security': env.EDULOG_HSTS_HEADER?.trim() || DEFAULT_HSTS_HEADER,
    'Content-Security-Policy': env.EDULOG_CSP_HEADER?.trim() || DEFAULT_CSP_HEADER
  }
}

function isEnabled(value?: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '')
}

function readRequiredTlsFile(path: string, label: string): Buffer {
  try {
    return readFileSync(path)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read EduLog HTTPS ${label} at ${path}: ${reason}`)
  }
}

export function buildHttpsOptions(env: Record<string, string | undefined>): HttpsServerOptions | undefined {
  if (!isEnabled(env.EDULOG_HTTPS_ENABLED)) return undefined

  const certPath = env.EDULOG_SSL_CERT_PATH?.trim() || '/app/ssl/fullchain.pem'
  const keyPath = env.EDULOG_SSL_KEY_PATH?.trim() || '/app/ssl/privkey.pem'
  const caPath = env.EDULOG_SSL_CA_PATH?.trim()

  return {
    cert: readRequiredTlsFile(certPath, 'certificate'),
    key: readRequiredTlsFile(keyPath, 'private key'),
    ...(caPath ? { ca: readRequiredTlsFile(caPath, 'CA certificate') } : {})
  }
}
