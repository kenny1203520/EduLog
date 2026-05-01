export type CopyTemplateType = 'attendance_copy' | 'course_copy'

export type CopyTemplateSource = 'class_session' | 'user_default' | 'system_default'

export type CopyTemplateFormatter = (context: Record<string, string | number | undefined>) => string

export type CopyTemplateFormatterMap = Record<string, Record<string, CopyTemplateFormatter>>

export interface CopyTemplateVariableMode {
    value: string
    label: string
}

export interface CopyTemplateVariableDefinition {
    key: string
    label: string
    description: string
    modes?: CopyTemplateVariableMode[]
    defaultMode?: string
}

export const USER_DEFAULT_SCOPE_ENTITY_ID = 'user_default'

export const ATTENDANCE_TEMPLATE_VARIABLE_DEFINITIONS: CopyTemplateVariableDefinition[] = [
    {
        key: 'class_info_title',
        label: 'class_info_title',
        description: 'class_info_title_description'
    },
    {
        key: 'session_name',
        label: 'session_name',
        description: 'session_name_description'
    },
    {
        key: 'occurrence_date',
        label: 'occurrence_date',
        description: 'occurrence_date_description'
    },
    {
        key: 'start_time',
        label: 'start_time',
        description: 'start_time_description'
    },
    {
        key: 'end_time',
        label: 'end_time',
        description: 'end_time_description'
    },
    {
        key: 'time_range',
        label: 'time_range',
        description: 'time_range_description'
    },
    {
        key: 'present_list_label',
        label: 'present_list_label',
        description: 'present_list_label_description'
    },
    {
        key: 'absent_list_label',
        label: 'absent_list_label',
        description: 'absent_list_label_description'
    },
    {
        key: 'pending_list_label',
        label: 'pending_list_label',
        description: 'pending_list_label_description'
    },
    {
        key: 'present_list',
        label: 'present_list',
        description: 'present_list_description',
        defaultMode: 'comma',
        modes: [
            { value: 'comma', label: 'comma' },
            { value: 'slash', label: 'slash' },
            { value: 'newline', label: 'newline' },
            { value: 'bullet', label: 'bullet' },
            { value: 'space', label: 'space' }
        ]
    },
    {
        key: 'absent_list',
        label: 'absent_list',
        description: 'absent_list_description',
        defaultMode: 'comma',
        modes: [
            { value: 'comma', label: 'comma' },
            { value: 'slash', label: 'slash' },
            { value: 'newline', label: 'newline' },
            { value: 'bullet', label: 'bullet' },
            { value: 'space', label: 'space' }
        ]
    },
    {
        key: 'pending_list',
        label: 'pending_list',
        description: 'pending_list_description',
        defaultMode: 'comma',
        modes: [
            { value: 'comma', label: 'comma' },
            { value: 'slash', label: 'slash' },
            { value: 'newline', label: 'newline' },
            { value: 'bullet', label: 'bullet' },
            { value: 'space', label: 'space' }
        ]
    }
]

export const COURSE_TEMPLATE_VARIABLE_DEFINITIONS: CopyTemplateVariableDefinition[] = [
    {
        key: 'course_name',
        label: 'course_name',
        description: 'course_name_description'
    },
    {
        key: 'course_display_name',
        label: 'course_display_name',
        description: 'course_display_name_description'
    },
    {
        key: 'course_primary_name',
        label: 'course_primary_name',
        description: 'course_primary_name_description',
        defaultMode: 'space',
        modes: [
            { value: 'space', label: 'space' },
            { value: 'slash', label: 'slash' },
            { value: 'newline', label: 'newline' },
            { value: 'bullet', label: 'bullet' }
        ]
    },
    {
        key: 'lesson_label',
        label: 'lesson_label',
        description: 'lesson_label_description'
    },
    {
        key: 'lesson_sequence',
        label: 'lesson_sequence',
        description: 'lesson_sequence_description'
    },
    {
        key: 'lesson_title',
        label: 'lesson_title',
        description: 'lesson_title_description'
    }
]

export const ATTENDANCE_TEMPLATE_VARIABLES = ATTENDANCE_TEMPLATE_VARIABLE_DEFINITIONS.map(item => item.key)

export const COURSE_TEMPLATE_VARIABLES = COURSE_TEMPLATE_VARIABLE_DEFINITIONS.map(item => item.key)

export const SYSTEM_ATTENDANCE_TEMPLATE = `{{class_info_title}}\n{{session_name}} ({{occurrence_date}} {{time_range}})\n\n{{present_list_label}}: {{present_list}}\n{{absent_list_label}}: {{absent_list}}\n{{pending_list_label}}: {{pending_list}}`

export const SYSTEM_COURSE_TEMPLATE = `{{course_primary_name}} {{lesson_label}} {{lesson_sequence}} {{lesson_title}}`

export function formatCopyTemplateToken(variable: string, mode?: string): string {
    return mode ? `{{${variable}|${mode}}}` : `{{${variable}}}`
}

export function renderCopyTemplate(
    template: string,
    context: Record<string, string | number | undefined>,
    formatters: CopyTemplateFormatterMap = {}
): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*([a-zA-Z0-9_]+))?\s*\}\}/g, (_match, key: string, mode?: string) => {
        if (mode && formatters[key]?.[mode]) {
            return formatters[key][mode](context)
        }

        const rawValue = context[key]
        if (rawValue === undefined || rawValue === null) {
            return ''
        }

        return String(rawValue)
    })
}
