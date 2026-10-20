import type { DeidRule } from '../deidentify/customRules.js'
import type { KnownEntity } from '../deidentify/knownEntities.js'
import type { AiProvider } from '../providers/providerRegistry.js'
import type { QuotaLedgerEntry, QuotaPolicyRow } from '../quota/quotaBalance.js'

/** Data access for the AI report assistant; see SupabaseReportAssistRepository. */

export interface AiSettings {
  enabled: boolean
  noticeVersion: number
  defaultModelId: string | null
}

/** Enabled Presidio languages and administrator rules (Settings → AI → De-identification). */
export interface DeidentificationConfig {
  languages: string[]
  rules: DeidRule[]
}

/** A model the user may pick in the panel's source picker. */
export interface ModelSource {
  modelRowId: string
  modelId: string
  displayName: string
  isDefault: boolean
  quotaWeight: number
  priceInputPerMtok: number | null
  priceOutputPerMtok: number | null
  credentialId: string
  credentialScope: 'site' | 'user'
  credentialLabel: string
  provider: AiProvider
}

export interface ResolvedModel extends ModelSource {
  authType: 'api_key' | 'oauth' | 'none'
  secretCiphertext: string | null
  baseUrl: string | null
}

export interface PreviousReportFacts {
  reportId: string
  date: string
  content: string
  participation: number | null
  behavior: number | null
}

/** Raw (not yet de-identified) facts about one report, read with the caller's permissions. */
export interface ReportFacts {
  reportId: string
  enrollmentId: string
  classSessionId: string | null
  occurrenceDate: string
  studentId: string
  studentName: string
  courseName: string
  subject: string | null
  stage: string | null
  lessonTitle: string | null
  progressLetter: string | null
  isCompleted: boolean | null
  attendance: 'pending' | 'present' | 'absent'
  absenceReason: string | null
  participation: number | null
  behavior: number | null
  classNotes: string
  content: string
  previousReports: PreviousReportFacts[]
}

export interface GenerationLogRow {
  occurrence_report_id: string
  user_id: string
  credential_id: string | null
  credential_scope: 'site' | 'user'
  provider: AiProvider
  model_id: string
  prompt_versions: Record<string, string>
  options: Record<string, unknown>
  sanitized_input: Record<string, unknown>
  sanitized_output: Record<string, unknown> | null
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  error_code: string | null
  tokens_in: number | null
  tokens_out: number | null
  est_cost: number | null
  quota_charged: number
  latency_ms: number | null
  session_seq: number
}

export interface StoredGeneration {
  id: string
  userId: string | null
  occurrenceReportId: string | null
  createdAt: string
  sanitizedInput: Record<string, unknown>
  sanitizedOutput: Record<string, unknown> | null
}

/** A generation as listed in the panel's history, with what the teacher did with it. */
export interface HistoryGeneration extends StoredGeneration {
  status: GenerationLogRow['status']
  completedAt: string | null
  provider: string
  modelId: string
  errorCode: string | null
  quotaCharged: number
  suggestionStates: Record<number, 'kept' | 'dismissed'>
  adoptionCount: number
}

export interface ReportAssistRepository {
  getSettings(): Promise<AiSettings>
  /** Enabled languages and enabled rules, read for every request so changes apply at once. */
  loadDeidentificationConfig(): Promise<DeidentificationConfig>
  hasAcknowledgedNotice(userId: string, version: number): Promise<boolean>
  acknowledgeNotice(userId: string, version: number): Promise<void>
  /** Active site models plus the user's own active models. */
  listModelSources(userId: string): Promise<ModelSource[]>
  /** The model with its credential secret, only if the user may use it. */
  resolveModel(modelRowId: string, userId: string): Promise<ResolvedModel | null>
  loadReportFacts(reportId: string): Promise<ReportFacts | null>
  /** Student first, then classmates in the same session, teachers and schools. */
  loadKnownEntities(facts: ReportFacts, userId: string): Promise<KnownEntity[]>
  loadTemplate(templateId: string, userId: string): Promise<string | null>
  /** The active administrator override for a prompt key, if any. */
  getActivePromptOverride(promptKey: string): Promise<{ version: number, body: string } | null>
  loadQuotaInputs(userId: string): Promise<{ policies: QuotaPolicyRow[], roleIds: string[], ledger: QuotaLedgerEntry[] }>
  /** Record a generation as running when it starts; returns its id. */
  startGeneration(row: GenerationLogRow): Promise<string>
  /** Record how a generation ended (succeeded, failed or cancelled). */
  finishGeneration(generationId: string, outcome: Partial<GenerationLogRow>): Promise<void>
  /** Close generations left running by an API restart. */
  failStaleRunning(olderThan: Date): Promise<number>
  chargeQuota(userId: string, generationId: string, amount: number): Promise<void>
  /** The user's own generations on the given reports, newest first. */
  listGenerationsForReports(reportIds: string[], userId: string): Promise<StoredGeneration[]>
  /** Suggestion indexes the user marked as kept, per generation. */
  keptSuggestionIndexes(generationIds: string[]): Promise<Map<string, number[]>>
  getGeneration(generationId: string): Promise<StoredGeneration | null>
  /** The user's generations on one report (any status), newest first. */
  listReportHistory(reportId: string, userId: string, limit: number): Promise<HistoryGeneration[]>
  setSuggestionState(generationId: string, index: number, state: 'kept' | 'dismissed', userId: string): Promise<void>
  insertAdoption(row: { generation_id: string, section_key: string, action: 'insert' | 'replace' | 'copy' | 'adopt_all', sanitized_snapshot: string, adopted_by: string }): Promise<string>
}
