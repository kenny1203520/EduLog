import { describe, expect, it } from 'vitest'
import { classifyProviderFailure, describeProviderError, providerErrorDetail, providerStatus, redactSecrets } from './providerErrors.js'

function apiCallError(statusCode: number, responseBody: string) {
  return Object.assign(new Error('Provider returned error'), { name: 'AI_APICallError', statusCode, responseBody })
}

describe('providerErrorDetail', () => {
  it('reads the status and the OpenRouter error message, including the upstream raw text', () => {
    const error = apiCallError(429, JSON.stringify({ error: { message: 'Provider returned error', code: 429, metadata: { raw: 'google/gemma:free is temporarily rate-limited upstream' } } }))
    const detail = providerErrorDetail(error)
    expect(detail).toEqual({ status: 429, message: 'Provider returned error (google/gemma:free is temporarily rate-limited upstream)' })
    expect(classifyProviderFailure(detail)).toBe('RATE_LIMITED')
    expect(describeProviderError(detail)).toBe('HTTP 429 – Provider returned error (google/gemma:free is temporarily rate-limited upstream)')
  })

  it('looks through wrapped causes (RetryError → APICallError)', () => {
    const inner = apiCallError(404, JSON.stringify({ error: { message: 'No endpoints found that support the requested output format' } }))
    const wrapped = Object.assign(new Error('Failed after 3 attempts'), { lastError: inner })
    const detail = providerErrorDetail(wrapped)
    expect(detail.status).toBe(404)
    expect(classifyProviderFailure(detail)).toBe('MODEL_UNSUPPORTED')
    expect(providerStatus(new Error('wrapped', { cause: { statusCode: 401 } }))).toBe(401)
  })

  it('recognises structured-output rejections and leaves other errors generic', () => {
    expect(classifyProviderFailure({ status: 400, message: "Invalid parameter: 'response_format' of type 'json_schema' is not supported" })).toBe('MODEL_UNSUPPORTED')
    expect(classifyProviderFailure({ status: 404, message: 'No endpoints found for google/unknown' })).toBe('PROVIDER_ERROR')
    expect(classifyProviderFailure({ status: 500, message: 'response_format failed' })).toBe('PROVIDER_ERROR')
    expect(classifyProviderFailure({ status: 502, message: 'Upstream error' })).toBe('PROVIDER_ERROR')
  })

  it('never keeps keys or bearer tokens and stays short', () => {
    const error = apiCallError(401, JSON.stringify({ error: { message: `Invalid key sk-or-v1-${'a'.repeat(64)} sent as Bearer abc.def.ghi ${'x'.repeat(900)}` } }))
    const detail = providerErrorDetail(error)
    expect(detail.message).not.toMatch(/sk-or|abc\.def/)
    expect(detail.message!.length).toBeLessThanOrEqual(500)
    expect(redactSecrets('token sk-ant-api03-abcdefghijk')).toBe('token [redacted]')
  })

  it('falls back to the error message when there is no response body', () => {
    expect(providerErrorDetail(new Error('fetch failed'))).toEqual({ status: null, message: 'fetch failed' })
  })
})

describe('account and key failures', () => {
  it('recognises OpenRouter data-policy refusals and rejected keys', () => {
    expect(classifyProviderFailure({ status: 404, message: 'No endpoints found matching your data policy (Free model publication)' })).toBe('DATA_POLICY')
    expect(classifyProviderFailure({ status: 401, message: 'User not found.' })).toBe('AUTH_FAILED')
    expect(classifyProviderFailure({ status: 403, message: 'Key disabled' })).toBe('AUTH_FAILED')
  })
})
