import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
// The make-up flow lives in useMakeupEnrollment; the roster refresh it triggers
// lives in useSessionWorkspace; the inline error is rendered by MakeupStudentModal.
const flowSource = read('src/composables/session/useMakeupEnrollment.ts')
const workspaceSource = read('src/composables/session/useSessionWorkspace.ts')
const modalSource = read('src/components/classroom/MakeupStudentModal.vue')
const viewSource = read('src/views/SessionDetailsView.vue')
const commandSource = read('src/services/enrollment/EnrollmentCommandService.ts')

describe('quick make-up enrollment flow contract', () => {
    it('uses the specialized exact-date occurrence query instead of generic filters', () => {
        const start = commandSource.indexOf('static async addEnrollmentToSessionOccurrence(')
        const end = commandSource.indexOf('\n    static async ', start + 1)
        const handler = commandSource.slice(start, end < 0 ? undefined : end)

        expect(handler).toContain('OccurrenceService.getOccurrenceBySessionAndDate(targetSessionId, normalizedTargetDate)')
        expect(handler).not.toContain(".from('class_occurrences')")
    })

    it('refreshes the displayed date roster and summaries after a makeup report is committed', () => {
        expect(flowSource).toContain('await options.refreshRosterForDate(normalizedJoinDate)')
        expect(viewSource).toContain('refreshRosterForDate,')
        const start = workspaceSource.indexOf('async function refreshRosterForDate(')
        const refresh = workspaceSource.slice(start, workspaceSource.indexOf('\n    }\n', start))
        expect(refresh).toContain('await loadWorkspaceRoster(occurrenceDate, true)')
        expect(refresh).toContain('await loadReportsForCurrentOccurrence({ createMissing: false })')
        expect(refresh).toContain('loadStudentProgressSummaries(enrollments.value, \'replace\', occurrenceDate)')
    })

    it('keeps the modal open and focuses a localized inline error after submit failure', () => {
        const start = flowSource.indexOf('async function submitAddStudentToClass()')
        const catchStart = flowSource.indexOf('} catch (error: any) {', start)
        const catchEnd = flowSource.indexOf('} finally {', catchStart)
        const catchBody = flowSource.slice(catchStart, catchEnd)

        expect(catchBody).toContain('makeupSubmitError.value = errorMessage')
        expect(catchBody).toContain('options.focusSubmitError()')
        expect(catchBody).not.toContain('closeAddStudentModal()')
        expect(catchBody).not.toContain('toast.error(')
        expect(viewSource).toContain('focusSubmitError: () => makeupModal.value?.focusSubmitError()')
        expect(modalSource).toContain('makeupSubmitErrorElement.value?.focus()')
        expect(modalSource).toContain('v-if="submitError"')
        expect(modalSource).toContain('role="alert" tabindex="-1"')
    })
})
