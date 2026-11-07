import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { Enrollment } from '@/models/Enrollment'

const api = vi.hoisted(() => ({ candidates: vi.fn(), add: vi.fn() }))
const feedback = vi.hoisted(() => ({ errorKey: vi.fn(), reportError: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('@/services/enrollment/EnrollmentService', () => ({
    EnrollmentService: { getActiveEnrollmentCandidates: api.candidates, addEnrollmentToSessionOccurrence: api.add },
}))
vi.mock('vue-i18n', async importOriginal => ({ ...(await importOriginal<typeof import('vue-i18n')>()), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-toastification', () => ({ useToast: () => toast }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => feedback }))
vi.mock('@/stores/usePreferencesStore', () => ({ usePreferencesStore: () => ({ timeZone: 'UTC' }) }))

import { buildMakeupStudentOptions, makeupSubmitErrorKey, normalizeDateInput, useMakeupEnrollment } from './useMakeupEnrollment'

const candidate = (id: string, studentId: string, studentName: string, status = 'regular') =>
    ({ id, studentId, studentName, status, courseDisplayName: `Course ${id}` }) as unknown as Enrollment

describe('make-up enrollment helpers', () => {
    it('normalizes date inputs to YYYY-MM-DD', () => {
        expect(normalizeDateInput('2026-11-07', 'UTC')).toBe('2026-11-07')
        expect(normalizeDateInput(new Date(2026, 10, 7), 'UTC')).toBe('2026-11-07')
        expect(normalizeDateInput('not a date', 'UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('lists each matching student once', () => {
        const options = buildMakeupStudentOptions(key => key, [
            candidate('e1', 's1', 'Amy'),
            candidate('e2', 's1', 'Amy'),
            candidate('e3', 's2', 'Ben'),
        ], 'am')
        expect(options).toEqual([
            { label: 'classroom.please_select_student', value: null },
            { label: 'Amy', value: 's1' },
        ])
    })

    it('maps server failures to inline messages', () => {
        expect(makeupSubmitErrorKey(new Error('DUPLICATE_OCCURRENCE_REPORT'))).toBe('classroom.add_student_duplicate_report')
        expect(makeupSubmitErrorKey(new Error('MAKEUP_DATE_NOT_CLASS_DAY'))).toBe('classroom.add_student_not_class_day')
        expect(makeupSubmitErrorKey(new Error('Invalid date format'))).toBe('classroom.add_student_invalid_date')
        expect(makeupSubmitErrorKey(new Error('boom'))).toBe('classroom.add_student_retry_error')
    })
})

describe('make-up enrollment modal', () => {
    let scope: ReturnType<typeof effectScope>
    const refreshRosterForDate = vi.fn()
    const focusSubmitError = vi.fn()
    const selectedDateKey = ref<string | null>('2026-11-07')

    beforeEach(() => {
        vi.resetAllMocks()
        scope = effectScope()
        api.candidates.mockResolvedValue([candidate('e1', 's1', 'Amy'), candidate('e2', 's1', 'Amy', 'trial')])
    })
    afterEach(() => scope.stop())

    const setup = () => scope.run(() => useMakeupEnrollment({
        sessionId: 'session',
        todayOccurrence: ref({ occurrenceDate: new Date(2026, 10, 7) }),
        selectedDateKey,
        refreshRosterForDate,
        focusSubmitError,
    }))!

    async function openAndSelect(enrollmentId = 'e1') {
        const modal = setup()
        await modal.openAddStudentModal()
        modal.selectedMakeupStudentId.value = 's1'
        modal.selectedMakeupEnrollmentId.value = enrollmentId
        return modal
    }

    it('opens with the selected occurrence date and the candidate list', async () => {
        const modal = await openAndSelect()
        expect(modal.showAddStudentModal.value).toBe(true)
        expect(modal.makeupJoinDate.value).toBe('2026-11-07')
        expect(modal.makeupEnrollmentOptions.value).toHaveLength(3)
    })

    it('adds the student, refreshes the displayed date and closes', async () => {
        api.add.mockResolvedValue(undefined)
        const modal = await openAndSelect()
        await modal.submitAddStudentToClass()

        expect(api.add).toHaveBeenCalledWith('e1', 'session', '2026-11-07')
        expect(refreshRosterForDate).toHaveBeenCalledWith('2026-11-07')
        expect(toast.success).toHaveBeenCalledWith('classroom.add_student_success')
        expect(modal.showAddStudentModal.value).toBe(false)
    })

    it('still closes when only the roster refresh fails', async () => {
        api.add.mockResolvedValue(undefined)
        refreshRosterForDate.mockRejectedValue(new Error('offline'))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const modal = await openAndSelect()
        await modal.submitAddStudentToClass()
        expect(modal.showAddStudentModal.value).toBe(false)
    })

    it('keeps the modal open with a focused inline error when the add fails', async () => {
        api.add.mockRejectedValue(new Error('DUPLICATE_OCCURRENCE_REPORT'))
        const modal = await openAndSelect()
        await modal.submitAddStudentToClass()

        expect(modal.showAddStudentModal.value).toBe(true)
        expect(modal.makeupSubmitError.value).toBe('classroom.add_student_duplicate_report')
        expect(focusSubmitError).toHaveBeenCalled()
        expect(modal.isAddingStudent.value).toBe(false)
    })

    it('rejects a non-regular enrollment for a future date', async () => {
        const modal = await openAndSelect('e2')
        modal.makeupJoinDate.value = '2999-01-01'
        await modal.submitAddStudentToClass()
        expect(feedback.errorKey).toHaveBeenCalledWith('classroom.add_student_active_only_for_future')
        expect(api.add).not.toHaveBeenCalled()
    })
})
