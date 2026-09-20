import type { Request, Response } from 'express'
import { measureRequestPhaseSync } from './context.js'

export function sendData<T>(req: Request, res: Response, data: T, meta: Record<string, unknown> = {}) {
  return measureRequestPhaseSync(req, 'serialization', () => res.json({ data, meta, request_id: req.requestId, trace_id: req.traceId }))
}

export function sendCreated<T>(req: Request, res: Response, data: T, meta: Record<string, unknown> = {}) {
  return measureRequestPhaseSync(req, 'serialization', () => res.status(201).json({ data, meta, request_id: req.requestId, trace_id: req.traceId }))
}
