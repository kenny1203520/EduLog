export interface SystemRoleAssignmentInterval {
  id: string
  user_id: string
  role_id: string
  effective_from: string
  effective_to: string | null
}

export function hasOverlappingSystemRoleAssignment(
  assignments: SystemRoleAssignmentInterval[],
  userId: string,
  roleId: string,
  effectiveFrom: string,
  effectiveTo: string | null,
  excludeId?: string | null,
) {
  const proposedEnd = effectiveTo ?? '9999-12-31'
  return assignments.some(assignment => assignment.id !== excludeId
    && assignment.user_id === userId
    && assignment.role_id === roleId
    && assignment.effective_from <= proposedEnd
    && (assignment.effective_to ?? '9999-12-31') >= effectiveFrom)
}
