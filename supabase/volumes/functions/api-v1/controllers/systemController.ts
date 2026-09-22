import { ApiError, audit, parseJson, requirePermission, response } from '../../_shared/api.ts'
import { parsePagination } from '../../_shared/validation.ts'
import { collectionSort, mutationResponse, validateResourceBody } from '../resourceService.ts'
import { resourceDefinitions } from '../resourceRegistry.ts'
import type { RouteHandler } from './types.ts'

const roleSelect = 'id,code,name,description,is_system,sort_order,created_at,updated_at'

export const handleSystemRoutes: RouteHandler = async ({ ctx, req, url, path, requestId, headers }) => {
  if (path === '/permissions' && req.method === 'GET') {
    await requirePermission(ctx, 'system.permissions.read')
    const { limit, offset } = parsePagination(url.searchParams)
    const sort = collectionSort('permissions', url.searchParams.get('sort'))
    let query = ctx.db.from('permissions').select('id,key,name,description,domain,resource,action,conditions,created_at,updated_at', { count: 'exact' }).order(sort.field, { ascending: sort.ascending })
    const search = url.searchParams.get('search')?.trim()
    if (search) query = query.ilike('key', `%${search}%`)
    const domain = url.searchParams.get('filter[domain]')?.trim()
    if (domain) query = query.eq('domain', domain)
    const { data, error, count } = await query.range(offset, offset + limit - 1)
    if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load permissions')
    return response({ data: data ?? [], meta: { limit, offset, total: count ?? 0, sort: url.searchParams.get('sort') ?? 'created_at:desc' }, request_id: requestId }, 200, requestId, headers)
  }

  if (path === '/roles' && req.method === 'GET') {
    await requirePermission(ctx, 'system.roles.manage')
    const { limit, offset } = parsePagination(url.searchParams)
    const sort = collectionSort('roles', url.searchParams.get('sort'))
    let query = ctx.db.from('roles').select(roleSelect, { count: 'exact' }).order(sort.field, { ascending: sort.ascending })
    const search = url.searchParams.get('search')?.trim()
    if (search) query = query.ilike('name', `%${search}%`)
    const { data, error, count } = await query.range(offset, offset + limit - 1)
    if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load roles')
    return response({ data: data ?? [], meta: { limit, offset, total: count ?? 0, sort: url.searchParams.get('sort') ?? 'created_at:desc' }, request_id: requestId }, 200, requestId, headers)
  }

  if (path === '/roles' && req.method === 'POST') {
    await requirePermission(ctx, 'system.roles.manage')
    const body = await parseJson(req) as Record<string, unknown>
    validateResourceBody(resourceDefinitions.roles, body, path === '/roles')
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 120) throw new ApiError(422, 'VALIDATION_ERROR', 'name is required and must be at most 120 characters', { name: ['required'] })
    const { data, error } = await ctx.db.from('roles').insert({ code: typeof body.code === 'string' ? body.code.trim() || null : null, name, description: typeof body.description === 'string' ? body.description.trim() || null : null, is_system: false }).select(roleSelect).single()
    if (error) throw new ApiError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'ROLE_EXISTS' : 'DATABASE_ERROR', error.code === '23505' ? 'Role already exists' : 'Unable to create role')
    await audit(ctx, { action: 'create', domain: 'system', resource: 'roles', resourceId: data?.id, outcome: 'success', status: 201 })
    return mutationResponse(ctx, req, 201, { data, meta: null, request_id: requestId }, requestId, headers)
  }

  const roleMatch = path.match(/^\/roles\/([0-9a-fA-F-]{36})$/)
  if (roleMatch) {
    const roleId = roleMatch[1]
    await requirePermission(ctx, 'system.roles.manage')
    if (req.method === 'GET') {
      const { data, error } = await ctx.db.from('roles').select(roleSelect).eq('id', roleId).maybeSingle()
      if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load role')
      if (!data) throw new ApiError(404, 'ROLE_NOT_FOUND', 'Role not found')
      return response({ data, meta: null, request_id: requestId }, 200, requestId, headers)
    }
    if (req.method === 'PATCH') {
      const body = await parseJson(req) as Record<string, unknown>
      validateResourceBody(resourceDefinitions.roles, body, path === '/roles')
      const payload = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]))
      if (Object.keys(payload).length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
      const { data, error } = await ctx.db.from('roles').update(payload).eq('id', roleId).eq('is_system', false).select(roleSelect).maybeSingle()
      if (error) throw new ApiError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'ROLE_EXISTS' : 'DATABASE_ERROR', error.code === '23505' ? 'Role already exists' : 'Unable to update role')
      if (!data) throw new ApiError(404, 'ROLE_NOT_FOUND', 'Role not found or system role cannot be changed')
      await audit(ctx, { action: 'update', domain: 'system', resource: 'roles', resourceId: roleId, outcome: 'success' })
      return mutationResponse(ctx, req, 200, { data, meta: null, request_id: requestId }, requestId, headers)
    }
    if (req.method === 'DELETE') {
      const { data, error } = await ctx.db.from('roles').delete().eq('id', roleId).eq('is_system', false).select('id').maybeSingle()
      if (error) throw new ApiError(409, 'ROLE_IN_USE', 'Role could not be deleted')
      if (!data) throw new ApiError(404, 'ROLE_NOT_FOUND', 'Role not found or system role cannot be deleted')
      await audit(ctx, { action: 'delete', domain: 'system', resource: 'roles', resourceId: roleId, outcome: 'success' })
      return mutationResponse(ctx, req, 200, { data: null, meta: null, request_id: requestId }, requestId, headers)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed for this resource')
  }

  if (path === '/audit-events' && req.method === 'GET') {
    await requirePermission(ctx, 'system.audit.list')
    const { limit, offset } = parsePagination(url.searchParams)
    const sort = collectionSort('audit-events', url.searchParams.get('sort'))
    let query = ctx.db.from('audit_events').select('id,actor_user_id,action,domain,resource,resource_id,scope_id,request_id,outcome,metadata,created_at', { count: 'exact' }).order(sort.field, { ascending: sort.ascending })
    const search = url.searchParams.get('search')?.trim()
    if (search) query = query.ilike('resource', `%${search}%`)
    for (const field of ['domain', 'resource', 'outcome']) {
      const value = url.searchParams.get(`filter[${field}]`)?.trim()
      if (value) query = query.eq(field, value)
    }
    const { data, error, count } = await query.range(offset, offset + limit - 1)
    if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load audit events')
    return response({ data: data ?? [], meta: { limit, offset, total: count ?? 0, sort: url.searchParams.get('sort') ?? 'created_at:desc' }, request_id: requestId }, 200, requestId, headers)
  }

  return null
}
