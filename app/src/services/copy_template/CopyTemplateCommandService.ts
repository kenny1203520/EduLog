import { apiDataClient } from '@/services/api/ApiDataClient'
import { USER_DEFAULT_SCOPE_ENTITY_ID } from '@/utils/copyTemplate'
import type { CopyTemplateDTO, CopyTemplateScopeType } from './CopyTemplateService'
import { createTextEditorContent } from '@/components/common/text-editor/content'
import type { TextEditorContentInput } from '@/components/common/text-editor/types'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import { apiV1Client } from '@/services/api/ApiV1Client'

/**
 * Command service for copy templates
 * Handles creation and updating of templates
 */
export class CopyTemplateCommandService {
    private static async getCurrentUserId(): Promise<string | null> {
        const {
            data: { user }
        } = await apiDataClient.auth.getUser()

        return user?.id || null
    }

    private static async saveTemplate(
        templateType: 'attendance_copy' | 'course_copy',
        scopeType: CopyTemplateScopeType,
        scopeEntityId: string,
        template: TextEditorContentInput
    ): Promise<void> {
        if (getApiV1Mode() === 'v1') {
            const content = createTextEditorContent(template, { templateVariables: true })
            const payload = { template_type: templateType, scope_type: scopeType, scope_entity_id: scopeEntityId, template_text: content.plainText, template_document: content.richText }
            await apiV1Client.put(`/copy-templates/${encodeURIComponent(templateType)}/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeEntityId)}`, payload)
            return
        }
        const userId = await this.getCurrentUserId()
        if (!userId) throw new Error('User not authenticated')

        const content = createTextEditorContent(template, { templateVariables: true })
        const payload: CopyTemplateDTO = {
            user_id: userId,
            template_type: templateType,
            scope_type: scopeType,
            scope_entity_id: scopeEntityId,
            template_text: content.plainText,
            template_document: content.richText
        }

        const { error } = await apiDataClient
            .from('copy_templates')
            .upsert(payload, { onConflict: 'user_id,template_type,scope_type,scope_entity_id' })

        if (error) throw new Error(error.message)
    }

    static async saveAttendanceTemplateForSession(classSessionId: string, template: TextEditorContentInput): Promise<void> {
        await this.saveTemplate('attendance_copy', 'class_session', classSessionId, template)
    }

    static async saveAttendanceTemplateAsUserDefault(template: TextEditorContentInput): Promise<void> {
        await this.saveTemplate('attendance_copy', 'user_default', USER_DEFAULT_SCOPE_ENTITY_ID, template)
    }

    static async saveCourseTemplateAsUserDefault(template: TextEditorContentInput): Promise<void> {
        await this.saveTemplate('course_copy', 'user_default', USER_DEFAULT_SCOPE_ENTITY_ID, template)
    }
}
