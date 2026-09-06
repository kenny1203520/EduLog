export type FieldErrors = Record<string, string[]>

export class ValidationError extends Error {
  constructor(message: string, public fields: FieldErrors = {}) {
    super(message)
  }
}

export function parsePagination(params: URLSearchParams, max = 100) {
  const rawLimit = params.get('limit') ?? '50'
  const rawOffset = params.get('offset') ?? '0'
  const limit = Number(rawLimit)
  const offset = Number(rawOffset)
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new ValidationError('limit must be an integer between 1 and 100', { limit: ['integer_between_1_and_100'] })
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ValidationError('offset must be a non-negative integer', { offset: ['non_negative_integer'] })
  }
  return { limit, offset }
}

export function assertUuid(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError(`${field} must be a UUID`, { [field]: ['uuid'] })
  }
  return value
}

export function assertJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Request body must be a JSON object', { body: ['object_required'] })
  }
  return value as Record<string, unknown>
}

export function validateWritableFields(body: Record<string, unknown>, fields: readonly string[]) {
  const unknownFields = Object.keys(body).filter((field) => !fields.includes(field))
  if (unknownFields.length > 0) throw new ValidationError('Request contains unsupported fields', { body: unknownFields.map((field) => `unsupported:${field}`) })
  if (Object.keys(body).length === 0) throw new ValidationError('At least one writable field is required', { body: ['required'] })
  return body
}
