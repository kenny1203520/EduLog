import { ApiError, audit, parseJson, requirePermission, response } from '../../_shared/api.ts'
import { parsePagination } from '../../_shared/validation.ts'
import { collectionSort, getResourceDefinition, mutationResponse, permissionResource, pickBody, validateResourceBody } from '../resourceService.ts'
import type { RouteHandler } from './types.ts'

const collectionPattern = /^\/(teachings|classrooms|class_sessions|class-sessions|students|teachers|courses|lessons|enrollments|occurrences|report_templates|report-templates|holidays|reports)$/
const itemPattern = /^\/(teachings|classrooms|class_sessions|class-sessions|students|teachers|courses|lessons|enrollments|occurrences|report_templates|report-templates|holidays|reports)\/([0-9a-fA-F-]{36})$/

function allowedMethods(definition: ReturnType<typeof getResourceDefinition>) {
  return definition.methods ?? (definition.fields.length > 0 ? ['GET', 'POST', 'PATCH', 'DELETE'] : ['GET'])
}

async function requireResourcePermission(
  ctx: Parameters<typeof requirePermission>[0],
  resource: string,
  action: 'create' | 'read' | 'update' | 'delete' | 'list',
  row: Record<string, unknown> = {},
  resourceId?: string,
) {
  const definition = getResourceDefinition(resource)
  const classroomId = definition.table === 'classrooms' ? resourceId : typeof row.classroom_id === 'string' ? row.classroom_id : null
  const sessionId = definition.table === 'class_sessions' ? resourceId : typeof row.class_session_id === 'string' ? row.class_session_id : null
  const teachingId = definition.table === 'teachings'
    ? resourceId
    : typeof row.teaching_id === 'string' ? row.teaching_id : null
  await requirePermission(ctx, `teaching.${permissionResource(resource)}.${action}`, classroomId, sessionId, teachingId)
}

export const handleResourceRoutes: RouteHandler = async ({ ctx, req, url, path, requestId, headers }) => {
  const collectionMatch = path.match(collectionPattern)
  const itemMatch = path.match(itemPattern)
  if (!collectionMatch && !itemMatch) return null
  const resource = (collectionMatch ?? itemMatch)![1]
  const definition = getResourceDefinition(resource)
  if (!allowedMethods(definition).includes(req.method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed for this resource')

  if (collectionMatch && req.method === 'GET') {
    await requireResourcePermission(ctx, resource, 'list')
    const { limit, offset } = parsePagination(url.searchParams)
    const sort = collectionSort(resource, url.searchParams.get('sort'))
    let query = ctx.db.from(definition.table).select(definition.select, { count: 'exact' }).range(offset, offset + limit - 1).order(sort.field, { ascending: sort.ascending })
    const search = url.searchParams.get('search')?.trim()
    if (search && !definition.searchField) throw new ApiError(400, 'INVALID_SEARCH', 'Search is not supported for this resource')
    if (search && definition.searchField) query = query.ilike(definition.searchField, `%${search}%`)
    for (const key of url.searchParams.keys()) {
      const match = key.match(/^filter\[([^\]]+)\]$/)
      if (match && !(definition.filterable ?? []).includes(match[1])) throw new ApiError(400, 'INVALID_FILTER', 'Unsupported filter field')
    }
    for (const field of definition.filterable ?? []) {
      const value = url.searchParams.get(`filter[${field}]`)?.trim()
      if (value) query = query.eq(field, value)
    }
    const { data, error, count } = await query
    if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load resource')
    return response({ data: data ?? [], meta: { limit, offset, total: count ?? 0, sort: url.searchParams.get('sort') ?? 'created_at:desc' }, request_id: requestId }, 200, requestId, headers)
  }

  if (collectionMatch && req.method === 'POST') {
    const body = await parseJson(req) as Record<string, unknown>
    validateResourceBody(definition, body, true)
    await requireResourcePermission(ctx, resource, 'create', body)
    const serverFields = resource === 'teachings'
      ? { owner_user_id: ctx.user.id }
      : definition.table === 'report_templates' ? { instructor_id: ctx.user.id } : definition.table === 'teachers' ? { user_id: ctx.user.id } : {}
    const payload = { ...pickBody(body, definition.fields), ...serverFields }
    const { data, error } = await ctx.db.from(definition.table).insert(payload).select(definition.select).single()
    if (error) throw new ApiError(error.code === '23505' ? 409 : error.code === '42501' ? 403 : 500, error.code === '23505' ? 'RESOURCE_EXISTS' : error.code === '42501' ? 'PERMISSION_DENIED' : 'DATABASE_ERROR', error.code === '23505' ? 'Resource already exists' : error.code === '42501' ? 'You do not have permission to create this resource' : 'Unable to create resource')
    await audit(ctx, { action: 'create', domain: 'teaching', resource, resourceId: (data as { id?: string } | null)?.id, scopeId: (data as { teaching_id?: string } | null)?.teaching_id ?? null, outcome: 'success', status: 201 })
    return mutationResponse(ctx, req, 201, { data, meta: null, request_id: requestId }, requestId, headers)
  }

  if (!itemMatch) return null
  const resourceId = itemMatch[2]
  const { data: existing, error: lookupError } = await ctx.db.from(definition.table).select(definition.select).eq('id', resourceId).maybeSingle()
  if (lookupError) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load resource')
  if (!existing) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found')
  const scope = existing as unknown as Record<string, unknown>

  if (req.method === 'GET') {
    await requireResourcePermission(ctx, resource, 'read', scope, resourceId)
    return response({ data: existing, meta: null, request_id: requestId }, 200, requestId, headers)
  }
  if (req.method === 'PATCH') {
    await requireResourcePermission(ctx, resource, 'update', scope, resourceId)
    const body = await parseJson(req) as Record<string, unknown>
    validateResourceBody(definition, body, false)
    const payload = pickBody(body, definition.fields)
    const { data, error } = await ctx.db.from(definition.table).update(payload).eq('id', resourceId).select(definition.select).maybeSingle()
    if (error) throw new ApiError(error.code === '23505' ? 409 : error.code === '42501' ? 404 : 500, error.code === '23505' ? 'RESOURCE_EXISTS' : error.code === '42501' ? 'RESOURCE_NOT_FOUND' : 'DATABASE_ERROR', error.code === '23505' ? 'Resource conflicts with an existing record' : error.code === '42501' ? 'Resource not found' : 'Unable to update resource')
    if (!data) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found')
    await audit(ctx, { action: 'update', domain: 'teaching', resource, resourceId, scopeId: (data as { teaching_id?: string } | null)?.teaching_id ?? null, outcome: 'success' })
    return mutationResponse(ctx, req, 200, { data, meta: null, request_id: requestId }, requestId, headers)
  }
  if (req.method === 'DELETE') {
    await requireResourcePermission(ctx, resource, 'delete', scope, resourceId)
    const { data, error } = await ctx.db.from(definition.table).delete().eq('id', resourceId).select('id').maybeSingle()
    if (error) throw new ApiError(error.code === '42501' ? 404 : 409, error.code === '42501' ? 'RESOURCE_NOT_FOUND' : 'RESOURCE_DELETE_CONFLICT', error.code === '42501' ? 'Resource not found' : 'Resource could not be deleted')
    if (!data) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found')
    await audit(ctx, { action: 'delete', domain: 'teaching', resource, resourceId, scopeId: typeof scope.teaching_id === 'string' ? scope.teaching_id : null, outcome: 'success' })
    return mutationResponse(ctx, req, 200, { data: null, meta: null, request_id: requestId }, requestId, headers)
  }
  return null
}
