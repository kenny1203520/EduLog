import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { ValidationError, assertJsonObject } from './validation.ts'
import { configureTelemetryExporter, exportTelemetry, OtlpTelemetryExporter } from './telemetry.ts'

export type ApiContext = {
  requestId: string; traceId: string; traceparent?: string; route: string; method: string
  startedAt: number; requestIp: string; user: User; db: SupabaseClient; adminDb: SupabaseClient
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string[]>, public retryAfter?: number) {
    super(message); this.name = 'ApiError'
  }
}

export function traceParent(req: Request) {
  const value = req.headers.get('traceparent')?.trim()
  return value && /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i.test(value) ? value : undefined
}
export function traceId(req: Request) { return traceParent(req)?.split('-')[1] ?? crypto.randomUUID().replaceAll('-', '') }
export function requestId(req: Request) {
  const value = req.headers.get('x-request-id')?.trim()
  return value && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID()
}

export function response(value: unknown, status: number, id: string, headers: HeadersInit = {}) {
  const resultHeaders = new Headers(headers)
  const trace = resultHeaders.get('X-Trace-Id')
  const isEnvelope = value !== null && typeof value === 'object' && !Array.isArray(value) && ('data' in value || 'error' in value || 'request_id' in value)
  let body: unknown = trace && isEnvelope && !('trace_id' in value) ? { ...value, trace_id: trace } : value
  if (isEnvelope && body !== null && typeof body === 'object' && !('error' in body) && !('meta' in body)) body = { ...body, meta: null }
  return new Response(JSON.stringify(body), { status, headers: new Headers({
    'Content-Type': 'application/json', 'X-Request-Id': id, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'", ...headers,
  }) })
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('origin')
  const allowed = Deno.env.get('API_ALLOWED_ORIGINS')?.split(',').map((x) => x.trim()).filter(Boolean) ?? []
  const allowOrigin = origin && (allowed.includes(origin) || (allowed.length === 0 && Deno.env.get('ENVIRONMENT') !== 'production')) ? origin : allowed[0] ?? 'null'
  return { 'Access-Control-Allow-Origin': allowOrigin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-request-id, traceparent, idempotency-key', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', Vary: 'Origin' }
}
function clientIp(req: Request) { return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('cf-connecting-ip') ?? 'unknown' }

export async function authenticate(req: Request, id: string, trace: string, route = new URL(req.url).pathname, startedAt = performance.now()): Promise<ApiContext> {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!url || !serviceRole) throw new ApiError(500, 'CONFIGURATION_ERROR', 'Supabase server configuration is missing')
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const adminDb = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  const userKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  if (!userKey) throw new ApiError(500, 'CONFIGURATION_ERROR', 'Supabase public API key is missing')
  const db = createClient(url, userKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: { headers: { Authorization: 'Bearer ' + token } } })
  const { data, error } = await adminDb.auth.getUser(token)
  if (error || !data.user) throw new ApiError(401, 'AUTH_INVALID', 'The access token is invalid or expired')
  return { requestId: id, traceId: trace, traceparent: traceParent(req), route, method: req.method, startedAt, requestIp: clientIp(req), user: data.user, db, adminDb }
}

export async function requirePermission(ctx: ApiContext, key: string, classroomId?: string | null, sessionId?: string | null) {
  const { data, error } = await ctx.db.rpc('has_api_permission', { p_user_id: ctx.user.id, p_permission_key: key, p_classroom_id: classroomId ?? null, p_class_session_id: sessionId ?? null })
  if (error) throw new ApiError(500, 'AUTHORIZATION_ERROR', 'Unable to evaluate permission')
  if (data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action')
}

export async function audit(ctx: ApiContext, event: { action: string; domain: 'system' | 'teaching'; resource: string; resourceId?: string | null; scopeId?: string | null; outcome: 'success' | 'denied' | 'failure'; status?: number; latencyMs?: number; metadata?: Record<string, unknown> }) {
  const metadata = { user_id: ctx.user.id, teaching_id: event.scopeId ?? null, resource: event.resource, route: ctx.route, method: ctx.method, status: event.status ?? (event.outcome === 'success' ? 200 : event.outcome === 'denied' ? 403 : 500), latency_ms: event.latencyMs ?? Math.max(0, Math.round(performance.now() - ctx.startedAt)), request_id: ctx.requestId, trace_id: ctx.traceId, outcome: event.outcome, ...event.metadata }
  const { error } = await ctx.adminDb.from('audit_events').insert({ actor_user_id: ctx.user.id, action: event.action, domain: event.domain, resource: event.resource, resource_id: event.resourceId ?? null, scope_id: event.scopeId ?? null, request_id: ctx.requestId, outcome: event.outcome, metadata })
  if (error) console.error(JSON.stringify({ type: 'audit_write_failed', request_id: ctx.requestId, trace_id: ctx.traceId, outcome: 'failure', error: error.message }))
}

export interface RateLimitStore { increment(key: string, now: number, windowMs: number): { count: number; resetAt: number } }
class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>()
  increment(key: string, now: number, windowMs: number) { const current = this.buckets.get(key); if (!current || current.resetAt <= now) { const next = { count: 1, resetAt: now + windowMs }; this.buckets.set(key, next); return next }; current.count += 1; return current }
}
let rateLimitStore: RateLimitStore = new MemoryRateLimitStore()
export function configureRateLimitStore(store: RateLimitStore) { rateLimitStore = store }
export function enforceRateLimit(req: Request, route: string) { const now = Date.now(); const limit = Math.max(Number(Deno.env.get('API_RATE_LIMIT_PER_MINUTE') ?? 120), 1); const current = rateLimitStore.increment(clientIp(req) + ':' + route, now, 60_000); if (current.count > limit) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests', undefined, Math.ceil((current.resetAt - now) / 1000)) }

export async function beginIdempotency(ctx: ApiContext, req: Request, route: string) {
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return null
  const key = req.headers.get('idempotency-key')?.trim()
  if (!key || key.length < 8 || key.length > 128) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Mutation requests require an Idempotency-Key between 8 and 128 characters')
  const { data, error } = await ctx.adminDb.rpc('reserve_api_idempotency', { p_user_id: ctx.user.id, p_key: key, p_method: req.method, p_route: route })
  if (error) throw new ApiError(500, 'IDEMPOTENCY_ERROR', 'Unable to reserve idempotency key')
  const row = Array.isArray(data) ? data[0] : data
  if (row?.is_replay && row.response_body) { const body = typeof row.response_body === 'object' && !Array.isArray(row.response_body) ? { ...row.response_body, request_id: ctx.requestId, trace_id: ctx.traceId } : row.response_body; return response(body, row.response_status ?? 200, ctx.requestId, { 'X-Trace-Id': ctx.traceId }) }
  return null
}
export async function completeIdempotency(ctx: ApiContext, req: Request, status: number, body: unknown) { const key = req.headers.get('idempotency-key')?.trim(); if (!key || !['POST', 'PATCH', 'DELETE'].includes(req.method)) return; const { error } = await ctx.adminDb.rpc('complete_api_idempotency', { p_user_id: ctx.user.id, p_key: key, p_status: status, p_body: body }); if (error) console.error(JSON.stringify({ type: 'idempotency_complete_failed', request_id: ctx.requestId, trace_id: ctx.traceId, outcome: 'failure', error: error.message })) }

export async function parseJson(req: Request, maxBytes = 1_000_000) {
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large')
  try { return assertJsonObject(await req.json()) } catch (error) { if (error instanceof ApiError) throw error; if (error instanceof ValidationError) throw new ApiError(400, 'INVALID_JSON_SHAPE', error.message); throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON') }
}
export function handleError(error: unknown, id: string, trace: string) { const known = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'); if (!(error instanceof ApiError)) console.error(JSON.stringify({ type: 'api_error', request_id: id, trace_id: trace, outcome: 'failure', error: error instanceof Error ? error.message : String(error) })); return response({ error: { code: known.code, message: known.message, ...(known.fields ? { fields: known.fields } : {}), request_id: id, trace_id: trace } }, known.status, id, { ...(known.retryAfter ? { 'Retry-After': String(known.retryAfter) } : {}), 'X-Trace-Id': trace }) }

export type TelemetryEvent = { request_id: string; trace_id: string; user_id?: string; teaching_id?: string; resource?: string; route: string; method: string; status?: number; latency_ms: number; outcome: 'success' | 'denied' | 'failure' }
let telemetryConfigured = false
function configureOtlpFromEnvironment() { if (telemetryConfigured) return; telemetryConfigured = true; const endpoints = { log: Deno.env.get('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'), span: Deno.env.get('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'), metric: Deno.env.get('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT') }; if (Object.values(endpoints).some(Boolean)) configureTelemetryExporter(new OtlpTelemetryExporter(endpoints)) }
export async function emitTelemetry(event: TelemetryEvent) { configureOtlpFromEnvironment(); const attributes = Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) as Record<string, string | number | boolean>; console.log(JSON.stringify({ type: 'api_telemetry', ...attributes })); await Promise.all([exportTelemetry({ signal: 'log', name: 'api.request', attributes, timestamp: Date.now() }), exportTelemetry({ signal: 'span', name: 'api.request', attributes, timestamp: Date.now() }), exportTelemetry({ signal: 'metric', name: 'api.request.count', attributes, timestamp: Date.now() })]) }
