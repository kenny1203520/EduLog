import { ReportTemplate, type ReportTemplateDTO } from '@/models/ReportTemplate'
import { createTextEditorContent } from '@/components/text-editor/content'
import { apiResourceClient } from '@/services/api/ApiResourceClient'

export class ReportTemplateService {
    /**
     * Gets all templates for a specific instructor
     */
    static async getTemplates(instructorId: string): Promise<ReportTemplate[]> {
        const response = await apiResourceClient.list<ReportTemplateDTO>('report-templates', { instructorId, perPage: 100, sort: 'name' })
        return (response.data || []).map((dto: any) => new ReportTemplate(dto))
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
        const { id: ignoredId, ...writable } = payload
        void ignoredId
        const response = template.id
            ? await apiResourceClient.update<ReportTemplateDTO>('report-templates', template.id, writable)
            : await apiResourceClient.create<ReportTemplateDTO>('report-templates', writable)
        return new ReportTemplate(response.data)
    }

    /**
     * Deletes a template
     */
    static async deleteTemplate(id: string): Promise<void> {
        await apiResourceClient.remove('report-templates', id)
        return
    }
}
