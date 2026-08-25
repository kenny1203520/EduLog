import {
    type CopyTemplateSource
} from '@/utils/copyTemplate'
import { CopyTemplateCommandService } from './CopyTemplateCommandService'
import { CopyTemplateQueryService } from './CopyTemplateQueryService'
import type { RichTextDocumentV1, TextEditorContentInput } from '@/components/common/text-editor/types'

export type CopyTemplateScopeType = 'user_default' | 'class_session'

export interface CopyTemplateDTO {
    id?: string
    user_id: string
    template_type: 'attendance_copy' | 'course_copy'
    scope_type: CopyTemplateScopeType
    scope_entity_id: string
    template_text: string
    template_document?: RichTextDocumentV1 | null
    created_at?: string
    updated_at?: string
}

export interface EffectiveTemplateResult {
    templateText: string
    templateDocument?: RichTextDocumentV1
    source: CopyTemplateSource
}

export interface CopyTemplateEditorBundle {
    options: CopyTemplateLoadOption[]
    current?: CopyTemplateLoadOption
}

export interface CopyTemplateLoadOption {
    key: string
    templateType: 'attendance_copy' | 'course_copy'
    source: CopyTemplateSource
    scopeType: CopyTemplateScopeType | 'system_default'
    scopeEntityId: string
    label: string
    templateText: string
    templateDocument?: RichTextDocumentV1
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

    static async getEditorBundle(
        templateType: 'attendance_copy' | 'course_copy',
        currentClassSessionId?: string
    ): Promise<CopyTemplateEditorBundle> {
        return CopyTemplateQueryService.getEditorBundle(templateType, currentClassSessionId)
    }

    static async getTemplateLoadOptions(
        templateType: 'attendance_copy' | 'course_copy',
        currentClassSessionId?: string
    ): Promise<CopyTemplateLoadOption[]> {
        return CopyTemplateQueryService.getTemplateLoadOptions(templateType, currentClassSessionId)
    }

    static async saveAttendanceTemplateForSession(classSessionId: string, template: TextEditorContentInput): Promise<void> {
        return CopyTemplateCommandService.saveAttendanceTemplateForSession(classSessionId, template)
    }

    static async saveAttendanceTemplateAsUserDefault(template: TextEditorContentInput): Promise<void> {
        return CopyTemplateCommandService.saveAttendanceTemplateAsUserDefault(template)
    }

    static async saveCourseTemplateAsUserDefault(template: TextEditorContentInput): Promise<void> {
        return CopyTemplateCommandService.saveCourseTemplateAsUserDefault(template)
    }
}
