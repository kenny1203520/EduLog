import type { ErrorRequestHandler, Request, Response } from 'express'
import { ZodError } from 'zod'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
    public readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function mapDatabaseError(error: { code?: string; message?: string } | null | undefined): ApiError {
  if (!error) return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred')
  if (error.code === '23505') return new ApiError(409, 'RESOURCE_CONFLICT', 'The resource already exists')
  if (error.code === 'PGRST116') return new ApiError(404, 'NOT_FOUND', 'Resource was not found')
  if (error.code === '42501') return new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action')
  if (error.code === '23503') return new ApiError(422, 'INVALID_REFERENCE', 'A referenced resource is invalid')
  if (error.code === '23514') return new ApiError(422, 'BUSINESS_VALIDATION_FAILED', 'The request violates a business rule')
  return new ApiError(500, 'DATABASE_ERROR', 'The request could not be completed')
}

export function sendError(req: Request, res: Response, error: unknown) {
  const apiError = error instanceof ApiError
    ? error
    : (error as { status?: number; type?: string }).status === 413 || (error as { type?: string }).type === 'entity.too.large'
      ? new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request payload is too large')
    : (error as { status?: number; type?: string }).status === 400 && (error as { type?: string }).type === 'entity.parse.failed'
      ? new ApiError(400, 'MALFORMED_JSON', 'The request body is malformed')
    : error instanceof ZodError
      ? new ApiError(422, 'VALIDATION_FAILED', 'The request is invalid', error.issues.reduce<Record<string, string[]>>((fields, issue) => { const key = issue.path.join('.') || 'request'; (fields[key] ??= []).push(issue.message); return fields }, {}))
      : new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred')

  if (!(error instanceof ApiError) && !(error instanceof ZodError)) {
    req.log.error({ error_type: error instanceof Error ? error.name : 'UnknownError', request_id: req.requestId, trace_id: req.traceId }, 'unhandled_api_error')
  }
  if (apiError.status >= 500) {
    req.log.error({ code: apiError.code, request_id: req.requestId, trace_id: req.traceId }, 'api_failure')
  }

  if (apiError.retryAfter) res.setHeader('Retry-After', String(apiError.retryAfter))
  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.fields ? { fields: apiError.fields } : {}),
      request_id: req.requestId,
      trace_id: req.traceId,
    },
  })
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  sendError(req, res, error)
}
