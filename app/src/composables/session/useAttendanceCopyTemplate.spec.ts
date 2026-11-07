import { describe, expect, it, vi } from 'vitest'
import type { Enrollment } from '@/models/Enrollment'

const copyTemplateServiceMock = vi.hoisted(() => ({}))
vi.mock('@/services/copy-template/CopyTemplateQueryService', () => ({ CopyTemplateQueryService: copyTemplateServiceMock }))
vi.mock('@/services/copy-template/CopyTemplateCommandService', () => ({ CopyTemplateCommandService: copyTemplateServiceMock }))

import { buildAttendanceListFormatters, formatAttendanceNameList, groupAttendancePreviewNames } from './useAttendanceCopyTemplate'

const t = (key: string) => key
const student = (id: string, studentName: string) => ({ id, studentName }) as Enrollment

describe('attendance copy template helpers', () => {
    it('formats name lists per mode', () => {
        const names = ['Amy', 'Ben']
        expect(formatAttendanceNameList(t, names, 'comma')).toBe('Amy, Ben')
        expect(formatAttendanceNameList(t, names, 'slash')).toBe('Amy / Ben')
        expect(formatAttendanceNameList(t, names, 'newline')).toBe('Amy\nBen')
        expect(formatAttendanceNameList(t, names, 'bullet')).toBe('• Amy\n• Ben')
        expect(formatAttendanceNameList(t, names, 'space')).toBe('Amy Ben')
        expect(formatAttendanceNameList(t, [], 'comma')).toBe('common.none')
    })

    it('groups the roster by attendance, treating missing reports as pending', () => {
        const reports = new Map<string, any>([
            ['a', { attendanceStatus: 'present' }],
            ['b', { attendanceStatus: 'absent' }],
        ])
        const groups = groupAttendancePreviewNames(t, [student('a', 'Amy'), student('b', 'Ben'), student('c', 'Cat'), student('d', '')], reports)
        expect(groups).toEqual({ present_list: ['Amy'], absent_list: ['Ben'], pending_list: ['Cat'] })
    })

    it('shows sample names for an empty roster', () => {
        const groups = groupAttendancePreviewNames(t, [], new Map())
        expect(groups.present_list).toHaveLength(2)
        expect(groups.absent_list).toHaveLength(1)
        expect(groups.pending_list).toEqual(['classroom.pending_list'])
    })

    it('builds a formatter for every list and mode', () => {
        const formatters = buildAttendanceListFormatters(t, { present_list: ['Amy', 'Ben'], absent_list: [], pending_list: ['Cat'] })
        expect(formatters.present_list.slash()).toBe('Amy / Ben')
        expect(formatters.absent_list.comma()).toBe('common.none')
        expect(formatters.pending_list.bullet()).toBe('• Cat')
    })
})
