export interface CommittedReportIdentity {
    id?: string
    enrollmentId: string
    classOccurrenceId: string
    version: number
}

/** Accept only committed report rows that belong to the active roster scope. */
export function shouldApplyCommittedReport(
    incoming: CommittedReportIdentity,
    current: CommittedReportIdentity | null | undefined,
    enrollmentId: string,
    occurrenceId: string
): boolean {
    if (!incoming.id || incoming.enrollmentId !== enrollmentId || incoming.classOccurrenceId !== occurrenceId) return false
    if (current?.id === incoming.id && current.version > incoming.version) return false
    return true
}
