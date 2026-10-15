import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { setAuditContext } from '../../http/context.js'
import { complete, idempotency } from './resourceRouter.js'
import { resources } from './resources.js'
import { authorizeCollection } from '../../auth/authorization.js'

const profileFields = 'id,auth_user_id,profile_version,full_name,nickname,contact_email,phone,government_id,address,mailing_address,birthday,bio,bio_document'
const fieldKeys = ['full_name', 'nickname', 'contact_email', 'phone', 'government_id', 'address', 'mailing_address', 'birthday', 'bio', 'bio_document'] as const
const ownership = z.enum(['account', 'teacher', 'target'])
const choicesSchema = z.object(Object.fromEntries(fieldKeys.map((field) => [field, ownership]))).strict()
const linkChangeSchema = z.object({
  target_auth_user_id: z.string().uuid().nullable(),
  expected_profile_id: z.string().uuid(),
  expected_profile_version: z.number().int().positive(),
  expected_target_profile_id: z.string().uuid().nullable(),
  expected_target_version: z.number().int().positive().nullable(),
  field_ownership: choicesSchema,
}).strict().superRefine((value, context) => {
  if ((value.target_auth_user_id === null) !== (value.expected_target_profile_id === null)
    || (value.target_auth_user_id === null) !== (value.expected_target_version === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expected_target_profile_id'], message: 'Target version and account must be supplied together' })
  }
})

async function requirePermission(req: Request, teacherId: string) {
  if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  setAuditContext(req, { domain: 'teaching', resource: 'teacher-account-link', resourceId: teacherId, action: req.method.toLowerCase(), permission: 'teaching.teachers.update_sensitive' })
  await authorizeCollection(req, resources.teachers, 'teaching.teachers.update_sensitive')
}

function publicProfile(profile: Record<string, unknown> | null) {
  if (!profile) return null
  return Object.fromEntries(['id', 'auth_user_id', 'profile_version', ...fieldKeys].map((key) => [key, profile[key] ?? null]))
}

export function createTeacherAccountLinkRouter() {
  const router = Router()
  router.get('/teachers/:teacherId/account-link', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teacherId = z.string().uuid().parse(req.params.teacherId)
      await requirePermission(req, teacherId)
      const teacher = await req.adminDb!.from('teacher_records').select('id,profile_id').eq('id', teacherId).maybeSingle()
      if (teacher.error) throw mapDatabaseError(teacher.error)
      if (!teacher.data) throw new ApiError(404, 'NOT_FOUND', 'Teacher was not found')
      const currentResult = await req.adminDb!.from('profiles').select(profileFields).eq('id', teacher.data.profile_id).maybeSingle()
      if (currentResult.error) throw mapDatabaseError(currentResult.error)
      let targetProfile: Record<string, unknown> | null = null
      const targetAuthUserId = typeof req.query.target_auth_user_id === 'string' ? z.string().uuid().parse(req.query.target_auth_user_id) : null
      if (targetAuthUserId) {
        await authorizeCollection(req, resources.users, 'system.users.read', { user_id: targetAuthUserId })
        setAuditContext(req, { domain: 'teaching', resource: 'teacher-account-link', resourceId: teacherId, action: 'read', permission: 'teaching.teachers.update_sensitive' })
        const target = await req.adminDb!.from('profiles').select(profileFields).eq('auth_user_id', targetAuthUserId).maybeSingle()
        if (target.error) throw mapDatabaseError(target.error)
        if (!target.data) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'The target account was not found')
        targetProfile = target.data as Record<string, unknown>
      }
      return res.json({ data: { teacher_id: teacherId, current_profile: publicProfile(currentResult.data as Record<string, unknown> | null), target_profile: publicProfile(targetProfile) }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) { next(error) }
  })

  router.patch('/teachers/:teacherId/account-link', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teacherId = z.string().uuid().parse(req.params.teacherId)
      await requirePermission(req, teacherId)
      if (!req.adminDb) throw new ApiError(503, 'PROFILE_SERVICE_UNAVAILABLE', 'The teacher profile service is unavailable')
      const input = linkChangeSchema.parse(req.body)
      const replay = await idempotency(req, 200, null)
      if (replay) return res.status(replay.status).json(replay.body)
      const teacher = await req.adminDb.from('teacher_records').select('id,profile_id').eq('id', teacherId).maybeSingle()
      if (teacher.error) throw mapDatabaseError(teacher.error)
      if (!teacher.data) throw new ApiError(404, 'NOT_FOUND', 'Teacher was not found')
      const current = await req.adminDb.from('profiles').select('id,auth_user_id,profile_version').eq('id', teacher.data.profile_id).maybeSingle()
      if (current.error) throw mapDatabaseError(current.error)
      if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Teacher profile was not found')
      let target: { data: { id: string; profile_version: number } | null; error: { code?: string; message?: string } | null } | null = null
      if (input.target_auth_user_id) {
        await authorizeCollection(req, resources.users, 'system.users.read', { user_id: input.target_auth_user_id })
        setAuditContext(req, { domain: 'teaching', resource: 'teacher-account-link', resourceId: teacherId, action: 'patch', permission: 'teaching.teachers.update_sensitive' })
        target = await req.adminDb.from('profiles').select('id,profile_version').eq('auth_user_id', input.target_auth_user_id).maybeSingle()
      }
      if (target?.error) throw mapDatabaseError(target.error)
      if (target && !target.data) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'The target account was not found')
      if (current.data.id !== input.expected_profile_id || current.data.profile_version !== input.expected_profile_version
        || (target?.data?.id ?? null) !== input.expected_target_profile_id
        || (target?.data?.profile_version ?? null) !== input.expected_target_version) {
        throw new ApiError(409, 'PROFILE_LINK_STALE', 'Profile data changed. Reload and confirm the field choices again.')
      }
      const result = await req.adminDb.rpc('change_teacher_account_link', {
        p_teacher_id: teacherId,
        p_target_auth_user_id: input.target_auth_user_id,
        p_expected_profile_id: input.expected_profile_id,
        p_expected_profile_version: input.expected_profile_version,
        p_expected_target_profile_id: input.expected_target_profile_id,
        p_expected_target_version: input.expected_target_version,
        p_field_ownership: input.field_ownership,
      })
      if (result.error) throw mapDatabaseError(result.error)
      const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
      await complete(req, 200, envelope)
      return res.json(envelope)
    } catch (error) { next(error) }
  })
  return router
}
