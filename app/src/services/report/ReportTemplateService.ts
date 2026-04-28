import { supabase } from '@/lib/supabase'
import { ReportTemplate, type ReportTemplateDTO } from '@/models/ReportTemplate'

/**
 * ReportTemplateService handles database operations for report templates.
 */
export class ReportTemplateService {
    /**
     * Gets all templates for a specific instructor
     */
    static async getTemplates(instructorId: string): Promise<ReportTemplate[]> {
        const { data, error } = await supabase
            .from('report_templates')
            .select('*')
            .eq('instructor_id', instructorId)
            .order('name', { ascending: true })

        if (error) throw new Error(`Failed to fetch templates: ${error.message}`)

        return (data as ReportTemplateDTO[]).map(dto => new ReportTemplate(dto))
    }

    /**
     * Saves or updates a template
     */
    static async saveTemplate(template: Partial<ReportTemplateDTO>): Promise<ReportTemplate> {
        const { data, error } = await supabase
            .from('report_templates')
            .upsert(template)
            .select()
            .single()

        if (error) throw new Error(`Failed to save template: ${error.message}`)

        return new ReportTemplate(data)
    }

    /**
     * Deletes a template
     */
    static async deleteTemplate(id: string): Promise<void> {
        const { error } = await supabase
            .from('report_templates')
            .delete()
            .eq('id', id)

        if (error) throw new Error(`Failed to delete template: ${error.message}`)
    }
}
