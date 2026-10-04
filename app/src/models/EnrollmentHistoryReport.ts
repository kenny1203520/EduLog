/** Teaching evidence that has not yet been attached to a scheduled occurrence. */
export interface EnrollmentHistoryReport {
  id: string; enrollment_id: string; report_date: string; version: number
  student_name?: string; course_name?: string; class_name?: string; updated_at: string
  identity_status: 'verified' | 'evidence_only'; linked_report_id: string | null
  source_key: string; source_admission_id: string; source_report_id?: string; external_link?: string
  content?: string; contact_notes?: string; class_notes?: string; attendance_status?: string
  is_completed?: boolean; class_participation?: number; classroom_behavior?: number
  lesson_id?:string;lesson_name?:string;progress_letter?:string
  source_fields: Array<{key: string;label: string;text: string}>
}
export interface HistoryOccurrenceCandidate {
  id: string; class_session_id: string; occurrence_date: string; class_name: string
  start_time?: string; end_time?: string
}
export interface HistoryBindingPreview {
  conflicts: Array<{field: string; before: unknown; after: unknown}>
  patch: Record<string,unknown>; report_id?: string
}
