import { getRuntimeConfigValue } from '@/lib/runtimeConfig'
import { ApiV1Client, type ApiEnvelope, type ApiRequestOptions } from './ApiV1Client'

export type ApiV1Mode = 'mock' | 'legacy' | 'v1'
export type ApiRequestTransport = Pick<ApiV1Client, 'request'>

export function getApiV1Mode(): ApiV1Mode {
  const configured = getRuntimeConfigValue('VITE_API_V1_MODE')
  return configured === 'legacy' || configured === 'v1' ? configured : 'mock'
}

function mockEnvelope<T>(): ApiEnvelope<T> {
  return { data: null as T, meta: { mode: 'mock' }, request_id: 'mock-request', trace_id: 'mock-trace' }
}

function defaultLegacyClient() {
  const baseUrl = getRuntimeConfigValue('VITE_LEGACY_API_BASE_URL')
  return new ApiV1Client(baseUrl || undefined)
}

export class ApiModeClient {
  private readonly v1: ApiRequestTransport
  private readonly legacy: ApiRequestTransport
  private readonly mock: <T>(path: string, options: ApiRequestOptions) => Promise<ApiEnvelope<T>>

  constructor(
    v1: ApiRequestTransport = new ApiV1Client(),
    legacy: ApiRequestTransport = defaultLegacyClient(),
    mock: <T>(path: string, options: ApiRequestOptions) => Promise<ApiEnvelope<T>> = async () => mockEnvelope(),
  ) {
    this.v1 = v1
    this.legacy = legacy
    this.mock = mock
  }

  request<T>(path: string, options: ApiRequestOptions = {}, mode = getApiV1Mode()) {
    if (mode === 'mock') return this.mock<T>(path, options)
    return (mode === 'legacy' ? this.legacy : this.v1).request<T>(path, options)
  }

  get<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>, mode?: ApiV1Mode) {
    return this.request<T>(path, { ...options, method: 'GET' }, mode)
  }

  post<T>(path: string, body: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }, mode?: ApiV1Mode) {
    return this.request<T>(path, { ...options, method: 'POST', body }, mode)
  }
patch<T>(path: string, body: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }, mode?: ApiV1Mode) {
    return this.request<T>(path, { ...options, method: 'PATCH', body }, mode)
  }

  delete<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }, mode?: ApiV1Mode) {
    return this.request<T>(path, { ...options, method: 'DELETE', body: {} }, mode)
  }
}

export const apiModeClient = new ApiModeClient()
