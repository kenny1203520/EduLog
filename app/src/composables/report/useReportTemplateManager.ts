import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { ReportTemplateService } from '@/services/report/ReportTemplateService'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
import { useFeedback } from '@/composables/useFeedback'
import { useAuthStore } from '@/stores/useAuthStore'
import { createNumberFormatters, formatCopyTemplateToken, renderCopyTemplate } from '@/utils/copyTemplate'
import { formatNumber } from '@/utils/numberFormatting'
import { createTextEditorContent, renderTemplateContent } from '@/components/text-editor/content'
import { insertTextAtSelection, type RichTextDocumentV1, type TextEditorContent } from '@/components/text-editor/types'

export interface ReportTemplate {
    id: string
    name: string
    content: string
    contactNotes?: string
    classNotes?: string
    contentDocument?: RichTextDocumentV1
    contactNotesDocument?: RichTextDocumentV1
    classNotesDocument?: RichTextDocumentV1
}

export interface ReportTemplateVariableItem {
    key: string
    token: string
    label: string
    description: string
    modes?: Array<{ value: string; label: string }>
}

/** The report's values that `{{variable}}` tokens in a report template render to. */
export type ReportTemplateContext = Record<
    'classroom_name' | 'session_name' | 'session_time' | 'student_name' | 'course_name' | 'lesson' | 'lesson_name'
    | 'progress' | 'progress_start' | 'progress_end' | 'is_completed',
    string
>

const REPORT_TEMPLATE_VARIABLE_KEYS: Array<keyof ReportTemplateContext> = [
    'classroom_name',
    'session_name',
    'session_time',
    'student_name',
    'course_name',
    'lesson',
    'lesson_name',
    'progress',
    'progress_start',
    'progress_end',
    'is_completed'
]

/** Renders a report-template text against the report's values; lesson numbers honour their mode. */
export function renderReportTemplateText(text: string, context: ReportTemplateContext): string {
    if (!text.trim()) {
        return ''
    }
    const formatters = {
        lesson: createNumberFormatters('lesson')
    }
    return renderCopyTemplate(text, context, formatters).trim()
}

export interface RenderedReportTemplate {
    content: TextEditorContent
    contactNotes: TextEditorContent
    classNotes: TextEditorContent
}

interface ReportTemplateManagerOptions {
    /** The report's values for template variables. */
    context: () => ReportTemplateContext
    /** The editor's current fields; a new template starts from them. */
    currentFields: () => {
        content: string
        contentDocument: RichTextDocumentV1
        contactNotes: string
        contactNotesDocument: RichTextDocumentV1
        classNotes: string
        classNotesDocument: RichTextDocumentV1
    }
    /** The open report, so a template is not applied over a newer saved version. */
    currentReport: () => { reportId?: string; version: number }
    /** Puts a rendered template into the report. */
    insertRendered: (rendered: RenderedReportTemplate) => void
    openConfirm: (title: string, message: string, action: () => Promise<void>, isDangerous?: boolean) => void
}

/** The user's saved report templates and the manager modal that edits and applies them. */
export function useReportTemplateManager(options: ReportTemplateManagerOptions) {
    const { t } = useI18n()
    const toast = useToast()
    const { errorKey, reportError } = useFeedback()
    const authStore = useAuthStore()

    const savedTemplates = ref<ReportTemplate[]>([])
    const isSavingTemplate = ref(false)
    const isLoadingTemplateManager = ref(false)
    const showReportTemplateManagerModal = ref(false)
    let reportTemplateRequestGeneration = 0
    const selectedTemplateId = ref('')
    const templateDraftName = ref('')
    const templateDraftContent = ref('')
    const templateDraftContentDocument = ref(createTextEditorContent('', { templateVariables: true }).richText)
    const templateDraftContactNotes = ref('')
    const templateDraftContactNotesDocument = ref(createTextEditorContent('', { templateVariables: true }).richText)
    const templateDraftClassNotes = ref('')
    const templateDraftClassNotesDocument = ref(createTextEditorContent('', { templateVariables: true }).richText)
    const selectedReportTemplateModes = ref<Record<string, string>>({
        lesson: 'arabic'
    })

    async function loadTemplates() {
        if (!authStore.user?.id) return
        try {
            const res = await ReportTemplateService.getTemplates(authStore.user.id)
            savedTemplates.value = res.map(template => ({
                id: template.id!,
                name: template.name,
                content: template.content,
                contentDocument: template.contentDocument,
                contactNotes: template.contactNotes,
                contactNotesDocument: template.contactNotesDocument,
                classNotes: template.classNotes,
                classNotesDocument: template.classNotesDocument
            }))
        } catch (e) {
            console.error('Failed to load templates', e)
        }
    }

    const reportTemplateVariables = computed<ReportTemplateVariableItem[]>(() => {
        return REPORT_TEMPLATE_VARIABLE_KEYS.map(key => {
            const definition = key === 'lesson'
                ? { modes: [{ value: 'arabic', label: 'arabic' }, { value: 'roman', label: 'roman' }, { value: 'chinese', label: 'chinese' }, { value: 'formal', label: 'formal' }] }
                : {}

            return {
                key,
                token: formatCopyTemplateToken(key, selectedReportTemplateModes.value[key]),
                label: t(`report.editor.template_variable_descriptions.${key}`),
                description: t(`report.editor.template_variable_descriptions.${key}`),
                ...definition
            }
        })
    })

    const templateOptionsDropdown = computed(() => [
        { label: t('report.editor.template_new_option'), value: '' },
        ...savedTemplates.value.map(template => ({ label: template.name, value: template.id }))
    ])

    function renderText(text: string): string {
        return renderReportTemplateText(text, options.context())
    }

    const reportTemplatePreviewSections = computed(() => {
        return [
            {
                title: t('report.editor.contact_notes_label'),
                content: renderText(templateDraftContactNotes.value)
            },
            {
                title: t('report.editor.class_notes_label'),
                content: renderText(templateDraftClassNotes.value)
            },
            {
                title: t('report.editor.learning_report_label'),
                content: renderText(templateDraftContent.value)
            }
        ]
    })

    const reportTemplatePreviewText = computed(() => {
        return reportTemplatePreviewSections.value
            .map(section => `[${section.title}]\n${section.content}`)
            .join('\n\n')
            .trim()
    })

    // Variable preview mapping for tooltip display
    const reportTemplateVariablePreview = computed<Record<string, string>>(() => {
        const context = options.context()
        return Object.entries(context).reduce((acc, [key, value]) => {
            const mode = selectedReportTemplateModes.value[key]
            if (mode) {
                acc[key] = formatNumber(value, mode)
            } else {
                acc[key] = String(value || '')
            }
            return acc
        }, {} as Record<string, string>)
    })

    // Editable fields structure for multi-field modal
    const reportTemplateEditableFields = computed<Array<{ id: string; label: string; content: string; document: RichTextDocumentV1 }>>(() => {
        return [
            {
                id: 'contact',
                label: t('report.editor.contact_notes_label'),
                content: templateDraftContactNotes.value,
                document: templateDraftContactNotesDocument.value
            },
            {
                id: 'class',
                label: t('report.editor.class_notes_label'),
                content: templateDraftClassNotes.value,
                document: templateDraftClassNotesDocument.value
            },
            {
                id: 'report',
                label: t('report.editor.learning_report_label'),
                content: templateDraftContent.value,
                document: templateDraftContentDocument.value
            }
        ]
    })

    function insertReportTemplateVariable(fieldId: string, variable: string, caret = -1, selectionEnd = -1) {
        const mode = selectedReportTemplateModes.value[variable]
        const token = formatCopyTemplateToken(variable, mode)
        const insertAtSelection = (content: string) => {
            const start = caret < 0 ? content.length : caret
            const end = selectionEnd < 0 ? content.length : selectionEnd
            return insertTextAtSelection(content, token, start, end)
        }
        if (fieldId === 'contact') {
            templateDraftContactNotes.value = insertAtSelection(templateDraftContactNotes.value)
            templateDraftContactNotesDocument.value = createTextEditorContent(templateDraftContactNotes.value, { templateVariables: true }).richText
            return
        }
        if (fieldId === 'class') {
            templateDraftClassNotes.value = insertAtSelection(templateDraftClassNotes.value)
            templateDraftClassNotesDocument.value = createTextEditorContent(templateDraftClassNotes.value, { templateVariables: true }).richText
            return
        }
        templateDraftContent.value = insertAtSelection(templateDraftContent.value)
        templateDraftContentDocument.value = createTextEditorContent(templateDraftContent.value, { templateVariables: true }).richText
    }

    function onEditableFieldsUpdate(fields: Array<{ id: string; label: string; content: string; document?: RichTextDocumentV1 }>) {
        fields.forEach(field => {
            if (field.id === 'contact') {
                templateDraftContactNotes.value = field.content
                if (field.document) templateDraftContactNotesDocument.value = field.document
            } else if (field.id === 'class') {
                templateDraftClassNotes.value = field.content
                if (field.document) templateDraftClassNotesDocument.value = field.document
            } else if (field.id === 'report') {
                templateDraftContent.value = field.content
                if (field.document) templateDraftContentDocument.value = field.document
            }
        })
    }

    function applyTemplate(template: ReportTemplate) {
        const renderContent = (value: RichTextDocumentV1 | string | undefined) => renderTemplateContent(
            value || '',
            (key, mode) => renderText(formatCopyTemplateToken(key, mode || selectedReportTemplateModes.value[key])),
            renderText
        )
        options.insertRendered({
            content: renderContent(template.contentDocument || template.content),
            contactNotes: renderContent(template.contactNotesDocument || template.contactNotes),
            classNotes: renderContent(template.classNotesDocument || template.classNotes),
        })
        showReportTemplateManagerModal.value = false
    }

    function createNewTemplateDraft() {
        const fields = options.currentFields()
        selectedTemplateId.value = ''
        templateDraftName.value = ''
        templateDraftContent.value = fields.content || ''
        templateDraftContentDocument.value = fields.contentDocument
        templateDraftContactNotes.value = fields.contactNotes || ''
        templateDraftContactNotesDocument.value = fields.contactNotesDocument
        templateDraftClassNotes.value = fields.classNotes || ''
        templateDraftClassNotesDocument.value = fields.classNotesDocument
    }

    function syncTemplateDraftFromSelection() {
        const selected = savedTemplates.value.find(item => item.id === selectedTemplateId.value)
        if (!selected) {
            createNewTemplateDraft()
            return
        }

        templateDraftName.value = selected.name
        templateDraftContent.value = selected.content || ''
        templateDraftContentDocument.value = selected.contentDocument || createTextEditorContent(selected.content || '', { templateVariables: true }).richText
        templateDraftContactNotes.value = selected.contactNotes || ''
        templateDraftContactNotesDocument.value = selected.contactNotesDocument || createTextEditorContent(selected.contactNotes || '', { templateVariables: true }).richText
        templateDraftClassNotes.value = selected.classNotes || ''
        templateDraftClassNotesDocument.value = selected.classNotesDocument || createTextEditorContent(selected.classNotes || '', { templateVariables: true }).richText
    }

    async function openReportTemplateManagerModal() {
        const requestGeneration = ++reportTemplateRequestGeneration
        showReportTemplateManagerModal.value = true
        try {
            isLoadingTemplateManager.value = true
            await loadTemplates()
            if (requestGeneration !== reportTemplateRequestGeneration || !showReportTemplateManagerModal.value) return
            if (savedTemplates.value.length > 0) {
                selectedTemplateId.value = savedTemplates.value[0].id
                syncTemplateDraftFromSelection()
            } else {
                createNewTemplateDraft()
            }
        } catch (error) {
            console.error('Failed to open template manager', error)
        } finally {
            isLoadingTemplateManager.value = false
        }
    }

    async function saveTemplateDraft() {
        if (!authStore.user?.id) return
        if (!templateDraftName.value.trim()) {
            errorKey('report.editor.template_name_required')
            return
        }

        try {
            isSavingTemplate.value = true
            const saved = await ReportTemplateService.saveTemplate({
                id: selectedTemplateId.value || undefined,
                name: templateDraftName.value.trim(),
                content: templateDraftContent.value,
                content_document: templateDraftContentDocument.value,
                contact_notes: templateDraftContactNotes.value,
                contact_notes_document: templateDraftContactNotesDocument.value,
                class_notes: templateDraftClassNotes.value,
                class_notes_document: templateDraftClassNotesDocument.value,
                instructor_id: authStore.user.id
            })

            await loadTemplates()
            selectedTemplateId.value = saved.id || ''
            syncTemplateDraftFromSelection()
            toast.success(t('report.editor.template_saved'))
        } catch (error) {
            console.error('Failed to save template draft', error)
            reportError(error, 'report.editor.template_load_error')
        } finally {
            isSavingTemplate.value = false
        }
    }

    async function applyTemplateDraftToReport() {
        const { reportId } = options.currentReport()
        if (reportId) {
            try {
                const serverReport = await OccurrenceReportService.getReportById(reportId)
                if (serverReport.version !== options.currentReport().version) {
                    errorKey('report.editor.restore_conflict_error')
                    return
                }
            } catch (e) {
                console.error('Failed to check version before applying template', e)
            }
        }

        applyTemplate({
            id: selectedTemplateId.value || 'draft',
            name: templateDraftName.value || t('report.editor.template_new_option'),
            content: templateDraftContent.value,
            contentDocument: templateDraftContentDocument.value,
            contactNotes: templateDraftContactNotes.value,
            contactNotesDocument: templateDraftContactNotesDocument.value,
            classNotes: templateDraftClassNotes.value,
            classNotesDocument: templateDraftClassNotesDocument.value
        })
    }

    function deleteSelectedTemplate() {
        const id = selectedTemplateId.value
        if (!id) {
            return
        }

        options.openConfirm(
            t('report.editor.delete_template_title', 'Delete Template'),
            t('report.editor.delete_template_confirm', 'Are you sure you want to delete this template?'),
            async () => {
                try {
                    await ReportTemplateService.deleteTemplate(id)
                    savedTemplates.value = savedTemplates.value.filter(item => item.id !== id)
                    selectedTemplateId.value = savedTemplates.value[0]?.id || ''
                    syncTemplateDraftFromSelection()
                    toast.success(t('report.editor.template_deleted') || 'Template deleted')
                } catch (error) {
                    console.error('Failed to delete template', error)
                }
            },
            true
        )
    }

    return {
        savedTemplates,
        isSavingTemplate,
        isLoadingTemplateManager,
        showReportTemplateManagerModal,
        selectedTemplateId,
        templateDraftName,
        selectedReportTemplateModes,
        reportTemplateVariables,
        templateOptionsDropdown,
        reportTemplatePreviewSections,
        reportTemplatePreviewText,
        reportTemplateVariablePreview,
        reportTemplateEditableFields,
        loadTemplates,
        insertReportTemplateVariable,
        onEditableFieldsUpdate,
        createNewTemplateDraft,
        syncTemplateDraftFromSelection,
        openReportTemplateManagerModal,
        saveTemplateDraft,
        applyTemplateDraftToReport,
        deleteSelectedTemplate,
    }
}
