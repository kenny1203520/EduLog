import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { envelope, permission, uuid, wrap } from './domainAccess.js'

const templateScope = z.discriminatedUnion('scopeType', [
  z.object({
    templateType: z.enum(['attendance_copy', 'course_copy']),
    scopeType: z.literal('user_default'),
    scopeEntityId: z.literal('user_default'),
  }),
  z.object({
    templateType: z.literal('attendance_copy'),
    scopeType: z.literal('class_session'),
    scopeEntityId: uuid,
  }),
])

export async function authorizeCopyTemplateScope(req: Request, scope: unknown) {
  const params = templateScope.parse(scope)
  if (params.scopeType === 'class_session') {
    await permission(req, 'teaching.class_sessions.read', params.scopeEntityId)
  }
}

async function putCopyTemplate(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const params = templateScope.parse(req.params)
  const input = z.object({
    template_text: z.string().max(100000).nullable().optional(),
    template_document: z.record(z.string(), z.unknown()).nullable().optional(),
    template_type: z.literal(params.templateType).optional(),
    scope_type: z.literal(params.scopeType).optional(),
    scope_entity_id: z.literal(params.scopeEntityId).optional(),
  }).strict().parse(req.body)
  await authorizeCopyTemplateScope(req, params)
  const result = await req.db.from('copy_templates').upsert({
    user_id: req.user.id,
    template_type: params.templateType,
    scope_type: params.scopeType,
    scope_entity_id: params.scopeEntityId,
    template_text: input.template_text,
    template_document: input.template_document,
  }, { onConflict: 'user_id,template_type,scope_type,scope_entity_id' })
    .select('id,user_id,template_type,scope_type,scope_entity_id,template_text,template_document,created_at,updated_at').single()
  if (result.error) throw mapDatabaseError(result.error)
  return res.json(envelope(req, result.data))
}

export function createCopyTemplateRouter() {
  const router = Router()
  router.put('/copy-templates/:templateType/:scopeType/:scopeEntityId', wrap(putCopyTemplate))
  return router
}
