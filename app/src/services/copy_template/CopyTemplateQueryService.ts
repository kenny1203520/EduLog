import { supabase } from '@/lib/supabase'
import {
    USER_DEFAULT_SCOPE_ENTITY_ID,
    SYSTEM_ATTENDANCE_TEMPLATE,
    SYSTEM_COURSE_TEMPLATE,
} from '@/utils/copyTemplate'
import type { CopyTemplateDTO, CopyTemplateScopeType, EffectiveTemplateResult, CopyTemplateLoadOption, CopyTemplateEditorBundle } from './CopyTemplateService'
import { createTextEditorContent } from '@/components/common/text-editor/content'

const COPY_TEMPLATE_COLUMNS = 'id, user_id, template_type, scope_type, scope_entity_id, template_text, template_document, created_at, updated_at'

/**
 * Query service for copy templates
 * Handles retrieval of templates and template options
 */
export class CopyTemplateQueryService {
    private static async getCurrentUserId(): Promise<string | null> {
        const {
            data: { user }
        } = await supabase.auth.getUser()

        return user?.id || null
    }

    private static async getTemplateForScope(
        userId: string,
        templateType: 'attendance_copy' | 'course_copy',
        scopeType: CopyTemplateScopeType,
        scopeEntityId: string
    ): Promise<CopyTemplateDTO | null> {
        const { data, error } = await supabase
            .from('copy_templates')
            .select(COPY_TEMPLATE_COLUMNS)
            .eq('user_id', userId)
            .eq('template_type', templateType)
            .eq('scope_type', scopeType)
            .eq('scope_entity_id', scopeEntityId)
            .maybeSingle()

        if (error) throw new Error(error.message)

        return (data as CopyTemplateDTO | null) || null
    }

    static async getAttendanceTemplateByScope(
        scopeType: CopyTemplateScopeType,
        classSessionId?: string
    ): Promise<string | null> {
        const userId = await this.getCurrentUserId()
        if (!userId) return null

        const scopeEntityId = scopeType === 'class_session'
            ? (classSessionId || '')
            : USER_DEFAULT_SCOPE_ENTITY_ID

        if (!scopeEntityId) {
            return null
        }

        const row = await this.getTemplateForScope(userId, 'attendance_copy', scopeType, scopeEntityId)
        return row?.template_text || null
    }

    static async getCourseUserDefaultTemplate(): Promise<string | null> {
        const userId = await this.getCurrentUserId()
        if (!userId) return null

        const row = await this.getTemplateForScope(
            userId,
            'course_copy',
            'user_default',
            USER_DEFAULT_SCOPE_ENTITY_ID
        )

        return row?.template_text || null
    }

    static async getEffectiveAttendanceTemplate(classSessionId: string): Promise<EffectiveTemplateResult> {
        const userId = await this.getCurrentUserId()
        if (userId) {
            const classRow = await this.getTemplateForScope(userId, 'attendance_copy', 'class_session', classSessionId)
            if (classRow?.template_text) {
                return {
                    templateText: classRow.template_text,
                    templateDocument: createTextEditorContent(classRow.template_document || classRow.template_text, { templateVariables: true }).richText,
                    source: 'class_session'
                }
            }
            const userRow = await this.getTemplateForScope(userId, 'attendance_copy', 'user_default', USER_DEFAULT_SCOPE_ENTITY_ID)
            if (userRow?.template_text) {
                return {
                    templateText: userRow.template_text,
                    templateDocument: createTextEditorContent(userRow.template_document || userRow.template_text, { templateVariables: true }).richText,
                    source: 'user_default'
                }
            }
        }

        return {
            templateText: SYSTEM_ATTENDANCE_TEMPLATE,
            source: 'system_default'
        }
    }

    static async getEffectiveCourseTemplate(): Promise<EffectiveTemplateResult> {
        const userId = await this.getCurrentUserId()
        if (userId) {
            const row = await this.getTemplateForScope(userId, 'course_copy', 'user_default', USER_DEFAULT_SCOPE_ENTITY_ID)
            if (row?.template_text) {
                return {
                    templateText: row.template_text,
                    templateDocument: createTextEditorContent(row.template_document || row.template_text, { templateVariables: true }).richText,
                    source: 'user_default'
                }
            }
        }

        return {
            templateText: SYSTEM_COURSE_TEMPLATE,
            source: 'system_default'
        }
    }

    private static async listUserTemplatesByType(
        templateType: 'attendance_copy' | 'course_copy'
    ): Promise<CopyTemplateDTO[]> {
        const userId = await this.getCurrentUserId()
        if (!userId) return []

        const { data, error } = await supabase
            .from('copy_templates')
            .select(COPY_TEMPLATE_COLUMNS)
            .eq('user_id', userId)
            .eq('template_type', templateType)
            .order('updated_at', { ascending: false })

        if (error) throw new Error(error.message)

        return (data as CopyTemplateDTO[]) || []
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
        if (validIds.length === 0) {
            return {}
        }

        const { data, error } = await supabase
            .from('class_sessions')
            .select('id, name')
            .in('id', validIds)

        if (error) throw new Error(error.message)

        const rows = (data || []) as Array<{ id: string; name: string }>
        return Object.fromEntries(rows.map(row => [row.id, row.name]))
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
