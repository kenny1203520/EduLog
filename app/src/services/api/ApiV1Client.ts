import { getRuntimeConfigValue } from '@/lib/runtimeConfig'

export type ApiMeta = Record<string, unknown> | null
export type ApiEnvelope<T> = { data: T; meta?: ApiMeta; request_id: string; trace_id: string }
export type ApiErrorBody = { error: { code: string; message: string; request_id: string; trace_id: string; fields?: Record<string, string[]> } }
export class ApiV1Error extends Error {
  readonly code: string; readonly status: number; readonly requestId: string; readonly traceId: string; readonly fields?: Record<string, string[]>
  constructor(status: number, body: ApiErrorBody) { super(body.error.message); this.name = 'ApiV1Error'; this.status = status; this.code = body.error.code; this.requestId = body.error.request_id; this.traceId = body.error.trace_id; this.fields = body.error.fields }
}
export type ApiRequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; idempotencyKey?: string }
function randomHex(length: number) { const bytes = new Uint8Array(Math.ceil(length / 2)); crypto.getRandomValues(bytes); return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, length) }
export function createRequestId() { return `edulog-${randomHex(24)}` }
export function createTraceparent() { return `00-${randomHex(32)}-${randomHex(16)}-01` }
function legacyBaseUrl() { return getRuntimeConfigValue('VITE_LEGACY_API_BASE_URL') || '/api' }
function readCookie(name: string) { if (typeof document === 'undefined') return ''; const value = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1); return value ? decodeURIComponent(value) : '' }

export class ApiV1Client {
  private readonly baseUrl: string; private readonly sameOrigin: boolean
  constructor(baseUrl = '/api') { this.baseUrl = baseUrl.replace(/\/$/, ''); this.sameOrigin = baseUrl.startsWith('/') }
  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiEnvelope<T>> {
    const method = (options.method ?? 'GET').toUpperCase(); const requestId = createRequestId(); const headers = new Headers(options.headers)
    headers.set('Accept', 'application/json'); headers.set('X-Request-Id', requestId); headers.set('traceparent', createTraceparent())
    if (!this.sameOrigin) throw new ApiV1Error(503, { error: { code: 'EXTERNAL_API_DISABLED', message: 'External browser API access is disabled', request_id: requestId, trace_id: '' } })
    headers.set('X-CSRF-Token', readCookie('edulog_csrf'))
    if (options.body !== undefined) { headers.set('Content-Type', 'application/json'); if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) headers.set('Idempotency-Key', options.idempotencyKey ?? `ui-${randomHex(32)}`) }
    const response = await fetch(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, { ...options, method, credentials: 'include', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) })
    const body = await response.json().catch(() => null)
    if (!response.ok) { const errorBody = body as ApiErrorBody | null; if (errorBody?.error) throw new ApiV1Error(response.status, errorBody); throw new Error(`API request failed with status ${response.status}`) }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && typeof window !== 'undefined') {
      // Page data is private to the current session.  Notify the in-memory
      // read cache only after a successful mutation; no resource ids or body
      // values are put on the event.
      window.dispatchEvent(new Event('edulog:api-mutation'))
    }
    return body as ApiEnvelope<T>
  }
  get<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) { return this.request<T>(path, { ...options, method: 'GET' }) }
  post<T>(path: string, body: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }) { return this.request<T>(path, { ...options, method: 'POST', body }) }
  put<T>(path: string, body: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }) { return this.request<T>(path, { ...options, method: 'PUT', body }) }
  patch<T>(path: string, body: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }) { return this.request<T>(path, { ...options, method: 'PATCH', body }) }
  delete<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }) { return this.request<T>(path, { ...options, method: 'DELETE', body: {} }) }
}
export const apiV1Client = new ApiV1Client(getRuntimeConfigValue('VITE_API_V1_MODE') === 'legacy' ? legacyBaseUrl() : '/api')
