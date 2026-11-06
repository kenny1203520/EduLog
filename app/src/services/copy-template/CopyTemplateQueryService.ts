import {
    USER_DEFAULT_SCOPE_ENTITY_ID,
    SYSTEM_ATTENDANCE_TEMPLATE,
    SYSTEM_COURSE_TEMPLATE,
} from '@/utils/copyTemplate'
import type { CopyTemplateDTO, CopyTemplateScopeType, EffectiveTemplateResult, CopyTemplateLoadOption, CopyTemplateEditorBundle } from './CopyTemplateService'
import { createTextEditorContent } from '@/components/text-editor/content'
import { apiResourceClient } from '@/services/api/ApiResourceClient'

/**
 * Query service for copy templates
 * Handles retrieval of templates and template options
 */
export class CopyTemplateQueryService {

    private static async getTemplateForScope(
        templateType: 'attendance_copy' | 'course_copy',
        scopeType: CopyTemplateScopeType,
        scopeEntityId: string
    ): Promise<CopyTemplateDTO | null> {
        const response = await apiResourceClient.list<CopyTemplateDTO>('copy-templates', { templateType, scopeType, scopeEntityId, perPage: 1, sort: '-updated_at' })
        return response.data?.[0] || null
    }

    static async getAttendanceTemplateByScope(
        scopeType: CopyTemplateScopeType,
        classSessionId?: string
    ): Promise<string | null> {
        const scopeEntityId = scopeType === 'class_session' ? (classSessionId || '') : USER_DEFAULT_SCOPE_ENTITY_ID
        if (!scopeEntityId) return null
        const row = await this.getTemplateForScope('attendance_copy', scopeType, scopeEntityId)
        return row?.template_text || null
    }

    static async getCourseUserDefaultTemplate(): Promise<string | null> {
        const row = await this.getTemplateForScope('course_copy', 'user_default', USER_DEFAULT_SCOPE_ENTITY_ID)
        return row?.template_text || null
    }

    static async getEffectiveAttendanceTemplate(classSessionId: string): Promise<EffectiveTemplateResult> {
        const classRow = await this.getTemplateForScope('attendance_copy', 'class_session', classSessionId)
        const row = classRow?.template_text ? classRow : await this.getTemplateForScope('attendance_copy', 'user_default', USER_DEFAULT_SCOPE_ENTITY_ID)
        if (row?.template_text) return { templateText: row.template_text, templateDocument: createTextEditorContent(row.template_document || row.template_text, { templateVariables: true }).richText, source: row === classRow ? 'class_session' : 'user_default' }
        return { templateText: SYSTEM_ATTENDANCE_TEMPLATE, source: 'system_default' }
    }

    static async getEffectiveCourseTemplate(): Promise<EffectiveTemplateResult> {
        const row = await this.getTemplateForScope('course_copy', 'user_default', USER_DEFAULT_SCOPE_ENTITY_ID)
        if (row?.template_text) return { templateText: row.template_text, templateDocument: createTextEditorContent(row.template_document || row.template_text, { templateVariables: true }).richText, source: 'user_default' }
        return { templateText: SYSTEM_COURSE_TEMPLATE, source: 'system_default' }
    }

    private static async listUserTemplatesByType(
        templateType: 'attendance_copy' | 'course_copy'
    ): Promise<CopyTemplateDTO[]> {
        const response = await apiResourceClient.list<CopyTemplateDTO>('copy-templates', { templateType, perPage: 100, sort: '-updated_at' })
        return response.data || []
    }

    static async getEditorBundle(
        templateType: 'attendance_copy' | 'course_copy',
        currentClassSessionId?: string
    ): Promise<CopyTemplateEditorBundle> {
        const options = await this.getTemplateLoadOptions(templateType, currentClassSessionId)
        const current = templateType === 'attendance_copy' && currentClassSessionId
            ? options.find(option => option.scopeType === 'class_session' && option.scopeEntityId === currentClassSessionId)
                || options.find(option => option.scopeType === 'user_default')
            : options.find(option => option.scopeType === 'user_default')
        return { options, current }
    }

    private static async getClassSessionNameMap(sessionIds: string[]): Promise<Record<string, string>> {
        const validIds = [...new Set(sessionIds.filter(Boolean))]
        const response = await apiResourceClient.list<{ id: string; name: string }>('class-sessions', { perPage: 100 })
        return Object.fromEntries((response.data || []).filter((row) => validIds.includes(row.id)).map((row) => [row.id, row.name]))
    }

    static async getTemplateLoadOptions(
        templateType: 'attendance_copy' | 'course_copy',
        currentClassSessionId?: string
    ): Promise<CopyTemplateLoadOption[]> {
        const userTemplates = await this.listUserTemplatesByType(templateType)

        const systemOption: CopyTemplateLoadOption = {
            key: 'system_default',
            templateType,
            source: 'system_default',
            scopeType: 'system_default',
            scopeEntityId: 'system_default',
            label: 'system_default',
            templateText: templateType === 'attendance_copy' ? SYSTEM_ATTENDANCE_TEMPLATE : SYSTEM_COURSE_TEMPLATE
        }

        if (userTemplates.length === 0) {
            return [systemOption]
        }

        const sessionNameMap = templateType === 'attendance_copy'
            ? await this.getClassSessionNameMap(
                userTemplates
                    .filter(item => item.scope_type === 'class_session')
                    .map(item => item.scope_entity_id)
            )
            : {}

        const mapped = userTemplates.map(item => {
            let label: string = item.scope_type
            if (item.scope_type === 'user_default') {
                label = 'user_default'
            }
            if (item.scope_type === 'class_session') {
                label = sessionNameMap[item.scope_entity_id] || item.scope_entity_id
            }

            return {
                key: `${item.scope_type}:${item.scope_entity_id}`,
                templateType,
                source: item.scope_type === 'class_session' ? 'class_session' : 'user_default',
                scopeType: item.scope_type,
                scopeEntityId: item.scope_entity_id,
                label,
                templateText: item.template_text,
                templateDocument: createTextEditorContent(item.template_document || item.template_text, { templateVariables: true }).richText,
                updatedAt: item.updated_at
            } as CopyTemplateLoadOption
        })

        mapped.sort((a, b) => {
            if (currentClassSessionId) {
                const aIsCurrent = a.scopeType === 'class_session' && a.scopeEntityId === currentClassSessionId
                const bIsCurrent = b.scopeType === 'class_session' && b.scopeEntityId === currentClassSessionId
                if (aIsCurrent !== bIsCurrent) {
                    return aIsCurrent ? -1 : 1
                }
            }

            if (a.scopeType === 'user_default' && b.scopeType !== 'user_default') {
                return -1
            }
            if (b.scopeType === 'user_default' && a.scopeType !== 'user_default') {
                return 1
            }

            const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
            const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
            return bt - at
        })

        return [systemOption, ...mapped]
    }
}
