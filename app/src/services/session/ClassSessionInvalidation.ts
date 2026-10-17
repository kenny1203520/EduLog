import { DateUtils } from '@/utils/DateUtils'

export interface ClassSessionInvalidation {
  date_from?: unknown
  date_to?: unknown
}

export function parseClassSessionDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const parsed = DateUtils.parseLocalDate(value)
  return parsed && DateUtils.formatLocalDate(parsed) === value ? value : undefined
}

export function invalidationAffectsDate(date: string, invalidation: ClassSessionInvalidation): boolean {
  const rawFrom = invalidation.date_from
  const rawTo = invalidation.date_to
  if (rawFrom == null && rawTo == null) return true

  const from = rawFrom == null ? undefined : parseClassSessionDate(rawFrom)
  const to = rawTo == null ? undefined : parseClassSessionDate(rawTo)
  // Treat malformed scopes as broad invalidations so clients never keep stale data.
  if ((rawFrom != null && !from) || (rawTo != null && !to)) return true
  return (!from || date >= from) && (!to || date <= to)
}
