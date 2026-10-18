/** The only source site whose report identities EduLog imports. */
export const ORANGE_APPLE_ORIGIN = 'https://corp.orangeapple.co'

export interface SourceReportIdentity {
    sourceOrigin?: string | null
    sourceAdmissionId?: string | null
    sourceReportId?: string | null
}

const NUMERIC_ID = /^[0-9]{1,20}$/

/**
 * Builds the source-site report editor URL for an imported report.
 * Returns null unless the origin is the known source site and both IDs are
 * numeric, so stored text can never become an arbitrary link.
 */
export function sourceReportEditUrl(identity: SourceReportIdentity | null | undefined): string | null {
    if (!identity || identity.sourceOrigin !== ORANGE_APPLE_ORIGIN) return null
    const admissionId = identity.sourceAdmissionId?.trim() || ''
    const reportId = identity.sourceReportId?.trim() || ''
    if (!NUMERIC_ID.test(admissionId) || !NUMERIC_ID.test(reportId)) return null
    return `${ORANGE_APPLE_ORIGIN}/dt_admissions/${admissionId}/reports/${reportId}/edit`
}

/** Maps a raw report row (snake_case) to a source identity. */
export function sourceIdentityFromRow(row: {
    source_origin?: string | null
    source_admission_id?: string | null
    source_report_id?: string | null
} | null | undefined): SourceReportIdentity {
    return {
        sourceOrigin: row?.source_origin ?? null,
        sourceAdmissionId: row?.source_admission_id ?? null,
        sourceReportId: row?.source_report_id ?? null,
    }
}
