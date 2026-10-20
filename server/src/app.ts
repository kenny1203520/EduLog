import express, { Router } from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import pino from 'pino'
import { loadConfig } from './config/config.js'
import { requestContext } from './http/context.js'
import { errorHandler, ApiError } from './http/errors.js'
import { createSupabaseClients } from './infra/supabase.js'
import { createAuthRouter, csrfProtection, requireAuth } from './auth/auth.js'
import { createResourceRouter } from './routes/rest/resourceRouter.js'
import { createRpcRouter } from './routes/rest/rpcRouter.js'
import { rateLimitMiddleware } from './http/rateLimit.js'
import { buildOpenApi } from './openapi/openapi.js'
import { createUserSearchRouter } from './routes/rest/userSearch.js'
import { createRbacRouter } from './routes/rest/rbacRouter.js'
import { createEnrollmentRouter } from './routes/rest/enrollmentRouter.js'
import { createReportRouter } from './routes/rest/reportRouter.js'
import { createOccurrenceRouter } from './routes/rest/occurrenceRouter.js'
import { createSessionRouter } from './routes/rest/sessionRouter.js'
import { createStudentRouter } from './routes/rest/studentRouter.js'
import { createTransferRouter } from './routes/rest/transferRouter.js'
import { createSyncRouter } from './routes/rest/syncRouter.js'
import { createSuspensionRouter } from './routes/rest/suspensionRouter.js'
import { createHolidayRouter } from './routes/rest/holidayRouter.js'
import { createAggregateRouter } from './routes/pages/aggregateRouter.js'
import { createTeacherAssignmentRouter } from './routes/rest/teacherAssignmentRouter.js'
import { createTeacherAccountLinkRouter } from './routes/rest/teacherAccountLinkRouter.js'
import { createDomainRouter } from './routes/rest/domainRouter.js'
import { createExtensionIntegrationRouter } from './routes/extension/extensionIntegrationRouter.js'
import { createAiReportAssistRouter, defaultAiReportAssistDeps } from './routes/rest/aiReportAssistRouter.js'
import { createAiMeRouter } from './routes/rest/aiMeRouter.js'
import { createAiAdminRouter } from './routes/rest/aiAdminRouter.js'
import { createAiDeidRouter } from './routes/rest/aiDeidRouter.js'

const LOCAL_DEVELOPMENT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']

export function resolveAllowedOrigins(config: Pick<ReturnType<typeof loadConfig>, 'API_ALLOWED_ORIGINS' | 'API_EXTENSION_ALLOWED_ORIGINS' | 'NODE_ENV'>) {
  const configuredOrigins = config.API_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  const extensionOrigins = config.API_EXTENSION_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  if (extensionOrigins.some((origin) => !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) {
    throw new Error('API_EXTENSION_ALLOWED_ORIGINS must contain exact Chrome extension origins')
  }
  if (configuredOrigins.length) {
    if (configuredOrigins.includes('*')) throw new Error('API_ALLOWED_ORIGINS cannot contain wildcard origins')
    if (configuredOrigins.some((origin) => origin.includes('*'))) throw new Error('API_ALLOWED_ORIGINS must contain exact origins')
    return [...new Set([...configuredOrigins, ...extensionOrigins])]
  }
  if (config.NODE_ENV === 'production') throw new Error('Production requires explicit API_ALLOWED_ORIGINS')
  return [...new Set([...LOCAL_DEVELOPMENT_ORIGINS, ...extensionOrigins])]
}

export function createApp(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env)
  const logger = pino({ level: config.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization', 'access_token', 'refresh_token', 'password', 'cookie', '*.token', '*.secret'] })
  const clients = createSupabaseClients(config)
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(cookieParser())
  app.use(requestContext(logger))
  // Authenticated responses must not enter a browser, proxy, or CDN shared
  // cache.  The frontend Page API cache is a short-lived in-memory cache per
  // signed-in tab and never changes this HTTP boundary.
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next() })
  app.use(express.json({ limit: config.API_BODY_LIMIT, strict: true }))
  app.use((req, res, next) => {
    const allowedOrigins = resolveAllowedOrigins(config)
    const origin = req.header('origin')
    if (origin && !allowedOrigins.includes(origin)) return next(new ApiError(403, 'ORIGIN_FORBIDDEN', 'Origin is not allowed'))
    res.setHeader('Vary', 'Origin')
    if (origin && allowedOrigins.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true') }
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRF-Token, X-Request-Id, traceparent, Idempotency-Key'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS'); return res.status(204).end() }
    next()
  })
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }))
  app.get('/api/healthz', (_req, res) => res.json({ data: { status: 'ok' }, meta: {}, request_id: _req.requestId, trace_id: _req.traceId }))
  app.get('/api/openapi.json', (_req, res) => res.json(buildOpenApi()))
  app.use('/api/auth', csrfProtection, rateLimitMiddleware(config, clients.adminClient), createAuthRouter(clients, config))
  app.use('/api/extension', rateLimitMiddleware(config, clients.adminClient), createExtensionIntegrationRouter(clients, config))
  app.use('/api/users', csrfProtection, requireAuth(clients, config), rateLimitMiddleware(config, clients.adminClient), createUserSearchRouter())
  const protectedApi = Router()
  protectedApi.use(csrfProtection, requireAuth(clients, config), rateLimitMiddleware(config, clients.adminClient))
  protectedApi.use(createRbacRouter())
  protectedApi.use(createEnrollmentRouter())
  protectedApi.use(createReportRouter())
  protectedApi.use(createAiReportAssistRouter(defaultAiReportAssistDeps(config)))
  protectedApi.use(createAiMeRouter(config))
  protectedApi.use(createAiAdminRouter(config))
  protectedApi.use(createAiDeidRouter(config))
  protectedApi.use(createOccurrenceRouter())
  protectedApi.use(createTransferRouter())
  protectedApi.use(createSyncRouter())
  protectedApi.use(createSuspensionRouter())
  protectedApi.use(createHolidayRouter())
  protectedApi.use(createAggregateRouter())
  protectedApi.use(createTeacherAssignmentRouter())
  protectedApi.use(createTeacherAccountLinkRouter())
  protectedApi.use(createSessionRouter())
  protectedApi.use(createStudentRouter())
  // Domain routes must precede the generic registry so page/workflow commands
  // retain their explicit validation, scope resolution, and idempotency rules.
  protectedApi.use(createDomainRouter())
  protectedApi.use(createRpcRouter())
  protectedApi.use(createResourceRouter())
  app.use('/api', protectedApi)
  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Route was not found')))
  app.use(errorHandler)
  return app
}




