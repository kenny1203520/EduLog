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

export async function mutationResponse(ctx: ApiContext, req: Request, status: number, payload: unknown, id: string, headers: HeadersInit) {
  await completeIdempotency(ctx, req, status, payload)
  return response(payload, status, id, headers)
}

export { permissionResource }
