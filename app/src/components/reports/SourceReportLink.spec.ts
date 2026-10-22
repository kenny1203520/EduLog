import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SourceReportLink from './SourceReportLink.vue'
import { OccurrenceReport } from '@/models/OccurrenceReport'

const global = { mocks: { $t: (key: string) => key } }

describe('SourceReportLink', () => {
    it('opens the source report editor in a new tab for an imported report', () => {
        const report = new OccurrenceReport({
            enrollment_id: 'e1', class_occurrence_id: 'o1', content: '', version: 1,
            source_origin: 'https://corp.orangeapple.co', source_admission_id: '123', source_report_id: '456',
        })
        const link = mount(SourceReportLink, { props: { identity: report }, global }).get('a')
        expect(link.attributes('href')).toBe('https://corp.orangeapple.co/dt_admissions/123/reports/456/edit')
        expect(link.attributes('target')).toBe('_blank')
        expect(link.attributes('rel')).toBe('noopener noreferrer')
        expect(link.text()).toContain('report.editor.open_source_report')
    })

    it('renders nothing for a report without a source identity', () => {
        const report = new OccurrenceReport({ enrollment_id: 'e1', class_occurrence_id: 'o1', content: '', version: 1 })
        expect(mount(SourceReportLink, { props: { identity: report }, global }).find('a').exists()).toBe(false)
        expect(mount(SourceReportLink, { props: { identity: null }, global }).find('a').exists()).toBe(false)
    })

    it('renders nothing when the origin is not the known source site', () => {
        const identity = { sourceOrigin: 'https://evil.example', sourceAdmissionId: '1', sourceReportId: '2' }
        expect(mount(SourceReportLink, { props: { identity }, global }).find('a').exists()).toBe(false)
    })
})
