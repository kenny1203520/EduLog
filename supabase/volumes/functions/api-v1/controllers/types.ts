import type { ApiContext } from '../../_shared/api.ts'

export type RouteInput = {
  ctx: ApiContext
  req: Request
  url: URL
  path: string
  requestId: string
  headers: HeadersInit
}

export type RouteHandler = (input: RouteInput) => Promise<Response | null>
