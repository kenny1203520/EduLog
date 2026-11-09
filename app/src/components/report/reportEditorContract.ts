import type { Lesson } from '@/models/Course'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import type { RichTextDocumentV1, TextEditorMetrics } from '@/components/text-editor/types'
import type { EditorNotification } from '@/components/text-editor/notifier'
import type { SourceReportIdentity } from '@/utils/sourceReportLink'

/** ReportEditor's props, shared with the composables that run its logic. */
export interface ReportEditorProps {
    reportId?: string // 報告ID
    initialVersion?: number // 報告版本
    loading?: boolean // 是否載入中
    placeholder?: string // 報告預設文字
    disabled?: boolean // 是否禁用
    showManualSave?: boolean // 是否顯示手動儲存
    debounceMs?: number // 停止輸入後多久自動儲存(ms)
    enrollmentId?: string // 課程報名ID
    classOccurrenceId?: string // 課堂上課日期時間ID
    title?: string // 報告標題
    courseName?: string // 課程名稱
    courseStage?: string // 課程階段
    courseDisplayName?: string // 課程顯示名稱
    initialClassroomName?: string // 教室名稱
    initialSessionName?: string // 班級名稱
    initialSessionTime?: string // 班級時段
    initialStudentName?: string // 學生姓名
    initialStudentId?: string // 學生ID
    student?: any // 學生
    initialLessonId?: string // 課次
    availableLessons?: Lesson[] // 可選課次清單
    initialReportExternalLink?: string // 外部連結
    initialIsCompleted?: boolean // 是否完整完成
    initialProgressStart?: string // 進度開始
    initialProgressEnd?: string // 進度結束
    initialAttendanceStatus?: 'present' | 'absent' | 'pending' // 出缺勤狀態
    initialAbsenceReason?: string // 缺勤原因
    initialClassParticipation?: number | null // 課堂參與
    initialClassroomBehavior?: number | null // 課堂秩序
    initialContactNotes?: string // 聯絡欄
    initialContactNotesDocument?: RichTextDocumentV1 | null
    initialClassNotes?: string // 課堂筆記/紀錄
    initialClassNotesDocument?: RichTextDocumentV1 | null
    initialContent?: string // 學習報告
    initialContentDocument?: RichTextDocumentV1 | null
    autoSaveEnabled?: boolean
    collaborationEnabled?: boolean
    notificationsEnabled?: boolean
    initialEnrollmentExternalLink?: string // 課程外部連結
    sourceIdentity?: SourceReportIdentity | null // 匯入報告的原站身分
    initialCreatedAt?: string // 建立時間
    compact?: boolean // 緊湊模式：擴充功能側邊欄中只保留要填寫的內容
}

/** Props that ReportEditor's withDefaults always fills in. */
type DefaultedProp =
    | 'initialVersion' | 'loading' | 'placeholder' | 'disabled' | 'showManualSave' | 'debounceMs'
    | 'courseName' | 'courseStage' | 'courseDisplayName' | 'initialClassroomName' | 'initialSessionName'
    | 'initialSessionTime' | 'initialStudentName' | 'initialStudentId' | 'initialLessonId' | 'availableLessons'
    | 'initialReportExternalLink' | 'initialIsCompleted' | 'initialAttendanceStatus'
    | 'initialClassParticipation' | 'initialClassroomBehavior' | 'initialContactNotes' | 'initialContactNotesDocument'
    | 'initialClassNotes' | 'initialClassNotesDocument' | 'initialContent' | 'initialContentDocument'
    | 'initialEnrollmentExternalLink' | 'sourceIdentity' | 'initialCreatedAt' | 'compact'

export type ResolvedReportEditorProps = Readonly<ReportEditorProps & Required<Pick<ReportEditorProps, DefaultedProp>>>

export type ReportEditorMetrics = Record<'content' | 'contactNotes' | 'classNotes' | 'total', TextEditorMetrics>

export type ReportEditorEmits = {
    'update:content': [content: string]
    'save-success': [report: OccurrenceReportDTO]
    'update:report-external-link': [value: string]
    'save-error': [error: string]
    'conflict': [serverReport: OccurrenceReportDTO, localReport: OccurrenceReportDTO]
    'deleted': []
    'restored': [report: OccurrenceReportDTO]
    'notification': [notification: EditorNotification]
    'metrics-change': [metrics: ReportEditorMetrics]
}

export type ReportEditorEmit = <K extends keyof ReportEditorEmits>(event: K, ...args: ReportEditorEmits[K]) => void
