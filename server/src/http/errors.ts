import type { ErrorRequestHandler, Request, Response } from 'express'
import { ZodError } from 'zod'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
    public readonly retryAfter?: number,
    public readonly diagnosticSource?: 'version_check',
    public readonly details?: { reason?: string },
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Database error code behind an unmapped failure. Logged only, never sent to the client. */
  databaseErrorCode?: string
}

export function mapDatabaseError(error: { code?: string; message?: string } | null | undefined): ApiError {
  if (!error) return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred')
  if (error.code === '23505') return new ApiError(409, 'RESOURCE_CONFLICT', 'The resource already exists')
  if (error.code === 'PGRST116') return new ApiError(404, 'NOT_FOUND', 'Resource was not found')
  if (error.code === '42501') return new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action')
  if (error.code === '23503') return new ApiError(422, 'INVALID_REFERENCE', 'A referenced resource is invalid')
  if (error.code === '23514') return new ApiError(422, 'BUSINESS_VALIDATION_FAILED', 'The request violates a business rule')
  if (error.code === '22P02') return new ApiError(400, 'INVALID_VALUE', 'A request value has an invalid format')
  if (error.code === '57014') return new ApiError(503, 'DATABASE_TIMEOUT', 'The database query timed out', undefined, 1)
  if (error.code === '22007' || error.code === '22008') return new ApiError(422, 'INVALID_DATE_VALUE', 'A date or time value is invalid')
  if (error.code === '22023' && /IDEMPOTENCY_KEY_REUSED/i.test(error.message ?? '')) return new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'The Idempotency-Key is already bound to another request')
  if (error.code === '22023') return new ApiError(422, 'INVALID_ARGUMENT', 'A request argument is invalid')
  if (error.code === 'P0001') {
    const message = error.message ?? ''
    const known: Array<[RegExp, number, string, string]> = [
      [/HOLIDAY_OCCURRENCE/, 422, 'HOLIDAY_OCCURRENCE', 'Attendance cannot be marked present during a holiday'],
      [/TEACHER_ON_LEAVE/, 422, 'TEACHER_ON_LEAVE', 'Attendance cannot be marked present while a teacher is on leave'],
      [/GRANT_EXCEEDS_CALLER/, 403, 'GRANT_EXCEEDS_CALLER', 'You cannot grant access that you do not have yourself'],
      [/OWNER_ROLE_REQUIRED/, 403, 'OWNER_ROLE_REQUIRED', 'Only an owner can assign or remove an owner role'],
      [/PROTECTED_ROLE_PARENT/, 422, 'PROTECTED_ROLE_PARENT', 'A role cannot inherit from an owner role'],
      [/AUTHENTICATION_REQUIRED|Authentication required/i, 401, 'AUTH_REQUIRED', 'Authentication is required'],
      [/PERMISSION_DENIED|FORBIDDEN|_FORBIDDEN|RBAC_MANAGE_REQUIRED/i, 403, 'PERMISSION_DENIED', 'You do not have permission to perform this action'],
      [/NOT_FOUND|NOT_EXIST|NOT_IN_ENROLLMENT/i, 404, 'NOT_FOUND', 'Resource was not found'],
      [/RBAC_VERSION_CONFLICT/i, 409, 'RBAC_VERSION_CONFLICT', 'The permission configuration changed; reload before saving'],
      [/VERSION_CONFLICT/i, 409, 'VERSION_CONFLICT', 'The resource version is stale'],
      [/SYSTEM_ROLE_ASSIGNMENT_OVERLAP/i, 409, 'SYSTEM_ROLE_ASSIGNMENT_OVERLAP', 'The user already has this system role during an overlapping date range'],
      [/CLASSROOM_ROLE_ASSIGNMENT_OVERLAP/i, 409, 'CLASSROOM_ROLE_ASSIGNMENT_OVERLAP', 'The user already has this teaching role in this classroom during an overlapping date range'],
      [/ROLE_IN_USE/i, 409, 'RBAC_ROLE_IN_USE', 'The role is still assigned and cannot be deleted'],
      [/PROTECTED_ROLE|LAST_SYSTEM_OWNER/i, 409, 'RBAC_PROTECTED_RESOURCE', 'The protected RBAC resource cannot be changed'],
      [/SYSTEM_MANAGED_REPORT/i, 422, 'SYSTEM_MANAGED_REPORT', 'Attendance is managed by the system'],
      [/TEACHER_HAS_ACTIVE_ASSIGNMENTS/i, 409, 'TEACHER_HAS_ACTIVE_ASSIGNMENTS', 'Remove the teacher from current and future classes before archiving'],
      [/TEACHER_ARCHIVED/i, 409, 'TEACHER_ARCHIVED', 'An archived teacher cannot be assigned to a class'],
      [/TEACHER_NOT_FOUND/i, 404, 'NOT_FOUND', 'Resource was not found'],
      [/ALREADY_EXISTS|REPORT_ALREADY_EXISTS|SUSPENSION_OVERLAP|OVERLAP|CONFLICT|STALE/i, 409, 'BUSINESS_CONFLICT', 'The request conflicts with the current resource state'],
      [/INVALID_POLICY_SCOPE|INVALID_|MISMATCH|REQUIRED|SOURCE_AND_TARGET|DATE_NOT/i, 422, 'BUSINESS_VALIDATION_FAILED', 'The request violates a business rule'],
    ]
    const match = known.find(([pattern]) => pattern.test(message))
    if (match) return new ApiError(match[1], match[2], match[3])
    return new ApiError(422, 'BUSINESS_VALIDATION_FAILED', 'The request violates a business rule')
  }
  const unmapped = new ApiError(500, 'DATABASE_ERROR', 'The request could not be completed')
  unmapped.databaseErrorCode = typeof error.code === 'string' && /^[A-Za-z0-9]{1,16}$/.test(error.code) ? error.code : 'UNKNOWN'
  return unmapped
}

export function sendError(req: Request, res: Response, error: unknown) {
  const apiError = error instanceof ApiError
    ? error
    : (error as { status?: number; type?: string }).status === 413 || (error as { type?: string }).type === 'entity.too.large'
      ? new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request payload is too large')
    : (error as { status?: number; type?: string }).status === 400 && (error as { type?: string }).type === 'entity.parse.failed'
      ? new ApiError(400, 'MALFORMED_JSON', 'The request body is malformed')
    : error instanceof ZodError
      ? new ApiError(req.method === 'GET' || (req.method === 'DELETE' && Object.keys(req.query ?? {}).length > 0) ? 400 : 422, req.method === 'GET' || (req.method === 'DELETE' && Object.keys(req.query ?? {}).length > 0) ? 'INVALID_QUERY' : 'VALIDATION_FAILED', req.method === 'GET' || (req.method === 'DELETE' && Object.keys(req.query ?? {}).length > 0) ? 'The query is invalid' : 'The request is invalid', error.issues.reduce<Record<string, string[]>>((fields, issue) => { const key = issue.path.join('.') || 'request'; (fields[key] ??= []).push(issue.message); return fields }, {}))
      : new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred')

  req.auditContext = { ...(req.auditContext ?? {}), errorCode: apiError.code }

  if (!(error instanceof ApiError) && !(error instanceof ZodError)) {
    req.log.error({ error_type: error instanceof Error ? error.name : 'UnknownError', request_id: req.requestId, trace_id: req.traceId }, 'unhandled_api_error')
  }
  if (apiError.status >= 500) {
    req.log.error({ code: apiError.code, ...(apiError.databaseErrorCode ? { database_error_code: apiError.databaseErrorCode } : {}), request_id: req.requestId, trace_id: req.traceId }, 'api_failure')
  }

  if (apiError.retryAfter) res.setHeader('Retry-After', String(apiError.retryAfter))
  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.fields ? { fields: apiError.fields } : {}),
      ...(apiError.diagnosticSource ? { diagnostic_source: apiError.diagnosticSource } : {}),
      ...(apiError.details ? { details: apiError.details } : {}),
      request_id: req.requestId,
      trace_id: req.traceId,
    },
  })
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  sendError(req, res, error)
}
