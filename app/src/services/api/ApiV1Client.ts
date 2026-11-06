import { getApiMode, getLegacyApiBaseUrl } from '@/lib/runtimeConfig'

export type ApiMeta = Record<string, unknown> | null
export type ApiEnvelope<T> = { data: T; meta?: ApiMeta; request_id: string; trace_id: string }
export type ApiErrorBody = { error: { code: string; message: string; request_id: string; trace_id: string; fields?: Record<string, string[]>; details?: { reason?: string } } }
export class ApiV1Error extends Error {
  readonly code: string; readonly status: number; readonly requestId: string; readonly traceId: string; readonly fields?: Record<string, string[]>; readonly reason?: string
  constructor(status: number, body: ApiErrorBody) { super(body.error.message); this.name = 'ApiV1Error'; this.status = status; this.code = body.error.code; this.requestId = body.error.request_id; this.traceId = body.error.trace_id; this.fields = body.error.fields; this.reason = body.error.details?.reason }
}
/** `changesData: false` marks a POST that changes no page data (e.g. a realtime ticket), so cached reads stay. */
export type ApiRequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; idempotencyKey?: string; changesData?: boolean }
type AuthRecovery = () => Promise<Record<string, unknown> | null>
let authRecovery: AuthRecovery | null = null
let authRecoveryPromise: Promise<Record<string, unknown> | null> | null = null

export function registerApiAuthRecovery(recover: AuthRecovery) {
  authRecovery = recover
}

function isRecoverableAuthError(error: ApiV1Error) {
  return error.status === 401 && ['AUTH_REQUIRED', 'AUTH_INVALID'].includes(error.code)
}

function isAuthEndpoint(path: string) {
  return /^\/auth\/(?:login|logout|refresh)(?:\?|$)/.test(path)
}

function dispatchRequestActivity(event: 'start' | 'end') {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(`edulog:api-request-${event}`))
}

function randomHex(length: number) { const bytes = new Uint8Array(Math.ceil(length / 2)); crypto.getRandomValues(bytes); return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, length) }
export function createRequestId() { return `edulog-${randomHex(24)}` }
export function createTraceparent() { return `00-${randomHex(32)}-${randomHex(16)}-01` }
function readCookie(name: string) { if (typeof document === 'undefined') return ''; const value = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1); return value ? decodeURIComponent(value) : '' }
// Inside the EduLog extension side panel this page is a frame of an extension page. Its requests
// still carry the session cookies, but its scripts cannot read them, so the double-submit token is
// read from /auth/csrf instead; only this origin's scripts can read that response.
let servedCsrfToken = ''
let servedCsrfRequest: Promise<string> | null = null
const isFramed = () => typeof window !== 'undefined' && window.top !== window.self
function serveCsrfToken(baseUrl: string) {
  servedCsrfRequest ??= fetch(`${baseUrl}/auth/csrf`, { credentials: 'include', headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : null)
    .then((body: ApiEnvelope<{ csrf_token?: string }> | null) => { servedCsrfToken = typeof body?.data?.csrf_token === 'string' ? body.data.csrf_token : ''; return servedCsrfToken })
    .catch(() => '')
    .finally(() => { servedCsrfRequest = null })
  return servedCsrfRequest
}
/** CSRF token for requests that cannot go through {@link ApiV1Client.request}, such as streamed responses. */
export async function csrfToken(baseUrl = '/api') {
  const cookie = readCookie('edulog_csrf')
  if (cookie || !isFramed()) return cookie
  return servedCsrfToken || serveCsrfToken(baseUrl.replace(/\/$/, ''))
}

export class ApiV1Client {
  private readonly baseUrl: string; private readonly sameOrigin: boolean
  constructor(baseUrl = '/api') { this.baseUrl = baseUrl.replace(/\/$/, ''); this.sameOrigin = baseUrl.startsWith('/') }
  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.requestAttempt<T>(path, options, true)
  }

  private async requestAttempt<T>(path: string, options: ApiRequestOptions, allowAuthRecovery: boolean, preservedIdempotencyKey?: string, allowCsrfRetry = true): Promise<ApiEnvelope<T>> {
    const method = (options.method ?? 'GET').toUpperCase(); const requestId = createRequestId(); const headers = new Headers(options.headers)
    headers.set('Accept', 'application/json'); headers.set('X-Request-Id', requestId); headers.set('traceparent', createTraceparent())
    if (!this.sameOrigin) throw new ApiV1Error(503, { error: { code: 'EXTERNAL_API_DISABLED', message: 'External browser API access is disabled', request_id: requestId, trace_id: '' } })
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Do not queue or pretend to save private business data while offline.
      throw new Error('Network offline')
    }
    const unsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    const servedToken = unsafe && !readCookie('edulog_csrf') && isFramed()
    headers.set('X-CSRF-Token', unsafe ? await csrfToken(this.baseUrl) : readCookie('edulog_csrf'))
    const idempotencyKey = options.idempotencyKey ?? preservedIdempotencyKey ?? `ui-${randomHex(32)}`
    if (options.body !== undefined) { headers.set('Content-Type', 'application/json'); if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) headers.set('Idempotency-Key', idempotencyKey) }
    dispatchRequestActivity('start')
    try {
      const response = await fetch(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, { ...options, method, credentials: 'include', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        const errorBody = body as ApiErrorBody | null
        if (errorBody?.error) {
          const error = new ApiV1Error(response.status, errorBody)
          // Sign-in and refresh rotate the token; a served copy may be stale, so read it again once.
          if (servedToken && allowCsrfRetry && response.status === 403 && error.code === 'CSRF_INVALID') {
            servedCsrfToken = ''
            return this.requestAttempt<T>(path, options, allowAuthRecovery, idempotencyKey, false)
          }
          if (allowAuthRecovery && !isAuthEndpoint(path) && isRecoverableAuthError(error) && authRecovery) {
            authRecoveryPromise ??= authRecovery().finally(() => { authRecoveryPromise = null })
            const refreshedUser = await authRecoveryPromise
            if (refreshedUser) {
              if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('edulog:auth-session-refreshed', { detail: refreshedUser }))
              return this.requestAttempt<T>(path, options, false, idempotencyKey)
            }
            // /auth/me is also used during initial routing; its caller handles a
            // missing session without racing the router with a global redirect.
            if (!/^\/auth\/me(?:\?|$)/.test(path) && typeof window !== 'undefined') {
              window.dispatchEvent(new Event('edulog:auth-session-expired'))
            }
          }
          if (response.status === 403 && error.code === 'ACCOUNT_DISABLED' && typeof window !== 'undefined') {
            window.dispatchEvent(new Event('edulog:account-disabled'))
          }
          throw error
        }
        throw new Error(`API request failed with status ${response.status}`)
      }
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && options.changesData !== false && typeof window !== 'undefined') {
        // Page data is private to the current session. Notify the in-memory
        // read cache only after a successful mutation; no resource ids or body
        // values are put on the event.
        window.dispatchEvent(new Event('edulog:api-mutation'))
      }
      return body as ApiEnvelope<T>
    } finally {
      dispatchRequestActivity('end')
    }
  }
  get<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) { return this.request<T>(path, { ...options, method: 'GET' }) }
  post<T>(path: string, body: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }) { return this.request<T>(path, { ...options, method: 'POST', body }) }
  put<T>(path: string, body: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }) { return this.request<T>(path, { ...options, method: 'PUT', body }) }
  patch<T>(path: string, body: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }) { return this.request<T>(path, { ...options, method: 'PATCH', body }) }
  delete<T>(path: string, body: unknown = {}, options?: Omit<ApiRequestOptions, 'method' | 'body'> & { idempotencyKey?: string }) { return this.request<T>(path, { ...options, method: 'DELETE', body }) }
}
export const apiV1Client = new ApiV1Client(getApiMode() === 'legacy' ? getLegacyApiBaseUrl() : '/api')
