import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDatabaseError } from '../../http/errors.js'
import type { KnownEntity } from '../deidentify/knownEntities.js'
import type { AiProvider } from '../providers/providerRegistry.js'
import type { QuotaLedgerEntry, QuotaPolicyRow } from '../quota/quotaBalance.js'
import type {
  AiSettings,
  GenerationLogRow,
  ModelSource,
  ReportAssistRepository,
  ReportFacts,
  ResolvedModel,
  StoredGeneration,
} from './reportAssistRepository.js'

/** How many earlier reports feed the prompt. */
export const PREVIOUS_REPORT_LIMIT = 3

// The project's Supabase clients are untyped; rows are shaped by the select lists below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
type DbResult = { data: unknown, error: { code?: string, message?: string } | null }

function unwrap(result: DbResult): Row | null {
  if (result.error) throw mapDatabaseError(result.error)
  return (result.data as Row | null) ?? null
}

function many(result: DbResult): Row[] {
  if (result.error) throw mapDatabaseError(result.error)
  return (result.data as Row[] | null) ?? []
}

const toNumber = (value: unknown): number | null => (value == null || value === '' ? null : Number(value))

interface ModelRow {
  id: string
  model_id: string
  display_name: string
  enabled: boolean
  is_default: boolean
  quota_weight: number | string
  price_input_per_mtok: number | string | null
  price_output_per_mtok: number | string | null
  ai_credentials: {
    id: string
    scope: 'site' | 'user'
    owner_user_id: string | null
    provider: AiProvider
    label: string
    status: string
    auth_type?: 'api_key' | 'oauth' | 'none'
    secret_ciphertext?: string | null
    base_url?: string | null
  } | null
}

const MODEL_FIELDS = 'id,model_id,display_name,enabled,is_default,quota_weight,price_input_per_mtok,price_output_per_mtok'

function toSource(row: ModelRow): ModelSource {
  const credential = row.ai_credentials!
  return {
    modelRowId: row.id,
    modelId: row.model_id,
    displayName: row.display_name,
    isDefault: row.is_default,
    quotaWeight: toNumber(row.quota_weight) ?? 1,
    priceInputPerMtok: toNumber(row.price_input_per_mtok),
    priceOutputPerMtok: toNumber(row.price_output_per_mtok),
    credentialId: credential.id,
    credentialScope: credential.scope,
    credentialLabel: credential.label,
    provider: credential.provider,
  }
}

function usableBy(row: ModelRow, userId: string): boolean {
  const credential = row.ai_credentials
  if (!row.enabled || !credential || credential.status !== 'active') return false
  return credential.scope === 'site' || credential.owner_user_id === userId
}

/**
 * Report facts are read with the caller's client (row-level security applies).
 * AI tables and the names used only for de-identification are read and written
 * with the service-role client; secrets never leave this module unencrypted.
 */
export class SupabaseReportAssistRepository implements ReportAssistRepository {
  constructor(private readonly userDb: SupabaseClient, private readonly adminDb: SupabaseClient) {}

  async getSettings(): Promise<AiSettings> {
    const row = unwrap(await this.adminDb.from('ai_settings').select('enabled,notice_version,default_model_id').eq('id', true).maybeSingle())
    return { enabled: row?.enabled === true, noticeVersion: row?.notice_version ?? 1, defaultModelId: row?.default_model_id ?? null }
  }

  async hasAcknowledgedNotice(userId: string, version: number): Promise<boolean> {
    const row = unwrap(await this.adminDb.from('ai_notice_acknowledgements').select('user_id').eq('user_id', userId).eq('notice_version', version).maybeSingle())
    return row !== null
  }

  async acknowledgeNotice(userId: string, version: number): Promise<void> {
    unwrap(await this.adminDb.from('ai_notice_acknowledgements').upsert({ user_id: userId, notice_version: version }, { onConflict: 'user_id,notice_version', ignoreDuplicates: true }))
  }

  async listModelSources(userId: string): Promise<ModelSource[]> {
    const rows = unwrap(await this.adminDb.from('ai_models')
      .select(`${MODEL_FIELDS},ai_credentials!inner(id,scope,owner_user_id,provider,label,status)`)
      .eq('enabled', true)
      .order('display_name')) as ModelRow[] | null
    return (rows ?? []).filter((row) => usableBy(row, userId)).map(toSource)
  }

  async resolveModel(modelRowId: string, userId: string): Promise<ResolvedModel | null> {
    const row = unwrap(await this.adminDb.from('ai_models')
      .select(`${MODEL_FIELDS},ai_credentials!inner(id,scope,owner_user_id,provider,label,status,auth_type,secret_ciphertext,base_url)`)
      .eq('id', modelRowId)
      .maybeSingle()) as ModelRow | null
    if (!row || !usableBy(row, userId)) return null
    const credential = row.ai_credentials!
    return {
      ...toSource(row),
      authType: credential.auth_type ?? 'api_key',
      secretCiphertext: credential.secret_ciphertext ?? null,
      baseUrl: credential.base_url ?? null,
    }
  }

  async loadReportFacts(reportId: string): Promise<ReportFacts | null> {
    const report = unwrap(await this.userDb.from('occurrence_reports')
      .select('id,enrollment_id,class_occurrence_id,lesson_id,is_completed,progress_letter,attendance_status,absence_reason,class_participation,classroom_behavior,class_notes,content')
      .eq('id', reportId).maybeSingle())
    if (!report) return null
    const [enrollment, occurrence, lesson] = await Promise.all([
      this.userDb.from('enrollments').select('id,student_id,course_id,class_session_id').eq('id', report.enrollment_id).maybeSingle().then(unwrap),
      this.userDb.from('class_occurrences').select('id,occurrence_date').eq('id', report.class_occurrence_id).maybeSingle().then(unwrap),
      report.lesson_id ? this.userDb.from('lessons').select('title').eq('id', report.lesson_id).maybeSingle().then(unwrap) : Promise.resolve(null),
    ])
    if (!enrollment || !occurrence) return null
    const [student, course, previousReports] = await Promise.all([
      this.userDb.from('students').select('id,name').eq('id', enrollment.student_id).maybeSingle().then(unwrap),
      this.userDb.from('courses').select('subject,stage,display_name').eq('id', enrollment.course_id).maybeSingle().then(unwrap),
      this.loadPreviousReports(enrollment.id, report.id, occurrence.occurrence_date),
    ])
    if (!student) return null
    return {
      reportId: report.id,
      enrollmentId: enrollment.id,
      classSessionId: enrollment.class_session_id ?? null,
      occurrenceDate: occurrence.occurrence_date,
      studentId: student.id,
      studentName: student.name,
      courseName: course?.display_name || [course?.subject, course?.stage].filter(Boolean).join(' ') || '',
      subject: course?.subject ?? null,
      stage: course?.stage ?? null,
      lessonTitle: lesson?.title ?? null,
      progressLetter: report.progress_letter ?? null,
      isCompleted: report.is_completed ?? null,
      attendance: report.attendance_status ?? 'pending',
      absenceReason: report.absence_reason ?? null,
      participation: toNumber(report.class_participation),
      behavior: toNumber(report.classroom_behavior),
      classNotes: report.class_notes ?? '',
      content: report.content ?? '',
      previousReports,
    }
  }

  private async loadPreviousReports(enrollmentId: string, reportId: string, beforeDate: string) {
    const rows = many(await this.userDb.from('occurrence_reports')
      .select('id,class_occurrence_id,content,class_participation,classroom_behavior')
      .eq('enrollment_id', enrollmentId).neq('id', reportId))
    const withContent = rows.filter((row) => typeof row.content === 'string' && row.content.trim())
    if (withContent.length === 0) return []
    const occurrences = many(await this.userDb.from('class_occurrences')
      .select('id,occurrence_date').in('id', withContent.map((row) => row.class_occurrence_id)))
    const dates = new Map(occurrences.map((row) => [row.id as string, row.occurrence_date as string]))
    return withContent
      .map((row) => ({ row, date: dates.get(row.class_occurrence_id) }))
      .filter((entry): entry is { row: typeof entry.row, date: string } => typeof entry.date === 'string' && entry.date < beforeDate)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, PREVIOUS_REPORT_LIMIT)
      .map(({ row, date }) => ({
        reportId: row.id,
        date,
        content: row.content,
        participation: toNumber(row.class_participation),
        behavior: toNumber(row.classroom_behavior),
      }))
  }

  async loadKnownEntities(facts: ReportFacts, userId: string): Promise<KnownEntity[]> {
    const entities: KnownEntity[] = [{ id: facts.studentId, kind: 'student', name: facts.studentName }]
    const seen = new Set([facts.studentId])
    const push = (entity: KnownEntity) => {
      if (!entity.name?.trim() || seen.has(entity.id)) return
      seen.add(entity.id)
      entities.push(entity)
    }

    if (facts.classSessionId) {
      const classmates = many(await this.adminDb.from('enrollments').select('student_id').eq('class_session_id', facts.classSessionId))
      const ids = [...new Set(classmates.map((row) => row.student_id as string))].filter((id) => id !== facts.studentId)
      if (ids.length) {
        const students = many(await this.adminDb.from('students').select('id,name').in('id', ids))
        students.forEach((row) => push({ id: row.id, kind: 'student', name: row.name }))
      }
    }

    const report = unwrap(await this.adminDb.from('occurrence_reports').select('class_occurrence_id').eq('id', facts.reportId).maybeSingle())
    const occurrence = report
      ? unwrap(await this.adminDb.from('class_occurrences').select('teacher_ids').eq('id', report.class_occurrence_id).maybeSingle())
      : null
    const sessionTeachers = facts.classSessionId
      ? many(await this.adminDb.from('class_session_teachers').select('teacher_id').eq('class_session_id', facts.classSessionId))
      : []
    // occurrence.teacher_ids holds teacher ids or user ids depending on age; match both.
    const teacherRefs = [...new Set([...(occurrence?.teacher_ids ?? []), ...sessionTeachers.map((row) => row.teacher_id)])] as string[]
    const teacherFilter = [`user_id.eq.${userId}`, ...(teacherRefs.length ? [`id.in.(${teacherRefs.join(',')})`, `user_id.in.(${teacherRefs.join(',')})`] : [])]
    const teachers = many(await this.adminDb.from('teachers').select('id,name').or(teacherFilter.join(',')))
    teachers.forEach((row) => push({ id: row.id, kind: 'teacher', name: row.name }))

    const schools = many(await this.adminDb.from('student_schools').select('id,name').eq('student_id', facts.studentId))
    schools.forEach((row) => push({ id: row.id, kind: 'school', name: row.name }))
    return entities
  }

  async loadTemplate(templateId: string, userId: string): Promise<string | null> {
    const row = unwrap(await this.userDb.from('report_templates').select('content').eq('id', templateId).eq('instructor_id', userId).maybeSingle())
    return row?.content ?? null
  }

  async getActivePromptOverride(promptKey: string): Promise<{ version: number, body: string } | null> {
    const row = unwrap(await this.adminDb.from('ai_prompt_versions').select('version,body')
      .eq('prompt_key', promptKey).eq('source', 'override').eq('is_active', true).maybeSingle())
    return row ? { version: row.version, body: row.body } : null
  }

  async loadQuotaInputs(userId: string): Promise<{ policies: QuotaPolicyRow[], roleIds: string[], ledger: QuotaLedgerEntry[] }> {
    const today = new Date().toISOString().slice(0, 10)
    const [policies, roles, ledger] = await Promise.all([
      this.adminDb.from('ai_quota_policies').select('scope,target_id,one_time_total,period,period_amount').then(many),
      this.adminDb.from('user_role_assignments').select('role_id,effective_from,effective_to').eq('user_id', userId).then(many),
      this.adminDb.from('ai_quota_ledger').select('kind,delta,created_at').eq('user_id', userId).then(many),
    ])
    const roleIds = roles
      .filter((row) => row.effective_from <= today && (row.effective_to == null || row.effective_to >= today))
      .map((row) => row.role_id as string)
    return { policies: policies as QuotaPolicyRow[], roleIds, ledger: ledger as QuotaLedgerEntry[] }
  }

  async insertGeneration(row: GenerationLogRow): Promise<string> {
    const inserted = unwrap(await this.adminDb.from('ai_generations').insert(row).select('id').single())
    return inserted!.id as string
  }

  async chargeQuota(userId: string, generationId: string, amount: number): Promise<void> {
    unwrap(await this.adminDb.from('ai_quota_ledger').insert({ user_id: userId, generation_id: generationId, delta: -amount, kind: 'consume', created_by: userId }))
  }

  async listGenerationsForReports(reportIds: string[], userId: string): Promise<StoredGeneration[]> {
    const rows = many(await this.adminDb.from('ai_generations')
      .select('id,user_id,occurrence_report_id,created_at,sanitized_input,sanitized_output')
      .in('occurrence_report_id', reportIds).eq('user_id', userId).eq('status', 'succeeded')
      .order('created_at', { ascending: false }).limit(20))
    return rows.map(toStored)
  }

  async keptSuggestionIndexes(generationIds: string[]): Promise<Map<string, number[]>> {
    if (generationIds.length === 0) return new Map()
    const rows = many(await this.adminDb.from('ai_teaching_suggestion_states')
      .select('generation_id,suggestion_index').in('generation_id', generationIds).eq('state', 'kept')
      .order('suggestion_index'))
    const kept = new Map<string, number[]>()
    for (const row of rows) kept.set(row.generation_id, [...(kept.get(row.generation_id) ?? []), row.suggestion_index])
    return kept
  }

  async getGeneration(generationId: string): Promise<StoredGeneration | null> {
    const row = unwrap(await this.adminDb.from('ai_generations')
      .select('id,user_id,occurrence_report_id,created_at,sanitized_input,sanitized_output')
      .eq('id', generationId).maybeSingle())
    return row ? toStored(row) : null
  }

  async setSuggestionState(generationId: string, index: number, state: 'kept' | 'dismissed', userId: string): Promise<void> {
    unwrap(await this.adminDb.from('ai_teaching_suggestion_states').upsert(
      { generation_id: generationId, suggestion_index: index, state, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: 'generation_id,suggestion_index' },
    ))
  }

  async insertAdoption(row: { generation_id: string, section_key: string, action: 'insert' | 'replace' | 'copy' | 'adopt_all', sanitized_snapshot: string, adopted_by: string }): Promise<string> {
    const inserted = unwrap(await this.adminDb.from('ai_adoptions').insert(row).select('id').single())
    return inserted!.id as string
  }
}

function toStored(row: Record<string, unknown>): StoredGeneration {
  return {
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    occurrenceReportId: (row.occurrence_report_id as string | null) ?? null,
    createdAt: row.created_at as string,
    sanitizedInput: (row.sanitized_input as Record<string, unknown>) ?? {},
    sanitizedOutput: (row.sanitized_output as Record<string, unknown> | null) ?? null,
  }
}
