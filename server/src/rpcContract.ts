/**
 * RPCs that may be reached through the authenticated BFF endpoint.
 * Keep this list deliberately small; application code should use a named
 * REST operation whenever one exists.
 */
export const allowedRpcs = [
  'get_effective_occurrence_enrollment_ids',
  'get_single_lesson_transfer_history',
  'get_effective_single_lesson_transfer_targets',
  'resolve_user_permission',
  'enrollment_history_access',
] as const

export type AllowedRpc = (typeof allowedRpcs)[number]
