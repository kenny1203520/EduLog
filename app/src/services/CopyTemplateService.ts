import { supabase } from '@/lib/supabase'
import {
    USER_DEFAULT_SCOPE_ENTITY_ID,
    SYSTEM_ATTENDANCE_TEMPLATE,
    SYSTEM_COURSE_TEMPLATE,
    type CopyTemplateSource
} from '@/utils/copyTemplate'

export type CopyTemplateScopeType = 'user_default' | 'class_session'

export interface CopyTemplateDTO {
    id?: string
    user_id: string
    template_type: 'attendance_copy' | 'course_copy'
    scope_type: CopyTemplateScopeType
    scope_entity_id: string
    template_text: string
    created_at?: string
    updated_at?: string
}

export interface EffectiveTemplateResult {
    templateText: string
    source: CopyTemplateSource
}

export class CopyTemplateService {
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
            .select('*')
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
        const classTemplate = await this.getAttendanceTemplateByScope('class_session', classSessionId)
        if (classTemplate) {
            return {
                templateText: classTemplate,
                source: 'class_session'
            }
        }

        const userDefault = await this.getAttendanceTemplateByScope('user_default')
        if (userDefault) {
            return {
                templateText: userDefault,
                source: 'user_default'
            }
        }

        return {
            templateText: SYSTEM_ATTENDANCE_TEMPLATE,
            source: 'system_default'
        }
    }

    static async getEffectiveCourseTemplate(): Promise<EffectiveTemplateResult> {
        const userDefault = await this.getCourseUserDefaultTemplate()
        if (userDefault) {
            return {
                templateText: userDefault,
                source: 'user_default'
            }
        }

        return {
            templateText: SYSTEM_COURSE_TEMPLATE,
            source: 'system_default'
        }
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
