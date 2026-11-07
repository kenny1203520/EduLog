import { computed, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import type { Enrollment } from '@/models/Enrollment'
import {
    ATTENDANCE_TEMPLATE_VARIABLE_DEFINITIONS,
    SYSTEM_ATTENDANCE_TEMPLATE,
    formatCopyTemplateToken,
    renderCopyTemplate
} from '@/utils/copyTemplate'
import { copyRichTextToClipboard } from '@/utils/clipboard'
import { createTextEditorContent, renderTemplateContent } from '@/components/text-editor/content'
import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import { CopyTemplateCommandService } from '@/services/copy-template/CopyTemplateCommandService'
import { CopyTemplateQueryService } from '@/services/copy-template/CopyTemplateQueryService'

type Translate = (key: string) => string
type AttendanceListKey = 'present_list' | 'absent_list' | 'pending_list'
export type AttendanceNameGroups = Record<AttendanceListKey, string[]>

const LIST_MODES = ['comma', 'slash', 'newline', 'bullet', 'space'] as const

export function formatAttendanceNameList(t: Translate, names: string[], mode: string): string {
    const safeNames = names.filter(Boolean)
    if (safeNames.length === 0) {
        return t('common.none')
    }

    switch (mode) {
        case 'slash':
            return safeNames.join(' / ')
        case 'newline':
            return safeNames.join('\n')
        case 'bullet':
            return safeNames.map(name => `• ${name}`).join('\n')
        case 'space':
            return safeNames.join(' ')
        case 'comma':
            return safeNames.join(', ')
        default:
            return safeNames.join(', ')
    }
}

/**
 * Groups the roster's student names by attendance. An empty roster gets
 * sample names so the template preview still shows what each list renders.
 */
export function groupAttendancePreviewNames(
    t: Translate,
    enrollments: Enrollment[],
    reportMap: Map<string, any>
): AttendanceNameGroups {
    const fallback = ['王小明', '陳小華', '林小美']

    const grouped: AttendanceNameGroups = {
        present_list: [],
        absent_list: [],
        pending_list: []
    }

    enrollments.forEach(enrollment => {
        const report = reportMap.get(enrollment.id!)
        const status = report?.attendanceStatus || 'pending'
        const name = enrollment.studentName || ''
        if (!name) {
            return
        }

        if (status === 'present') {
            grouped.present_list.push(name)
        } else if (status === 'absent') {
            grouped.absent_list.push(name)
        } else {
            grouped.pending_list.push(name)
        }
    })

    if (grouped.present_list.length === 0 && grouped.absent_list.length === 0 && grouped.pending_list.length === 0) {
        grouped.present_list = [...fallback.slice(0, 2)]
        grouped.absent_list = [fallback[2]]
        grouped.pending_list = [t('classroom.pending_list')]
    }

    return grouped
}

/** Per-mode formatters for the three name lists, used by `{{present_list:slash}}` style tokens. */
export function buildAttendanceListFormatters(t: Translate, names: AttendanceNameGroups) {
    const forList = (key: AttendanceListKey) => Object.fromEntries(
        LIST_MODES.map(mode => [mode, () => formatAttendanceNameList(t, names[key], mode)])
    ) as Record<typeof LIST_MODES[number], () => string>
    return {
        present_list: forList('present_list'),
        absent_list: forList('absent_list'),
        pending_list: forList('pending_list')
    }
}

interface AttendanceCopyTemplateSource {
    sessionId: string
    session: Ref<any>
    todayOccurrence: Ref<any>
    rosterEnrollments: Ref<Enrollment[]>
    reportMap: Ref<Map<string, any>>
}

/** The attendance copy button and the editor modal for its template. */
export function useAttendanceCopyTemplate(source: AttendanceCopyTemplateSource) {
    const { t } = useI18n()
    const toast = useToast()
    const { errorKey, reportError } = useFeedback()
    const preferences = usePreferencesStore()
    const { sessionId, session, todayOccurrence, rosterEnrollments, reportMap } = source

    const showAttendanceTemplateModal = ref(false)
    let attendanceTemplateRequestGeneration = 0
    const attendanceTemplateText = ref(SYSTEM_ATTENDANCE_TEMPLATE)
    const attendanceTemplateDocument = ref<RichTextDocumentV1>(
        createTextEditorContent(SYSTEM_ATTENDANCE_TEMPLATE, { templateVariables: true }).richText
    )
    const attendanceTemplateScope = ref<'class_session' | 'user_default'>('class_session')
    const isLoadingAttendanceTemplate = ref(false)
    const isSavingAttendanceTemplate = ref(false)
    const attendanceTemplateLoadOptions = ref<Array<{
        key: string
        label: string
        templateText: string
        templateDocument?: RichTextDocumentV1
    }>>([])
    const selectedAttendanceTemplateLoadKey = ref('')
    const selectedAttendanceTemplateModes = ref<Record<string, string>>({
        present_list: 'comma',
        absent_list: 'comma',
        pending_list: 'comma'
    })

    const attendanceTemplateLoadOptionsDropdown = computed(() => {
        return attendanceTemplateLoadOptions.value.map(opt => ({
            label: opt.label,
            value: opt.key
        }))
    })

    function getSelectedAttendanceTemplateMode(variable: string): string | undefined {
        return selectedAttendanceTemplateModes.value[variable] || ATTENDANCE_TEMPLATE_VARIABLE_DEFINITIONS.find(item => item.key === variable)?.defaultMode
    }

    function getAttendancePreviewNames(): AttendanceNameGroups {
        return groupAttendancePreviewNames(t, rosterEnrollments.value, reportMap.value)
    }

    function formatSelectedList(names: AttendanceNameGroups, key: AttendanceListKey): string {
        return formatAttendanceNameList(t, names[key], getSelectedAttendanceTemplateMode(key) || 'comma')
    }

    function getAttendanceVariablePreview(variable: string, names: AttendanceNameGroups): string {
        switch (variable) {
            case 'class_info_title':
                return t('classroom.class_info_title')
            case 'session_name':
                return session.value?.name || t('classroom.session')
            case 'occurrence_date':
                return todayOccurrence.value?.occurrenceDate
                    ? new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString(preferences.locale)
                    : t('classroom.no_teaching_day_selected')
            case 'start_time':
                return todayOccurrence.value?.originalStartTime?.substring(0, 5) || '10:00'
            case 'end_time':
                return todayOccurrence.value?.originalEndTime?.substring(0, 5) || '12:00'
            case 'time_range':
                return `${getAttendanceVariablePreview('start_time', names)}-${getAttendanceVariablePreview('end_time', names)}`
            case 'present_list_label':
                return t('classroom.present_list')
            case 'absent_list_label':
                return t('classroom.absent_list')
            case 'pending_list_label':
                return t('classroom.pending_list')
            case 'present_list':
            case 'absent_list':
            case 'pending_list':
                return formatSelectedList(names, variable)
            default:
                return ''
        }
    }

    function buildAttendanceTemplateContext() {
        const previewNames = getAttendancePreviewNames()
        return {
            values: {
                class_info_title: t('classroom.class_info_title'),
                session_name: session.value?.name || '',
                occurrence_date: todayOccurrence.value?.occurrenceDate ? new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString(preferences.locale) : '',
                start_time: todayOccurrence.value?.originalStartTime?.substring(0, 5) || '',
                end_time: todayOccurrence.value?.originalEndTime?.substring(0, 5) || '',
                time_range: `${todayOccurrence.value?.originalStartTime?.substring(0, 5) || ''}-${todayOccurrence.value?.originalEndTime?.substring(0, 5) || ''}`,
                present_list_label: t('classroom.present_list'),
                absent_list_label: t('classroom.absent_list'),
                pending_list_label: t('classroom.pending_list'),
                present_list: formatSelectedList(previewNames, 'present_list'),
                absent_list: formatSelectedList(previewNames, 'absent_list'),
                pending_list: formatSelectedList(previewNames, 'pending_list')
            },
            formatters: buildAttendanceListFormatters(t, previewNames)
        }
    }

    const attendanceTemplateVariables = computed(() => {
        const previewNames = getAttendancePreviewNames()

        return ATTENDANCE_TEMPLATE_VARIABLE_DEFINITIONS.map(definition => {
            const previewValue = getAttendanceVariablePreview(definition.key, previewNames)
            return {
                ...definition,
                token: formatCopyTemplateToken(definition.key, getSelectedAttendanceTemplateMode(definition.key)),
                label: t(`classroom.copy_template_variable_labels.${definition.key}`),
                description: t(`classroom.copy_template_variable_descriptions.${definition.key}`),
                previewValue,
                modeOptions: (definition.modes || []).map(mode => ({
                    ...mode,
                    label: t(`classroom.copy_template_variable_modes.${mode.value}`)
                }))
            }
        })
    })

    const attendanceTemplatePreviewText = computed(() => {
        if (!attendanceTemplateText.value.trim()) {
            return ''
        }

        const context = buildAttendanceTemplateContext()
        return renderCopyTemplate(attendanceTemplateText.value, context.values, context.formatters).trim()
    })

    function setTemplate(text: string, document?: RichTextDocumentV1 | string) {
        attendanceTemplateText.value = text
        attendanceTemplateDocument.value = createTextEditorContent(
            document || text,
            { templateVariables: true }
        ).richText
    }

    function loadSelectedAttendanceTemplate() {
        const selected = attendanceTemplateLoadOptions.value.find(item => item.key === selectedAttendanceTemplateLoadKey.value)
        if (!selected) {
            return
        }

        attendanceTemplateText.value = selected.templateText || SYSTEM_ATTENDANCE_TEMPLATE
        attendanceTemplateDocument.value = createTextEditorContent(
            selected.templateDocument || attendanceTemplateText.value,
            { templateVariables: true }
        ).richText
    }

    async function openAttendanceTemplateModal() {
        const requestGeneration = ++attendanceTemplateRequestGeneration
        showAttendanceTemplateModal.value = true
        attendanceTemplateScope.value = 'class_session'
        setTemplate(SYSTEM_ATTENDANCE_TEMPLATE)
        selectedAttendanceTemplateModes.value = {
            present_list: 'comma',
            absent_list: 'comma',
            pending_list: 'comma'
        }

        try {
            isLoadingAttendanceTemplate.value = true
            const bundle = await CopyTemplateQueryService.getEditorBundle('attendance_copy', sessionId)
            if (requestGeneration !== attendanceTemplateRequestGeneration || !showAttendanceTemplateModal.value) return
            const loadOptions = bundle.options
            const classTemplate = bundle.current?.scopeType === 'class_session' ? bundle.current.templateText : null
            const userTemplate = bundle.current?.scopeType === 'user_default' ? bundle.current.templateText : null

            attendanceTemplateLoadOptions.value = loadOptions.map(item => {
                let label = item.label
                if (item.label === 'system_default') {
                    label = t('classroom.copy_template_source_system')
                } else if (item.label === 'user_default') {
                    label = t('classroom.copy_template_source_user_default')
                } else if (item.scopeType === 'class_session' && item.scopeEntityId === sessionId) {
                    label = `${item.label} (${t('classroom.copy_template_source_current_session')})`
                }

                return {
                    key: item.key,
                    label,
                    templateText: item.templateText,
                    templateDocument: item.templateDocument
                }
            })
            selectedAttendanceTemplateLoadKey.value = attendanceTemplateLoadOptions.value[0]?.key || ''

            if (classTemplate) {
                attendanceTemplateScope.value = 'class_session'
                const option = loadOptions.find(item =>
                    item.scopeType === 'class_session' && item.scopeEntityId === sessionId
                )
                setTemplate(classTemplate, option?.templateDocument)
                return
            }

            if (userTemplate) {
                attendanceTemplateScope.value = 'user_default'
                const option = loadOptions.find(item => item.scopeType === 'user_default')
                setTemplate(userTemplate, option?.templateDocument)
                return
            }

            setTemplate(SYSTEM_ATTENDANCE_TEMPLATE)
        } catch (error) {
            console.error('Failed to load attendance copy template', error)
            reportError(error, 'classroom.copy_template_load_failed')
        } finally {
            if (requestGeneration === attendanceTemplateRequestGeneration) isLoadingAttendanceTemplate.value = false
        }
    }

    watch(showAttendanceTemplateModal, value => { if (!value) attendanceTemplateRequestGeneration++ })

    async function saveAttendanceTemplate() {
        const content = createTextEditorContent(attendanceTemplateDocument.value, { templateVariables: true })
        if (!content.plainText.trim()) {
            errorKey('classroom.copy_template_empty_error')
            return
        }

        try {
            isSavingAttendanceTemplate.value = true
            if (attendanceTemplateScope.value === 'class_session') {
                await CopyTemplateCommandService.saveAttendanceTemplateForSession(sessionId, content)
                toast.success(t('classroom.copy_template_saved_session'))
            } else {
                await CopyTemplateCommandService.saveAttendanceTemplateAsUserDefault(content)
                toast.success(t('classroom.copy_template_saved_user'))
            }

            showAttendanceTemplateModal.value = false
        } catch (error) {
            console.error('Failed to save attendance copy template', error)
            reportError(error, 'classroom.copy_template_save_failed')
        } finally {
            isSavingAttendanceTemplate.value = false
        }
    }

    function copyAttendanceInfo() {
        if (!todayOccurrence.value || !session.value) return

        const date = new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString(preferences.locale)
        const startTime = todayOccurrence.value.originalStartTime?.substring(0, 5) || ''
        const endTime = todayOccurrence.value.originalEndTime?.substring(0, 5) || ''
        const time = `${startTime}-${endTime}`

        const formatList = (status: 'present' | 'absent' | 'pending') => {
            const list = rosterEnrollments.value
                .filter(e => {
                    const report = reportMap.value.get(e.id!)
                    const s = report?.attendanceStatus || 'pending' // Default to pending if missing
                    return s === status
                })
                .map(e => e.studentName)
                .join(', ')
            return list || t('common.none')
        }

        const context = {
            class_info_title: t('classroom.class_info_title'),
            session_name: session.value.name || '',
            occurrence_date: date,
            start_time: startTime,
            end_time: endTime,
            time_range: time,
            present_list_label: t('classroom.present_list'),
            absent_list_label: t('classroom.absent_list'),
            pending_list_label: t('classroom.pending_list'),
            present_list: formatList('present'),
            absent_list: formatList('absent'),
            pending_list: formatList('pending')
        }

        const formatters = buildAttendanceTemplateContext().formatters
        const copyPromise = CopyTemplateQueryService.getEffectiveAttendanceTemplate(sessionId)
            .then(({ templateText, templateDocument }) => renderTemplateContent(
                templateDocument || templateText,
                (key, mode) => renderCopyTemplate(
                    formatCopyTemplateToken(key, mode || undefined),
                    context,
                    formatters
                ),
                text => renderCopyTemplate(text, context, formatters)
            ))

        copyRichTextToClipboard(copyPromise).then(success => {
            if (success) {
                toast.success(t('classroom.copy_success'))
            } else {
                errorKey('classroom.copy_error')
            }
        }).catch(err => {
            console.error('Failed to copy: ', err)
            reportError(err, 'classroom.copy_error')
        })
    }

    return {
        showAttendanceTemplateModal,
        attendanceTemplateText,
        attendanceTemplateDocument,
        attendanceTemplateScope,
        isLoadingAttendanceTemplate,
        isSavingAttendanceTemplate,
        attendanceTemplateLoadOptionsDropdown,
        selectedAttendanceTemplateLoadKey,
        selectedAttendanceTemplateModes,
        attendanceTemplateVariables,
        attendanceTemplatePreviewText,
        loadSelectedAttendanceTemplate,
        openAttendanceTemplateModal,
        saveAttendanceTemplate,
        copyAttendanceInfo,
    }
}
