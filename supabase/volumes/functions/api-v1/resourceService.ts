import { ApiError, type ApiContext, completeIdempotency, response } from '../_shared/api.ts'
import { ValidationError, validateWritableFields } from '../_shared/validation.ts'
import { collectionSort as registryCollectionSort, permissionResource, resourceDefinition, type ApiResourceDefinition } from './resourceRegistry.ts'

export function getResourceDefinition(resource: string): ApiResourceDefinition {
  const definition = resourceDefinition(resource)
  if (!definition) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource is not available through this API')
  return definition
}

export function collectionSort(resource: string, raw: string | null) {
  try { return registryCollectionSort(resource, raw) }
  catch { throw new ApiError(400, 'INVALID_SORT', 'Unsupported sort field or direction') }
}

export function validateBody(body: Record<string, unknown>, fields: readonly string[], allowedExtra: readonly string[] = []) {
  try { return validateWritableFields(body, [...fields, ...allowedExtra]) }
  catch (error) {
    if (error instanceof ValidationError) throw new ApiError(422, 'VALIDATION_ERROR', error.message, error.fields)
    throw error
  }
}

export function pickBody(body: Record<string, unknown>, fields: readonly string[], allowedExtra: readonly string[] = []) {
  validateBody(body, fields, allowedExtra)
  const result: Record<string, unknown> = {}
  for (const field of fields) if (Object.prototype.hasOwnProperty.call(body, field)) result[field] = body[field]
  return result
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function validFieldValue(type: NonNullable<ApiResourceDefinition['fieldTypes']>[string], value: unknown) {
  if (value === null) return true
  if (type === 'string') return typeof value === 'string'
  if (type === 'uuid') return typeof value === 'string' && uuidPattern.test(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return typeof value === 'object' && !Array.isArray(value)
  if (type === 'date') return typeof value === 'string' && datePattern.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
  if (type === 'date-time') return typeof value === 'string' && !Number.isNaN(Date.parse(value))
  return false
}

export function validateResourceBody(definition: ApiResourceDefinition, body: Record<string, unknown>, create: boolean) {
  validateBody(body, definition.fields)
  const errors: Record<string, string[]> = {}
  if (Object.keys(body).length === 0) errors.body = ['At least one writable field is required']
  if (create) {
    for (const field of definition.required ?? []) {
      const value = body[field]
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) errors[field] = ['required']
    }
  }
  for (const [field, value] of Object.entries(body)) {
    if (value === null && !(definition.required ?? []).includes(field)) continue
    const type = definition.fieldTypes?.[field]
    if (type && !validFieldValue(type, value)) errors[field] = [`must be a valid ${type}`]
  }
  if (Object.keys(errors).length > 0) throw new ApiError(422, 'VALIDATION_ERROR', 'Request body validation failed', errors)
}

export async function mutationResponse(ctx: ApiContext, req: Request, status: number, payload: unknown, id: string, headers: HeadersInit) {
  await completeIdempotency(ctx, req, status, payload)
  return response(payload, status, id, headers)
}

export { permissionResource }
