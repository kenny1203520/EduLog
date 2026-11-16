import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import type { Lesson } from '@/models/Course'
import {
    COURSE_TEMPLATE_VARIABLE_DEFINITIONS,
    SYSTEM_COURSE_TEMPLATE,
    createNumberFormatters,
    formatCopyTemplateToken,
    renderCopyTemplate
} from '@/utils/copyTemplate'
import { useCopyTemplateClipboard } from '@/composables/useCopyTemplateClipboard'
import { formatNumber } from '@/utils/numberFormatting'
import { createTextEditorContent } from '@/components/text-editor/content'
import { CopyTemplateCommandService } from '@/services/copy-template/CopyTemplateCommandService'
import { CopyTemplateQueryService, type CopyTemplateLoadOption } from '@/services/copy-template/CopyTemplateQueryService'

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
    selection: () => {
        courseName: string
        courseDisplayName: string
        lesson: Pick<Lesson, 'sequence' | 'title'>
    }[]
    reportKey: () => string | undefined
}

/** The "copy course info" button and its template editor. */
export function useCourseCopyTemplate(source: CourseCopyTemplateSource) {
    const { t } = useI18n()
    const toast = useToast()
    const { errorKey, reportError } = useFeedback()

    const justCopiedCourse = ref(false)
    let copiedTimer: ReturnType<typeof setTimeout> | undefined
    onScopeDispose(() => clearTimeout(copiedTimer))
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

    const clipboard = useCopyTemplateClipboard(
        source.reportKey,
        () => CopyTemplateQueryService.getEffectiveCourseTemplate(),
        SYSTEM_COURSE_TEMPLATE
    )
    watch(source.selection, () => {
        clipboard.resetCopy()
        justCopiedCourse.value = false
    })

    const courseTemplateLoadOptionsDropdown = computed(() => courseTemplateLoadOptions.value.map(opt => ({
        label: opt.displayLabel,
        value: opt.key
    })))

    function getSelectedCourseTemplateMode(variable: string): string | undefined {
        return selectedCourseTemplateModes.value[variable] || COURSE_TEMPLATE_VARIABLE_DEFINITIONS.find(item => item.key === variable)?.defaultMode
    }

    const courseTemplateVariables = computed(() => {
        const selection = source.selection()[0]
        const lesson = selection?.lesson
        const courseName = selection?.courseName || ''
        const courseDisplayName = selection?.courseDisplayName || ''

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
        const selection = source.selection()[0]
        const context = buildCourseCopyContext(
            selection?.courseName || '',
            selection?.courseDisplayName || '',
            selection?.lesson,
            t('report.lesson_label')
        )
        return courseCopyTemplateText.value.trim()
            ? renderCopyTemplate(courseCopyTemplateText.value, context.values, context.formatters).trim()
            : ''
    })

    async function copyCourseInfo() {
        const selection = source.selection()
        if (!selection.length || !source.reportKey() || clipboard.loading.value) return

        const contexts = selection.map(item => buildCourseCopyContext(
            item.courseName,
            item.courseDisplayName,
            item.lesson,
            t('report.lesson_label')
        ))
        if (await clipboard.copyAll(contexts)) {
            justCopiedCourse.value = true
            clearTimeout(copiedTimer)
            copiedTimer = setTimeout(() => { justCopiedCourse.value = false }, 2000)
        }
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
            const bundle = await CopyTemplateQueryService.getEditorBundle('course_copy')
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
            selectedCourseTemplateLoadKey.value = bundle.current?.key || courseTemplateLoadOptions.value[0]?.key || ''
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
            await CopyTemplateCommandService.saveCourseTemplateAsUserDefault({ plainText: templateText, richText: courseCopyTemplateDocument.value })
            void clipboard.reload()
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
        clipboard,
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
