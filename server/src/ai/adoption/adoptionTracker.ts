import type { SupabaseClient } from '@supabase/supabase-js'
import DiffMatchPatch from 'diff-match-patch'
import { PlaceholderMap } from '../deidentify/placeholders.js'

/**
 * How much of the adopted AI text survives in the report the teacher finally
 * saves or pushes to the company site (ai_adoptions.final_similarity).
 *
 * Snapshots are de-identified, so they are restored the way the panel showed
 * the parent-facing text (classmates as 同學) before being compared.
 */

export type MeasurementSource = 'save' | 'push'

/** Whitespace and line breaks change freely in the editor; compare text only. */
function compact(text: string): string {
  return text.replace(/\s+/g, '')
}

/**
 * Share of the adopted text that is still present in the final report, from
 * 0 (all rewritten or deleted) to 1 (kept verbatim). Text the teacher added
 * around it does not lower the score.
 */
export function retainedRatio(adopted: string, final: string): number {
  const source = compact(adopted)
  if (!source) return 1
  const dmp = new DiffMatchPatch()
  const diffs = dmp.diff_main(source, compact(final))
  dmp.diff_cleanupSemantic(diffs)
  const kept = diffs.reduce((sum, [operation, text]) => sum + (operation === DiffMatchPatch.DIFF_EQUAL ? text.length : 0), 0)
  return Math.round((kept / source.length) * 10_000) / 10_000
}

export interface AdoptionRow {
  id: string
  sanitized_snapshot: string
  measured_from: MeasurementSource | null
  knownRefs: Record<string, string>
}

export interface EntityNames {
  studentId: string
  students: Map<string, string>
  others: Map<string, string>
}

/** Restore a snapshot as the parent-facing text was shown: classmates as 同學, contact tokens left as-is. */
export function restoreSnapshot(snapshot: string, knownRefs: Record<string, string>, names: EntityNames): string {
  const displays: Record<string, string> = {}
  for (const [token, id] of Object.entries(knownRefs)) {
    if (token.startsWith('[學生')) displays[token] = id === names.studentId ? names.students.get(id) ?? token : '同學'
    else if (names.others.has(id)) displays[token] = names.others.get(id)!
  }
  return PlaceholderMap.fromDisplays(displays).restore(snapshot).text
}

/** Decide new measurements; a push result is final and never replaced by a later save. */
export function computeMeasurements(rows: AdoptionRow[], finalContent: string, names: EntityNames, source: MeasurementSource) {
  return rows
    .filter((row) => source === 'push' || row.measured_from !== 'push')
    .map((row) => ({ id: row.id, final_similarity: retainedRatio(restoreSnapshot(row.sanitized_snapshot, row.knownRefs, names), finalContent) }))
}

/**
 * Re-measure every adoption of a report against its current content. Cheap
 * when the report never used AI: one query that returns nothing.
 */
export async function measureReportAdoptions(db: SupabaseClient, reportId: string, source: MeasurementSource): Promise<number> {
  const adoptions = await db.from('ai_adoptions')
    .select('id,sanitized_snapshot,measured_from,ai_generations!inner(occurrence_report_id,sanitized_input)')
    .eq('ai_generations.occurrence_report_id', reportId)
  if (adoptions.error) throw adoptions.error
  const rows = (adoptions.data ?? []) as unknown as Array<{ id: string, sanitized_snapshot: string, measured_from: MeasurementSource | null, ai_generations: { sanitized_input: Record<string, unknown> } }>
  if (rows.length === 0) return 0

  const report = await db.from('occurrence_reports').select('content,enrollment_id').eq('id', reportId).maybeSingle()
  if (report.error) throw report.error
  if (!report.data) return 0
  const enrollment = await db.from('enrollments').select('student_id').eq('id', report.data.enrollment_id).maybeSingle()
  if (enrollment.error) throw enrollment.error

  const adoptionRows: AdoptionRow[] = rows.map((row) => ({
    id: row.id,
    sanitized_snapshot: row.sanitized_snapshot,
    measured_from: row.measured_from,
    knownRefs: (row.ai_generations.sanitized_input?.known_refs ?? {}) as Record<string, string>,
  }))
  const ids = [...new Set(adoptionRows.flatMap((row) => Object.values(row.knownRefs)))]
  const [students, teachers, schools] = await Promise.all([
    db.from('students').select('id,name').in('id', ids),
    db.from('teachers').select('id,name').in('id', ids),
    db.from('student_schools').select('id,name').in('id', ids),
  ])
  for (const result of [students, teachers, schools]) if (result.error) throw result.error
  const names: EntityNames = {
    studentId: enrollment.data?.student_id ?? '',
    students: new Map((students.data ?? []).map((row) => [row.id as string, row.name as string])),
    others: new Map([...(teachers.data ?? []), ...(schools.data ?? [])].map((row) => [row.id as string, row.name as string])),
  }

  const measuredAt = new Date().toISOString()
  const updates = computeMeasurements(adoptionRows, report.data.content ?? '', names, source)
  for (const update of updates) {
    const result = await db.from('ai_adoptions')
      .update({ final_similarity: update.final_similarity, measured_from: source, measured_at: measuredAt })
      .eq('id', update.id)
    if (result.error) throw result.error
  }
  return updates.length
}
