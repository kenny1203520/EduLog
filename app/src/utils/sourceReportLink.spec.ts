import { describe, expect, it } from 'vitest'
import { ORANGE_APPLE_ORIGIN, sourceIdentityFromRow, sourceReportEditUrl } from './sourceReportLink'

describe('sourceReportEditUrl', () => {
    it('builds the source report editor URL for a known origin', () => {
        expect(sourceReportEditUrl({ sourceOrigin: ORANGE_APPLE_ORIGIN, sourceAdmissionId: '123', sourceReportId: ' 456 ' }))
            .toBe('https://corp.orangeapple.co/dt_admissions/123/reports/456/edit')
    })

    it.each([
        ['missing identity', null],
        ['no source origin', { sourceOrigin: null, sourceAdmissionId: '1', sourceReportId: '2' }],
        ['unknown origin', { sourceOrigin: 'https://evil.example', sourceAdmissionId: '1', sourceReportId: '2' }],
        ['origin with path', { sourceOrigin: 'https://corp.orangeapple.co/x', sourceAdmissionId: '1', sourceReportId: '2' }],
        ['missing report id', { sourceOrigin: ORANGE_APPLE_ORIGIN, sourceAdmissionId: '1', sourceReportId: null }],
        ['non-numeric admission id', { sourceOrigin: ORANGE_APPLE_ORIGIN, sourceAdmissionId: '../1', sourceReportId: '2' }],
        ['non-numeric report id', { sourceOrigin: ORANGE_APPLE_ORIGIN, sourceAdmissionId: '1', sourceReportId: '2?x=1' }],
    ])('returns null for %s', (_label, identity) => {
        expect(sourceReportEditUrl(identity)).toBeNull()
    })

    it('maps snake_case report rows', () => {
        expect(sourceIdentityFromRow({ source_origin: ORANGE_APPLE_ORIGIN, source_admission_id: '7', source_report_id: '8' }))
            .toEqual({ sourceOrigin: ORANGE_APPLE_ORIGIN, sourceAdmissionId: '7', sourceReportId: '8' })
        expect(sourceIdentityFromRow(undefined)).toEqual({ sourceOrigin: null, sourceAdmissionId: null, sourceReportId: null })
    })
})
