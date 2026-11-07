import { computed, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { CopyTemplateService, type CopyTemplateLoadOption } from '@/services/copy-template/CopyTemplateService'
import { useFeedback } from '@/composables/useFeedback'
import type { Lesson } from '@/models/Course'
import {
    COURSE_TEMPLATE_VARIABLE_DEFINITIONS,
    SYSTEM_COURSE_TEMPLATE,
    createNumberFormatters,
    formatCopyTemplateToken,
    renderCopyTemplate
} from '@/utils/copyTemplate'
import { copyRichTextToClipboard } from '@/utils/clipboard'
import { formatNumber } from '@/utils/numberFormatting'
import { createTextEditorContent, renderTemplateContent } from '@/components/text-editor/content'

/** Course name and display name joined per the template's list mode. */
export function formatCoursePrimaryName(courseName: string, courseDisplayName: string, mode: string): string {
    const parts = [courseName, courseDisplayName].filter(Boolean)

    if (parts.length === 0) {
        return ''
    }

    switch (mode) {
        case 'slash':
            return parts.join(' / ')
        case 'newline':
            return parts.join('\n')
        case 'bullet':
            return parts.join(' • ')
        default:
            return parts.join(' ')
    }
}

/** The course-copy template's values and per-mode formatters for one lesson. */
export function buildCourseCopyContext(
    courseName: string,
    courseDisplayName: string,
    lesson: Pick<Lesson, 'sequence' | 'title'> | null | undefined,
    lessonLabel: string
) {
    const coursePrimaryName = [courseName, courseDisplayName].filter(Boolean).join(' ').trim() || courseName || courseDisplayName || ''
    return {
        coursePrimaryName,
        values: {
            course_name: courseName,
            course_display_name: courseDisplayName,
            course_primary_name: coursePrimaryName,
            lesson_label: lessonLabel,
            lesson_sequence: lesson?.sequence ?? '',
            lesson_title: lesson?.title || ''
        },
        formatters: {
            course_primary_name: {
                space: () => formatCoursePrimaryName(courseName, courseDisplayName, 'space'),
                slash: () => formatCoursePrimaryName(courseName, courseDisplayName, 'slash'),
                newline: () => formatCoursePrimaryName(courseName, courseDisplayName, 'newline'),
                bullet: () => formatCoursePrimaryName(courseName, courseDisplayName, 'bullet')
            },
            lesson_sequence: createNumberFormatters('lesson_sequence')
        }
    }
}

interface CourseCopyTemplateSource {
    courseName: () => string
    courseDisplayName: () => string
    availableLessons: () => Lesson[]
    selectedLessonId: Ref<string>
}

/** The "copy course info" button and its template editor. */
export function useCourseCopyTemplate(source: CourseCopyTemplateSource) {
    const { t } = useI18n()
    const toast = useToast()
    const { errorKey, reportError } = useFeedback()

    const justCopiedCourse = ref(false)
    const showCourseCopyTemplateModal = ref(false)
    let courseTemplateRequestGeneration = 0
    const courseCopyTemplateText = ref(SYSTEM_COURSE_TEMPLATE)
    const courseCopyTemplateDocument = ref(createTextEditorContent(SYSTEM_COURSE_TEMPLATE, { templateVariables: true }).richText)
    const isLoadingCourseCopyTemplate = ref(false)
    const isSavingCourseCopyTemplate = ref(false)
    const selectedCourseTemplateModes = ref<Record<string, string>>({
        course_primary_name: 'space'
    })
    const courseTemplateLoadOptions = ref<Array<CopyTemplateLoadOption & { displayLabel: string }>>([])
    const selectedCourseTemplateLoadKey = ref('')

    const selectedCoursePreviewLesson = computed(() => {
        const lessons = source.availableLessons()
        return lessons.find(l => l.id === source.selectedLessonId.value) || lessons[0] || null
    })

    const courseTemplateLoadOptionsDropdown = computed(() => courseTemplateLoadOptions.value.map(opt => ({
        label: opt.displayLabel,
        value: opt.key
    })))

    function getSelectedCourseTemplateMode(variable: string): string | undefined {
        return selectedCourseTemplateModes.value[variable] || COURSE_TEMPLATE_VARIABLE_DEFINITIONS.find(item => item.key === variable)?.defaultMode
    }

    const courseTemplateVariables = computed(() => {
        const lesson = selectedCoursePreviewLesson.value
        const courseName = source.courseName() || ''
        const courseDisplayName = source.courseDisplayName() || ''

        return COURSE_TEMPLATE_VARIABLE_DEFINITIONS.map(definition => {
            let previewValue = ''

            switch (definition.key) {
                case 'course_name':
                    previewValue = courseName || 'Course Name'
                    break
                case 'course_display_name':
                    previewValue = courseDisplayName || 'Course Display Name'
                    break
                case 'course_primary_name': {
                    const selectedMode = selectedCourseTemplateModes.value[definition.key] || definition.defaultMode || definition.modes?.[0]?.value || 'space'
                    previewValue = formatCoursePrimaryName(courseName, courseDisplayName, selectedMode)
                    break
                }
                case 'lesson_label':
                    previewValue = t('report.lesson_label')
                    break
                case 'lesson_sequence': {
                    const selectedMode = selectedCourseTemplateModes.value[definition.key] || definition.defaultMode || 'arabic'
                    previewValue = formatNumber(lesson?.sequence, selectedMode) || '1'
                    break
                }
                case 'lesson_title':
                    previewValue = lesson?.title || 'Lesson Title'
                    break
                default:
                    previewValue = definition.key
                    break
            }

            return {
                ...definition,
                token: formatCopyTemplateToken(definition.key, getSelectedCourseTemplateMode(definition.key)),
                label: t(`report.editor.copy_course_template_variable_labels.${definition.key}`),
                description: t(`report.editor.copy_course_template_variable_descriptions.${definition.key}`),
                previewValue,
                modeOptions: (definition.modes || []).map(mode => ({
                    ...mode,
                    label: t(`report.editor.copy_course_template_variable_modes.${mode.value}`)
                }))
            }
        })
    })

    const courseTemplatePreviewText = computed(() => {
        const context = buildCourseCopyContext(
            source.courseName() || '',
            source.courseDisplayName() || '',
            selectedCoursePreviewLesson.value,
            t('report.lesson_label')
        )
        return courseCopyTemplateText.value.trim()
            ? renderCopyTemplate(courseCopyTemplateText.value, context.values, context.formatters).trim()
            : ''
    })

    function copyCourseInfo() {
        const lesson = source.availableLessons().find(l => l.id === source.selectedLessonId.value)
        if (!lesson) return

        const context = buildCourseCopyContext(
            source.courseName() || '',
            source.courseDisplayName() || '',
            lesson,
            t('report.lesson_label')
        )
        const values = { ...context.values, lesson_sequence: lesson.sequence, lesson_title: lesson.title }
        const copyPromise = CopyTemplateService.getEffectiveCourseTemplate()
            .then(({ templateText, templateDocument }) => {
                const rendered = renderTemplateContent(
                    templateDocument || templateText,
                    (key, mode) => renderCopyTemplate(
                        formatCopyTemplateToken(key, mode || undefined),
                        values,
                        context.formatters
                    ),
                    text => renderCopyTemplate(text, values, context.formatters)
                )
                const fallback = `${context.coursePrimaryName} Lesson ${lesson.sequence} ${lesson.title}`.trim()
                return rendered.plainText.trim() ? rendered : createTextEditorContent(fallback)
            })

        copyRichTextToClipboard(copyPromise)
            .then((success) => {
                if (success) {
                    justCopiedCourse.value = true
                    setTimeout(() => { justCopiedCourse.value = false }, 2000)
                } else {
                    errorKey('report.editor.copy_course_template_copy_failed')
                }
            })
            .catch(error => {
                console.error('Failed to copy course info', error)
                reportError(error, 'report.editor.copy_course_template_copy_failed')
            })
    }

    async function openCourseCopyTemplateModal() {
        const requestGeneration = ++courseTemplateRequestGeneration
        showCourseCopyTemplateModal.value = true
        courseCopyTemplateText.value = SYSTEM_COURSE_TEMPLATE
        courseCopyTemplateDocument.value = createTextEditorContent(SYSTEM_COURSE_TEMPLATE, { templateVariables: true }).richText
        selectedCourseTemplateModes.value = {
            course_primary_name: 'space'
        }

        try {
            isLoadingCourseCopyTemplate.value = true
            const bundle = await CopyTemplateService.getEditorBundle('course_copy')
            if (requestGeneration !== courseTemplateRequestGeneration || !showCourseCopyTemplateModal.value) return
            const options = bundle.options
            const template = bundle.current?.templateText || null
            courseTemplateLoadOptions.value = options.map(item => ({
                ...item,
                displayLabel: item.label === 'system_default'
                    ? t('report.editor.copy_course_template_source_system')
                    : item.label === 'user_default'
                        ? t('report.editor.copy_course_template_source_user_default')
                        : item.label
            }))
            selectedCourseTemplateLoadKey.value = courseTemplateLoadOptions.value[0]?.key || ''
            courseCopyTemplateText.value = template || SYSTEM_COURSE_TEMPLATE
            const loaded = courseTemplateLoadOptions.value.find(item => item.scopeType === 'user_default')
            courseCopyTemplateDocument.value = loaded?.templateDocument || createTextEditorContent(courseCopyTemplateText.value, { templateVariables: true }).richText
        } catch (error) {
            console.error('Failed to load course copy template', error)
            reportError(error, 'report.editor.copy_course_template_load_failed')
        } finally {
            if (requestGeneration === courseTemplateRequestGeneration) isLoadingCourseCopyTemplate.value = false
        }
    }

    watch(showCourseCopyTemplateModal, value => { if (!value) courseTemplateRequestGeneration++ })

    function loadSelectedCourseTemplate() {
        const option = courseTemplateLoadOptions.value.find(item => item.key === selectedCourseTemplateLoadKey.value)
        if (!option) {
            return
        }

        courseCopyTemplateText.value = option.templateText || SYSTEM_COURSE_TEMPLATE
        courseCopyTemplateDocument.value = option.templateDocument || createTextEditorContent(courseCopyTemplateText.value, { templateVariables: true }).richText
    }

    async function saveCourseCopyTemplate() {
        const templateText = courseCopyTemplateText.value.trim()
        if (!templateText) {
            errorKey('report.editor.copy_course_template_empty_error')
            return
        }

        try {
            isSavingCourseCopyTemplate.value = true
            await CopyTemplateService.saveCourseTemplateAsUserDefault({ plainText: templateText, richText: courseCopyTemplateDocument.value })
            toast.success(t('report.editor.copy_course_template_saved'))
            showCourseCopyTemplateModal.value = false
        } catch (error) {
            console.error('Failed to save course copy template', error)
            reportError(error, 'report.editor.copy_course_template_save_failed')
        } finally {
            isSavingCourseCopyTemplate.value = false
        }
    }

    return {
        justCopiedCourse,
        showCourseCopyTemplateModal,
        courseCopyTemplateText,
        courseCopyTemplateDocument,
        isLoadingCourseCopyTemplate,
        isSavingCourseCopyTemplate,
        selectedCourseTemplateModes,
        selectedCourseTemplateLoadKey,
        courseTemplateLoadOptionsDropdown,
        courseTemplateVariables,
        courseTemplatePreviewText,
        copyCourseInfo,
        openCourseCopyTemplateModal,
        loadSelectedCourseTemplate,
        saveCourseCopyTemplate,
    }
}
