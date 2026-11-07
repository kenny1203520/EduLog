import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { Lesson } from '@/models/Course'

const templates = vi.hoisted(() => ({ getEditorBundle: vi.fn(), saveCourseTemplateAsUserDefault: vi.fn(), getEffectiveCourseTemplate: vi.fn() }))
const feedback = vi.hoisted(() => ({ errorKey: vi.fn(), reportError: vi.fn() }))
vi.mock('@/services/copy-template/CopyTemplateQueryService', () => ({ CopyTemplateQueryService: templates }))
vi.mock('@/services/copy-template/CopyTemplateCommandService', () => ({ CopyTemplateCommandService: templates }))
vi.mock('vue-i18n', async importOriginal => ({ ...(await importOriginal<typeof import('vue-i18n')>()), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-toastification', () => ({ useToast: () => ({ success: vi.fn() }) }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => feedback }))

import { buildCourseCopyContext, formatCoursePrimaryName, useCourseCopyTemplate } from './useCourseCopyTemplate'

describe('course copy template', () => {
    it('joins course names per mode', () => {
        expect(formatCoursePrimaryName('Python', 'Level 1', 'slash')).toBe('Python / Level 1')
        expect(formatCoursePrimaryName('Python', 'Level 1', 'bullet')).toBe('Python • Level 1')
        expect(formatCoursePrimaryName('Python', '', 'newline')).toBe('Python')
        expect(formatCoursePrimaryName('', '', 'space')).toBe('')
    })

    it('builds the template values for a lesson', () => {
        const context = buildCourseCopyContext('Python', 'Level 1', { sequence: 3, title: 'Loops' }, 'Lesson')
        expect(context.coursePrimaryName).toBe('Python Level 1')
        expect(context.values).toMatchObject({ lesson_sequence: 3, lesson_title: 'Loops', lesson_label: 'Lesson' })
        expect(context.formatters.course_primary_name.slash()).toBe('Python / Level 1')
    })

    describe('editor modal', () => {
        let scope: ReturnType<typeof effectScope>
        const lessons = [{ id: 'l1', sequence: 1, title: 'Intro' }, { id: 'l2', sequence: 2, title: 'Loops' }] as Lesson[]
        beforeEach(() => { vi.resetAllMocks(); scope = effectScope() })
        afterEach(() => scope.stop())
        const setup = () => scope.run(() => useCourseCopyTemplate({
            courseName: () => 'Python',
            courseDisplayName: () => 'Level 1',
            availableLessons: () => lessons,
            selectedLessonId: ref('l2'),
        }))!

        it('loads the saved user template and labels the sources', async () => {
            templates.getEditorBundle.mockResolvedValue({
                current: { templateText: '{{course_name}} {{lesson_title}}' },
                options: [{ key: 'system', label: 'system_default', templateText: 'x' }, { key: 'user', label: 'user_default', scopeType: 'user_default', templateText: '{{course_name}} {{lesson_title}}' }],
            })
            const state = setup()
            await state.openCourseCopyTemplateModal()
            expect(state.courseTemplateLoadOptionsDropdown.value.map(option => option.label)).toEqual([
                'report.editor.copy_course_template_source_system',
                'report.editor.copy_course_template_source_user_default',
            ])
            expect(state.courseTemplatePreviewText.value).toBe('Python Loops')
            expect(state.isLoadingCourseCopyTemplate.value).toBe(false)
        })

        it('refuses to save an empty template', async () => {
            const state = setup()
            state.courseCopyTemplateText.value = '   '
            await state.saveCourseCopyTemplate()
            expect(feedback.errorKey).toHaveBeenCalledWith('report.editor.copy_course_template_empty_error')
            expect(templates.saveCourseTemplateAsUserDefault).not.toHaveBeenCalled()
        })
    })
})
