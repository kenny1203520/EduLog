import {
    type CopyTemplateSource
} from '@/utils/copyTemplate'
import { CopyTemplateCommandService } from './CopyTemplateCommandService'
import { CopyTemplateQueryService } from './CopyTemplateQueryService'

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

export interface CopyTemplateLoadOption {
    key: string
    templateType: 'attendance_copy' | 'course_copy'
    source: CopyTemplateSource
    scopeType: CopyTemplateScopeType | 'system_default'
    scopeEntityId: string
    label: string
    templateText: string
    updatedAt?: string
}

/**
 * Backward-compatible facade for copy template operations.
 * Internal responsibilities are split into command/query services.
 */
export class CopyTemplateService {
    static async getAttendanceTemplateByScope(
        scopeType: CopyTemplateScopeType,
        classSessionId?: string
    ): Promise<string | null> {
        return CopyTemplateQueryService.getAttendanceTemplateByScope(scopeType, classSessionId)
    }

    static async getCourseUserDefaultTemplate(): Promise<string | null> {
        return CopyTemplateQueryService.getCourseUserDefaultTemplate()
    }

    static async getEffectiveAttendanceTemplate(classSessionId: string): Promise<EffectiveTemplateResult> {
        return CopyTemplateQueryService.getEffectiveAttendanceTemplate(classSessionId)
    }

    static async getEffectiveCourseTemplate(): Promise<EffectiveTemplateResult> {
        return CopyTemplateQueryService.getEffectiveCourseTemplate()
    }

    static async getTemplateLoadOptions(
        templateType: 'attendance_copy' | 'course_copy',
        currentClassSessionId?: string
    ): Promise<CopyTemplateLoadOption[]> {
        return CopyTemplateQueryService.getTemplateLoadOptions(templateType, currentClassSessionId)
    }

    static async saveAttendanceTemplateForSession(classSessionId: string, templateText: string): Promise<void> {
        return CopyTemplateCommandService.saveAttendanceTemplateForSession(classSessionId, templateText)
    }

    static async saveAttendanceTemplateAsUserDefault(templateText: string): Promise<void> {
        return CopyTemplateCommandService.saveAttendanceTemplateAsUserDefault(templateText)
    }

    static async saveCourseTemplateAsUserDefault(templateText: string): Promise<void> {
        return CopyTemplateCommandService.saveCourseTemplateAsUserDefault(templateText)
    }
}
