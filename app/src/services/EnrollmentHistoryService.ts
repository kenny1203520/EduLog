import { apiV1Client } from './api/ApiV1Client'
import type { EnrollmentHistoryReport, HistoryOccurrenceCandidate, HistoryBindingPreview } from '@/models/EnrollmentHistoryReport'

type EnrollmentHistoryOperation = 'list'|'candidates'|'bind-preview'|'bind-apply'

export class EnrollmentHistoryService {
  private static async invoke<T>(operation: EnrollmentHistoryOperation, input: Record<string,unknown>): Promise<T> {
    return (await apiV1Client.post<T>(`/enrollment-history/${operation}`, input)).data
  }
  /** Read one permission-scoped page, excluding histories already shown as occurrence reports. */
  static list(scope: {student_id?: string;enrollment_id?: string}, cursor?: string) {
    return this.invoke<{items: EnrollmentHistoryReport[];next_cursor: string | null}>('list',{...scope,cursor,limit:50,unlinked_only:true})
  }
  /** Find date-matched occurrences for which this enrollment is on the effective roster. */
  static candidates(historyId: string, cursor?: string) {
    return this.invoke<{items: HistoryOccurrenceCandidate[];next_cursor: string | null}>('candidates',{history_id:historyId,cursor,limit:50})
  }
  /** Preview or commit a version-checked binding; preserve nonempty fields unless explicitly selected. */
  static bind(operation: 'bind-preview'|'bind-apply', report: EnrollmentHistoryReport, occurrenceId: string, key: string, overwrite: string[], includeInternal: boolean) {
    return this.invoke<HistoryBindingPreview & {report_id?:string}>(operation,{history_id:report.id,history_version:report.version,class_occurrence_id:occurrenceId,key,overwrite,include_internal:includeInternal})
  }
}
