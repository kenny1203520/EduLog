import { supabase } from '@/lib/supabase'
import { USER_DEFAULT_SCOPE_ENTITY_ID } from '@/utils/copyTemplate'
import type { CopyTemplateDTO, CopyTemplateScopeType } from './CopyTemplateService'

/**
 * Command service for copy templates
 * Handles creation and updating of templates
 */
export class CopyTemplateCommandService {
    private static async getCurrentUserId(): Promise<string | null> {
        const {
            data: { user }
        } = await supabase.auth.getUser()

        return user?.id || null
    }

    private static async saveTemplate(
        templateType: 'attendance_copy' | 'course_copy',
        scopeType: CopyTemplateScopeType,
        scopeEntityId: string,
        templateText: string
    ): Promise<void> {
        const userId = await this.getCurrentUserId()
        if (!userId) throw new Error('User not authenticated')

        const payload: CopyTemplateDTO = {
            user_id: userId,
            template_type: templateType,
            scope_type: scopeType,
            scope_entity_id: scopeEntityId,
            template_text: templateText
        }

        const { error } = await supabase
            .from('copy_templates')
            .upsert(payload, { onConflict: 'user_id,template_type,scope_type,scope_entity_id' })

        if (error) throw new Error(error.message)
    }

    static async saveAttendanceTemplateForSession(classSessionId: string, templateText: string): Promise<void> {
        await this.saveTemplate('attendance_copy', 'class_session', classSessionId, templateText)
    }

    static async saveAttendanceTemplateAsUserDefault(templateText: string): Promise<void> {
        await this.saveTemplate('attendance_copy', 'user_default', USER_DEFAULT_SCOPE_ENTITY_ID, templateText)
    }

    static async saveCourseTemplateAsUserDefault(templateText: string): Promise<void> {
        await this.saveTemplate('course_copy', 'user_default', USER_DEFAULT_SCOPE_ENTITY_ID, templateText)
    }
}
