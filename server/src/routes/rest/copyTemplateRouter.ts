import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { mapDatabaseError } from '../../http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { envelope, permission, uuid, wrap } from './domainAccess.js'

async function putCopyTemplate(req: Request, res: Response) {
  const params = z.object({ templateType: z.string().trim().min(1).max(64), scopeType: z.string().trim().min(1).max(64), scopeEntityId: uuid }).parse(req.params)
  const input = z.object({ template_text: z.string().max(100000).nullable().optional(), template_document: z.record(z.string(), z.unknown()).nullable().optional() }).strict().parse(req.body)
  await permission(req, 'system.users.update')
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.from('copy_templates').upsert({ user_id: req.user!.id, template_type: params.templateType, scope_type: params.scopeType, scope_entity_id: params.scopeEntityId, ...input }, { onConflict: 'user_id,template_type,scope_type,scope_entity_id' }).select('id,user_id,template_type,scope_type,scope_entity_id,template_text,template_document,created_at,updated_at').single()
  if (result.error) throw mapDatabaseError(result.error)
  const body = envelope(req, result.data); await complete(req, 200, body); return res.json(body)
}

export function createCopyTemplateRouter() {
  const router = Router()
  router.put('/copy-templates/:templateType/:scopeType/:scopeEntityId', wrap(putCopyTemplate))
  return router
}
