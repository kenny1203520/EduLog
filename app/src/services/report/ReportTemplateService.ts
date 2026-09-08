import { supabase } from '@/lib/supabase'
import { ReportTemplate, type ReportTemplateDTO } from '@/models/ReportTemplate'
import { createTextEditorContent } from '@/components/common/text-editor/content'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

/**
 * ReportTemplateService handles database operations for report templates.
 */
const REPORT_TEMPLATE_EDITOR_COLUMNS = 'id, name, content, contact_notes, class_notes, content_document, contact_notes_document, class_notes_document, instructor_id, created_at, updated_at'

export class ReportTemplateService {
    /**
     * Gets all templates for a specific instructor
     */
    static async getTemplates(instructorId: string): Promise<ReportTemplate[]> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiResourceClient.list<ReportTemplateDTO>('report-templates', { instructorId, perPage: 100, sort: 'name', mode: 'v1' })
            return (response.data || []).map(dto => new ReportTemplate(dto))
        }
        const { data, error } = await supabase
            .from('report_templates')
            .select(REPORT_TEMPLATE_EDITOR_COLUMNS)
            .eq('instructor_id', instructorId)
            .order('name', { ascending: true })

        if (error) throw new Error(`Failed to fetch templates: ${error.message}`)

        return (data as ReportTemplateDTO[]).map(dto => new ReportTemplate(dto))
    }

    /**
     * Saves or updates a template
     */
    static async saveTemplate(template: Partial<ReportTemplateDTO>): Promise<ReportTemplate> {
        const content = createTextEditorContent(template.content_document || template.content || '', { templateVariables: true })
        const contact = createTextEditorContent(template.contact_notes_document || template.contact_notes || '', { templateVariables: true })
        const classNotes = createTextEditorContent(template.class_notes_document || template.class_notes || '', { templateVariables: true })
        const payload = {
            ...template,
            content: content.plainText,
            content_document: content.richText,
            contact_notes: contact.plainText,
            contact_notes_document: contact.richText,
            class_notes: classNotes.plainText,
            class_notes_document: classNotes.richText
        }
        if (getApiV1Mode() === 'v1') {
            const { id: ignoredId, ...writable } = payload
            void ignoredId
            const response = template.id
                ? await apiResourceClient.update<ReportTemplateDTO>('report-templates', template.id, writable, 'v1')
                : await apiResourceClient.create<ReportTemplateDTO>('report-templates', writable, 'v1')
            return new ReportTemplate(response.data)
        }
        const { data, error } = await supabase
            .from('report_templates')
            .upsert(payload)
            .select(REPORT_TEMPLATE_EDITOR_COLUMNS)
            .single()

        if (error) throw new Error(`Failed to save template: ${error.message}`)

        return new ReportTemplate(data)
    }

    /**
     * Deletes a template
     */
    static async deleteTemplate(id: string): Promise<void> {
        if (getApiV1Mode() === 'v1') {
            await apiResourceClient.remove('report-templates', id, 'v1')
            return
        }
        const { error } = await supabase
            .from('report_templates')
            .delete()
            .eq('id', id)

        if (error) throw new Error(`Failed to delete template: ${error.message}`)
    }
}
