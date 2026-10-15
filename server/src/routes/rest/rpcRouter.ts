import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { allowedRpcs } from './rpcContract.js'

const rpcBody = z.record(z.string(), z.unknown())

// Only business RPCs already covered by RLS/SECURITY DEFINER guards may be
// reached through the BFF. Arbitrary Postgres function execution is forbidden.
const allowedRpcSet = new Set<string>(allowedRpcs)

export function isAllowedRpc(name: string): boolean {
  return allowedRpcSet.has(name)
}

async function invoke(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const name = typeof req.params.name === 'string' ? req.params.name : ''
  if (!isAllowedRpc(name)) throw new ApiError(404, 'NOT_FOUND', 'RPC was not found')
  const input = rpcBody.parse(req.body ?? {})
  const args = name === 'resolve_user_permission' ? { ...input, p_user_id: req.user.id } : input
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const { data, error } = await req.db.rpc(name, args)
  if (error) throw mapDatabaseError(error)
  const body = { data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

export function createRpcRouter() {
  const router = Router()
  router.post('/rpc/:name', wrap(invoke))
  return router
}

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}
