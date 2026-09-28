import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const viewSource = readFileSync(resolve(process.cwd(), 'src/views/SessionDetailsView.vue'), 'utf8')
const commandSource = readFileSync(resolve(process.cwd(), 'src/services/enrollment/EnrollmentCommandService.ts'), 'utf8')

describe('quick make-up enrollment flow contract', () => {
    it('uses the specialized exact-date occurrence query instead of generic filters', () => {
        const start = commandSource.indexOf('static async addEnrollmentToSessionOccurrence(')
        const end = commandSource.indexOf('\n    static async ', start + 1)
        const handler = commandSource.slice(start, end < 0 ? undefined : end)

        expect(handler).toContain('OccurrenceService.getOccurrenceBySessionAndDate(targetSessionId, normalizedTargetDate)')
        expect(handler).not.toContain(".from('class_occurrences')")
    })

    it('refreshes the displayed date roster and summaries after a makeup report is committed', () => {
        expect(viewSource).toContain('await loadWorkspaceRoster(occurrenceDate, true)')
        expect(viewSource).toContain('await loadReportsForCurrentOccurrence({ createMissing: false })')
        expect(viewSource).toContain('loadStudentProgressSummaries(enrollments.value, \'replace\', occurrenceDate)')
    })

    it('keeps the modal open and focuses a localized inline error after submit failure', () => {
        const start = viewSource.indexOf('async function submitAddStudentToClass()')
        const catchStart = viewSource.indexOf('} catch (error: any) {', start)
        const catchEnd = viewSource.indexOf('\n    } finally {', catchStart)
        const catchBody = viewSource.slice(catchStart, catchEnd)

        expect(catchBody).toContain('makeupSubmitError.value = errorMessage')
        expect(catchBody).toContain('makeupSubmitErrorElement.value?.focus()')
        expect(catchBody).not.toContain('closeAddStudentModal()')
        expect(catchBody).not.toContain('toast.error(')
        expect(viewSource).toContain('v-if="makeupSubmitError"')
        expect(viewSource).toContain('role="alert" tabindex="-1"')
    })
})
