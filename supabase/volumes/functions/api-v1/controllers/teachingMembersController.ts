import { ApiError, audit, parseJson, requirePermission, response } from '../../_shared/api.ts'
import { parsePagination } from '../../_shared/validation.ts'
import { mutationResponse, pickBody } from '../resourceService.ts'
import type { RouteHandler } from './types.ts'

const memberSelect = 'teaching_id,user_id,role_id,status,effective_from,effective_to,created_at,updated_at'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const statuses = ['active', 'suspended', 'removed']

function validateMemberFields(body: Record<string, unknown>, requireUser: boolean) {
  const errors: Record<string, string[]> = {}
  if (requireUser && (typeof body.user_id !== 'string' || !uuidPattern.test(body.user_id))) errors.user_id = ['must be a valid uuid']
  if (body.role_id !== undefined && body.role_id !== null && (typeof body.role_id !== 'string' || !uuidPattern.test(body.role_id))) errors.role_id = ['must be a valid uuid or null']
  if (body.status !== undefined && (typeof body.status !== 'string' || !statuses.includes(body.status))) errors.status = ['must be active, suspended, or removed']
  for (const field of ['effective_from', 'effective_to']) {
    const value = body[field]
    if (value !== undefined && value !== null && (typeof value !== 'string' || !datePattern.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z')))) errors[field] = ['must be a valid date']
  }
  if (typeof body.effective_from === 'string' && typeof body.effective_to === 'string' && body.effective_to < body.effective_from) errors.effective_to = ['must not be before effective_from']
  if (Object.keys(errors).length) throw new ApiError(422, 'VALIDATION_ERROR', 'Teaching member validation failed', errors)
}

async function assertNotOwner(ctx: Parameters<typeof requirePermission>[0], teachingId: string, userId: string) {
  const { data, error } = await ctx.db.from('teachings').select('owner_user_id').eq('id', teachingId).maybeSingle()
  if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to validate teaching owner')
  if (data?.owner_user_id === userId) throw new ApiError(409, 'OWNER_MEMBERSHIP_REQUIRED', 'The teaching owner membership cannot be removed or suspended')
}

export const handleTeachingMemberRoutes: RouteHandler = async ({ ctx, req, url, path, requestId, headers }) => {
  const collectionMatch = path.match(/^\/teachings\/([0-9a-fA-F-]{36})\/members$/)
  const itemMatch = path.match(/^\/teachings\/([0-9a-fA-F-]{36})\/members\/([0-9a-fA-F-]{36})$/)
  if (!collectionMatch && !itemMatch) return null
  const teachingId = (collectionMatch ?? itemMatch)![1]

  if (collectionMatch && req.method === 'GET') {
    await requirePermission(ctx, 'teaching.members.list', null, null, teachingId)
    const { limit, offset } = parsePagination(url.searchParams)
    const [sortField = 'created_at', sortDirection = 'desc'] = (url.searchParams.get('sort') ?? 'created_at:desc').split(':')
    if (!['created_at', 'effective_from', 'status'].includes(sortField) || !['asc', 'desc'].includes(sortDirection)) throw new ApiError(400, 'INVALID_SORT', 'Unsupported teaching member sort')
    let query = ctx.db.from('teaching_members').select(memberSelect, { count: 'exact' }).eq('teaching_id', teachingId).order(sortField, { ascending: sortDirection === 'asc' })
    const status = url.searchParams.get('filter[status]')?.trim()
    if (status && !statuses.includes(status)) throw new ApiError(400, 'INVALID_FILTER', 'Unsupported teaching member status')
    if (status) query = query.eq('status', status)
    const { data, error, count } = await query.range(offset, offset + limit - 1)
    if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load teaching members')
    return response({ data: data ?? [], meta: { limit, offset, total: count ?? 0, sort: `${sortField}:${sortDirection}` }, request_id: requestId }, 200, requestId, headers)
  }

  if (collectionMatch && req.method === 'POST') {
    await requirePermission(ctx, 'teaching.members.manage', null, null, teachingId)
    const body = await parseJson(req) as Record<string, unknown>
    pickBody(body, ['role_id', 'status', 'effective_from', 'effective_to'], ['user_id'])
    validateMemberFields(body, true)
    const userId = body.user_id as string
    const payload = { teaching_id: teachingId, user_id: userId, ...pickBody(body, ['role_id', 'status', 'effective_from', 'effective_to'], ['user_id']) }
    const { data, error } = await ctx.db.from('teaching_members').insert(payload).select(memberSelect).single()
    if (error) throw new ApiError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'MEMBER_EXISTS' : 'DATABASE_ERROR', error.code === '23505' ? 'Teaching member already exists' : 'Unable to add teaching member')
    await audit(ctx, { action: 'create', domain: 'teaching', resource: 'members', resourceId: userId, scopeId: teachingId, outcome: 'success', status: 201 })
    return mutationResponse(ctx, req, 201, { data, meta: null, request_id: requestId }, requestId, headers)
  }

  if (itemMatch) {
    const userId = itemMatch[2]
    if (req.method === 'GET') {
      await requirePermission(ctx, 'teaching.members.read', null, null, teachingId)
      const { data, error } = await ctx.db.from('teaching_members').select(memberSelect).eq('teaching_id', teachingId).eq('user_id', userId).maybeSingle()
      if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load teaching member')
      if (!data) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Teaching member not found')
      return response({ data, meta: null, request_id: requestId }, 200, requestId, headers)
    }
    await requirePermission(ctx, 'teaching.members.manage', null, null, teachingId)
    if (req.method === 'PATCH') {
      const body = await parseJson(req) as Record<string, unknown>
      const payload = pickBody(body, ['role_id', 'status', 'effective_from', 'effective_to'])
      validateMemberFields(body, false)
      if (Object.keys(payload).length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
      if (body.status === 'suspended' || body.status === 'removed') await assertNotOwner(ctx, teachingId, userId)
      const { data, error } = await ctx.db.from('teaching_members').update(payload).eq('teaching_id', teachingId).eq('user_id', userId).select(memberSelect).maybeSingle()
      if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to update teaching member')
      if (!data) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Teaching member not found')
      await audit(ctx, { action: 'update', domain: 'teaching', resource: 'members', resourceId: userId, scopeId: teachingId, outcome: 'success' })
      return mutationResponse(ctx, req, 200, { data, meta: null, request_id: requestId }, requestId, headers)
    }
    if (req.method === 'DELETE') {
      await assertNotOwner(ctx, teachingId, userId)
      const { data, error } = await ctx.db.from('teaching_members').delete().eq('teaching_id', teachingId).eq('user_id', userId).select('user_id').maybeSingle()
      if (error) throw new ApiError(409, 'MEMBER_DELETE_CONFLICT', 'Teaching member could not be deleted')
      if (!data) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Teaching member not found')
      await audit(ctx, { action: 'delete', domain: 'teaching', resource: 'members', resourceId: userId, scopeId: teachingId, outcome: 'success' })
      return mutationResponse(ctx, req, 200, { data: null, meta: null, request_id: requestId }, requestId, headers)
    }
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed for teaching members')
}
