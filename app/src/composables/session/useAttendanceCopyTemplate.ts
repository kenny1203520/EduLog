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
import { useCopyTemplateClipboard } from '@/composables/useCopyTemplateClipboard'
import { DateUtils } from '@/utils/dateUtils'
import { createTextEditorContent } from '@/components/text-editor/content'
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

export function groupAttendanceNames(
    enrollments: Enrollment[],
    reportMap: Map<string, any>
): AttendanceNameGroups {
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

    return grouped
}

/** Sample names are only available in the template editor preview. */
export function groupAttendancePreviewNames(t: Translate, enrollments: Enrollment[], reportMap: Map<string, any>) {
    const names = groupAttendanceNames(enrollments, reportMap)
    if (Object.values(names).some(list => list.length)) return names
    return {
        present_list: ['王小明', '陳小華'],
        absent_list: ['林小美'],
        pending_list: [t('classroom.pending_list')],
    }
}

/** Per-mode formatters for the three name lists, used by `{{present_list|slash}}` style tokens. */
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
    ready: Ref<boolean>
}

/** The attendance copy button and the editor modal for its template. */
export function useAttendanceCopyTemplate(source: AttendanceCopyTemplateSource) {
    const { t } = useI18n()
    const toast = useToast()
    const { errorKey, reportError } = useFeedback()
    const preferences = usePreferencesStore()
    const { sessionId, session, todayOccurrence, rosterEnrollments, reportMap, ready } = source
    const clipboard = useCopyTemplateClipboard(
        () => session.value ? sessionId : undefined,
        () => CopyTemplateQueryService.getEffectiveAttendanceTemplate(sessionId),
        SYSTEM_ATTENDANCE_TEMPLATE
    )
    watch(() => [todayOccurrence.value?.id, ready.value], clipboard.resetCopy, { flush: 'sync' })

    const occurrenceDate = computed(() =>
        DateUtils.displayDate(todayOccurrence.value?.occurrenceDate, preferences.locale, preferences.timeZone))
    const startTime = computed(() => todayOccurrence.value?.effectiveStartTime?.slice(0, 5) || '')
    const endTime = computed(() => todayOccurrence.value?.effectiveEndTime?.slice(0, 5) || '')

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
                    ? occurrenceDate.value
                    : t('classroom.no_teaching_day_selected')
            case 'start_time':
                return startTime.value || '10:00'
            case 'end_time':
                return endTime.value || '12:00'
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

    function buildAttendanceTemplateContext(names: AttendanceNameGroups, preview = false) {
        return {
            values: {
                class_info_title: t('classroom.class_info_title'),
                session_name: session.value?.name || '',
                occurrence_date: todayOccurrence.value?.occurrenceDate ? occurrenceDate.value : '',
                start_time: startTime.value,
                end_time: endTime.value,
                time_range: [startTime.value, endTime.value].filter(Boolean).join('-'),
                present_list_label: t('classroom.present_list'),
                absent_list_label: t('classroom.absent_list'),
                pending_list_label: t('classroom.pending_list'),
                present_list: formatAttendanceNameList(t, names.present_list, preview ? getSelectedAttendanceTemplateMode('present_list') || 'comma' : 'comma'),
                absent_list: formatAttendanceNameList(t, names.absent_list, preview ? getSelectedAttendanceTemplateMode('absent_list') || 'comma' : 'comma'),
                pending_list: formatAttendanceNameList(t, names.pending_list, preview ? getSelectedAttendanceTemplateMode('pending_list') || 'comma' : 'comma')
            },
            formatters: buildAttendanceListFormatters(t, names)
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

        const context = buildAttendanceTemplateContext(getAttendancePreviewNames(), true)
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
            selectedAttendanceTemplateLoadKey.value = bundle.current?.key || attendanceTemplateLoadOptions.value[0]?.key || ''

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

            void clipboard.reload()
            showAttendanceTemplateModal.value = false
        } catch (error) {
            console.error('Failed to save attendance copy template', error)
            reportError(error, 'classroom.copy_template_save_failed')
        } finally {
            isSavingAttendanceTemplate.value = false
        }
    }

    async function copyAttendanceInfo() {
        if (!ready.value || !todayOccurrence.value || !session.value || clipboard.loading.value) return

        const names = groupAttendanceNames(rosterEnrollments.value, reportMap.value)
        const context = buildAttendanceTemplateContext(names)
        if (await clipboard.copy(context.values, context.formatters)) {
            toast.success(t('classroom.copy_success'))
        }
    }

    return {
        clipboard,
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
