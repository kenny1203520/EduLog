import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CSP_HEADER,
  DEFAULT_HSTS_HEADER,
  buildHttpsOptions,
  buildSecurityHeaders,
  frameAncestors,
  parseAllowedHosts
} from './vite.security'

describe('vite security helpers', () => {
  it('parses comma-separated allowed hosts', () => {
    expect(parseAllowedHosts('localhost, 127.0.0.1, app.example.com ,,')).toEqual([
      'localhost',
      '127.0.0.1',
      'app.example.com'
    ])
  })

  it('does not override Vite defaults when allowed hosts are empty', () => {
    expect(parseAllowedHosts(undefined)).toBeUndefined()
    expect(parseAllowedHosts('   ')).toBeUndefined()
  })

  it('allows wildcard hosts only when explicitly configured', () => {
    expect(parseAllowedHosts('*')).toBe(true)
    expect(parseAllowedHosts('localhost,*')).toBe(true)
  })

  it('builds the default security headers expected by scanners', () => {
    expect(buildSecurityHeaders({})).toEqual({
      'Strict-Transport-Security': DEFAULT_HSTS_HEADER,
      'Content-Security-Policy': DEFAULT_CSP_HEADER
    })

    expect(DEFAULT_CSP_HEADER).toContain("default-src 'self'")
    expect(DEFAULT_CSP_HEADER).toContain("script-src 'self'")
    expect(DEFAULT_CSP_HEADER).not.toContain('unsafe-eval')
    expect(DEFAULT_CSP_HEADER).toContain('http://localhost:*')
    expect(DEFAULT_CSP_HEADER).toContain('ws://localhost:*')
  })

  it('lets only exact extension origins frame the app for the extension side panel', () => {
    const extension = 'chrome-extension://caefagceiajdhjnmogiaicaijckmplge'
    expect(DEFAULT_CSP_HEADER).toContain("frame-ancestors 'none'")
    expect(frameAncestors({ API_EXTENSION_ALLOWED_ORIGINS: `${extension}, chrome-extension://*` })).toBe(extension)
    expect(frameAncestors({ EDULOG_FRAME_ANCESTORS: 'https://evil.example *' })).toBe("'none'")
    expect(buildSecurityHeaders({ EDULOG_FRAME_ANCESTORS: extension })['Content-Security-Policy']).toContain(`frame-ancestors ${extension};`)
  })

  it('allows HSTS and CSP overrides from env', () => {
    expect(
      buildSecurityHeaders({
        EDULOG_HSTS_HEADER: 'max-age=60',
        EDULOG_CSP_HEADER: "default-src 'none'"
      })
    ).toEqual({
      'Strict-Transport-Security': 'max-age=60',
      'Content-Security-Policy': "default-src 'none'"
    })
  })

  it('does not read TLS files when native HTTPS is disabled', () => {
    expect(
      buildHttpsOptions({
        EDULOG_HTTPS_ENABLED: 'false',
        EDULOG_SSL_CERT_PATH: 'missing-cert.pem',
        EDULOG_SSL_KEY_PATH: 'missing-key.pem'
      })
    ).toBeUndefined()
  })

  it('reads cert, key, and optional CA when native HTTPS is enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edulog-https-'))
    const certPath = join(dir, 'fullchain.pem')
    const keyPath = join(dir, 'privkey.pem')
    const caPath = join(dir, 'ca.pem')

    writeFileSync(certPath, 'test-cert')
    writeFileSync(keyPath, 'test-key')
    writeFileSync(caPath, 'test-ca')

    expect(
      buildHttpsOptions({
        EDULOG_HTTPS_ENABLED: 'true',
        EDULOG_SSL_CERT_PATH: certPath,
        EDULOG_SSL_KEY_PATH: keyPath,
        EDULOG_SSL_CA_PATH: caPath
      })
    ).toEqual({
      cert: Buffer.from('test-cert'),
      key: Buffer.from('test-key'),
      ca: Buffer.from('test-ca')
    })
  })

  it('throws a clear error when native HTTPS certificate files are missing', () => {
    expect(() =>
      buildHttpsOptions({
        EDULOG_HTTPS_ENABLED: 'true',
        EDULOG_SSL_CERT_PATH: 'missing-cert.pem',
        EDULOG_SSL_KEY_PATH: 'missing-key.pem'
      })
    ).toThrow('Unable to read EduLog HTTPS certificate at missing-cert.pem')
  })
})
