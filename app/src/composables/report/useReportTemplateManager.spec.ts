import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const templateApi = vi.hoisted(() => ({ getTemplates: vi.fn(), saveTemplate: vi.fn(), deleteTemplate: vi.fn() }))
const reports = vi.hoisted(() => ({ getReportById: vi.fn() }))
const feedback = vi.hoisted(() => ({ errorKey: vi.fn(), reportError: vi.fn() }))
vi.mock('@/services/report/ReportTemplateService', () => ({ ReportTemplateService: templateApi }))
vi.mock('@/services/report/ReportQueryService', () => ({ ReportQueryService: reports }))
vi.mock('@/services/report/ReportCommandService', () => ({ ReportCommandService: reports }))
vi.mock('vue-i18n', async importOriginal => ({ ...(await importOriginal<typeof import('vue-i18n')>()), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-toastification', () => ({ useToast: () => ({ success: vi.fn() }) }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => feedback }))
vi.mock('@/stores/useAuthStore', () => ({ useAuthStore: () => ({ user: { id: 'teacher' } }) }))

import { createTextEditorContent } from '@/components/text-editor/content'
import { renderReportTemplateText, useReportTemplateManager, type ReportTemplateContext } from './useReportTemplateManager'

const context: ReportTemplateContext = {
    classroom_name: 'Room A', session_name: 'Sat', session_time: '10:00-12:00', student_name: 'Amy',
    course_name: 'Python', lesson: '3', lesson_name: 'Loops', progress: 'A-C', progress_start: 'A',
    progress_end: 'C', is_completed: 'done',
}
const empty = createTextEditorContent('', { templateVariables: true }).richText

describe('report template manager', () => {
    let scope: ReturnType<typeof effectScope>
    const insertRendered = vi.fn()
    const openConfirm = vi.fn()
    let version = 2

    beforeEach(() => {
        vi.resetAllMocks()
        scope = effectScope()
        version = 2
        templateApi.getTemplates.mockResolvedValue([{ id: 't1', name: 'Weekly', content: '{{student_name}} finished {{lesson_name}}' }])
    })
    afterEach(() => scope.stop())

    const setup = () => scope.run(() => useReportTemplateManager({
        context: () => context,
        currentFields: () => ({ content: 'now', contentDocument: empty, contactNotes: '', contactNotesDocument: empty, classNotes: '', classNotesDocument: empty }),
        currentReport: () => ({ reportId: 'report', version }),
        insertRendered,
        openConfirm,
    }))!

    it('renders template variables against the report', () => {
        expect(renderReportTemplateText('{{student_name}} · {{lesson_name}}', context)).toBe('Amy · Loops')
        expect(renderReportTemplateText('  ', context)).toBe('')
    })

    it('opens on the first saved template and previews it', async () => {
        const manager = setup()
        await manager.openReportTemplateManagerModal()
        expect(manager.selectedTemplateId.value).toBe('t1')
        expect(manager.templateDraftName.value).toBe('Weekly')
        expect(manager.reportTemplatePreviewSections.value[2].content).toBe('Amy finished Loops')
    })

    it('starts a new template from the report when none are saved', async () => {
        templateApi.getTemplates.mockResolvedValue([])
        const manager = setup()
        await manager.openReportTemplateManagerModal()
        expect(manager.selectedTemplateId.value).toBe('')
        expect(manager.reportTemplateEditableFields.value[2].content).toBe('now')
    })

    it('applies the rendered draft and closes when the report is current', async () => {
        reports.getReportById.mockResolvedValue({ version: 2 })
        const manager = setup()
        await manager.openReportTemplateManagerModal()
        await manager.applyTemplateDraftToReport()
        expect(insertRendered).toHaveBeenCalledTimes(1)
        const applied = insertRendered.mock.calls[0][0].content.plainText
        expect(applied).toContain('Amy')
        expect(applied).toContain('Loops')
        expect(applied).not.toContain('{{')
        expect(manager.showReportTemplateManagerModal.value).toBe(false)
    })

    it('does not apply over a newer saved version', async () => {
        reports.getReportById.mockResolvedValue({ version: 5 })
        const manager = setup()
        await manager.openReportTemplateManagerModal()
        await manager.applyTemplateDraftToReport()
        expect(feedback.errorKey).toHaveBeenCalledWith('report.editor.restore_conflict_error')
        expect(insertRendered).not.toHaveBeenCalled()
    })

    it('inserts variable tokens at the caret with the selected mode', () => {
        const manager = setup()
        manager.selectedReportTemplateModes.value = { lesson: 'roman' }
        manager.onEditableFieldsUpdate([{ id: 'report', label: '', content: 'Lesson ' }])
        manager.insertReportTemplateVariable('report', 'lesson', 7, 7)
        expect(manager.reportTemplateEditableFields.value[2].content).toBe('Lesson {{lesson|roman}}')
    })

    it('asks before deleting and then drops the template', async () => {
        templateApi.deleteTemplate.mockResolvedValue(undefined)
        const manager = setup()
        await manager.openReportTemplateManagerModal()
        manager.deleteSelectedTemplate()
        expect(openConfirm).toHaveBeenCalled()
        await openConfirm.mock.calls[0][2]()
        expect(templateApi.deleteTemplate).toHaveBeenCalledWith('t1')
        expect(manager.templateOptionsDropdown.value).toHaveLength(1)
    })
})
