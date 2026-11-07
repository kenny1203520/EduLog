import { USER_DEFAULT_SCOPE_ENTITY_ID } from '@/utils/copyTemplate'
import type { CopyTemplateScopeType } from './CopyTemplateQueryService'
import { createTextEditorContent } from '@/components/text-editor/content'
import type { TextEditorContentInput } from '@/components/text-editor/types'
import { apiV1Client } from '@/services/api/ApiV1Client'

/**
 * Command service for copy templates
 * Handles creation and updating of templates
 */
export class CopyTemplateCommandService {

    private static async saveTemplate(
        templateType: 'attendance_copy' | 'course_copy',
        scopeType: CopyTemplateScopeType,
        scopeEntityId: string,
        template: TextEditorContentInput
    ): Promise<void> {
        const content = createTextEditorContent(template, { templateVariables: true })
        const payload = { template_type: templateType, scope_type: scopeType, scope_entity_id: scopeEntityId, template_text: content.plainText, template_document: content.richText }
        await apiV1Client.put(`/copy-templates/${encodeURIComponent(templateType)}/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeEntityId)}`, payload)
        return
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
