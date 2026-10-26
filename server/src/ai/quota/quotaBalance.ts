/**
 * Site-credential generation quota (ai_quota_policies + ai_quota_ledger).
 *
 * A policy has a one-time total and/or a periodic amount that resets every
 * day, week (Monday) or month in the site time zone. Each consumption draws
 * from the current period first and overflows into the one-time pool.
 * Generations on a teacher's own credential never touch this quota.
 */

export const QUOTA_PERIODS = ['none', 'day', 'week', 'month'] as const
export type QuotaPeriod = typeof QUOTA_PERIODS[number]

export interface QuotaPolicyRow {
  scope: 'default' | 'role' | 'user'
  target_id: string | null
  one_time_total: number | string | null
  period: QuotaPeriod
  period_amount: number | string | null
}

export interface QuotaPolicy {
  oneTimeTotal: number
  period: QuotaPeriod
  periodAmount: number
}

export interface QuotaLedgerEntry {
  kind: 'grant' | 'consume' | 'reset'
  /** Positive for grants, negative for consumption; ignored for resets. */
  delta: number | string
  created_at: string | Date
}

export interface QuotaBalance {
  policy: QuotaPolicy | null
  periodic: { limit: number, used: number, remaining: number, window: string } | null
  oneTime: { total: number, used: number, remaining: number }
  remaining: number
}

const num = (value: number | string | null | undefined) => (value == null || value === '' ? 0 : Number(value))

function toPolicy(row: QuotaPolicyRow): QuotaPolicy {
  return {
    oneTimeTotal: num(row.one_time_total),
    period: row.period,
    periodAmount: row.period === 'none' ? 0 : num(row.period_amount),
  }
}

/**
 * Pick the policy that applies to a user: a user override wins; otherwise the
 * most generous policy among the user's roles; otherwise the default. `null`
 * means no site quota at all.
 */
export function pickEffectivePolicy(rows: QuotaPolicyRow[], userId: string, roleIds: Iterable<string>): QuotaPolicy | null {
  const user = rows.find((row) => row.scope === 'user' && row.target_id === userId)
  if (user) return toPolicy(user)
  const roles = new Set(roleIds)
  const rolePolicies = rows.filter((row) => row.scope === 'role' && row.target_id && roles.has(row.target_id)).map(toPolicy)
  const initialPolicy = rolePolicies[0]
  if (initialPolicy) {
    return rolePolicies.reduce((best, policy) =>
      policy.oneTimeTotal + policy.periodAmount > best.oneTimeTotal + best.periodAmount ? policy : best, initialPolicy)
  }
  const fallback = rows.find((row) => row.scope === 'default')
  return fallback ? toPolicy(fallback) : null
}

/** Calendar parts of an instant in a time zone. */
function zonedDate(date: Date, timeZone: string): { year: number, month: number, day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Identifies the reset window an instant belongs to, e.g. `2026-10-20`, `week:2026-10-19`, `2026-10`. */
export function quotaWindow(date: Date, period: QuotaPeriod, timeZone: string): string {
  if (period === 'none') return 'none'
  const { year, month, day } = zonedDate(date, timeZone)
  if (period === 'month') return `${year}-${pad(month)}`
  if (period === 'day') return `${year}-${pad(month)}-${pad(day)}`
  // Calendar arithmetic on a UTC date avoids DST effects; Monday starts the week.
  const local = new Date(Date.UTC(year, month - 1, day))
  local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7))
  return `week:${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

/** Compute what a user has left on site credentials right now. */
export function computeQuotaBalance(
  policy: QuotaPolicy | null,
  ledger: QuotaLedgerEntry[],
  now: Date,
  timeZone = 'Asia/Taipei',
): QuotaBalance {
  const entries = ledger
    .map((entry) => ({ ...entry, at: new Date(entry.created_at), amount: num(entry.delta) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())

  const grants = entries.filter((entry) => entry.kind === 'grant').reduce((sum, entry) => sum + entry.amount, 0)
  const total = (policy?.oneTimeTotal ?? 0) + grants
  const hasPeriod = policy !== null && policy.period !== 'none' && policy.periodAmount > 0
  const periodicUsed = new Map<string, number>()
  let oneTimeUsed = 0

  for (const entry of entries) {
    if (entry.kind === 'reset') {
      oneTimeUsed = 0
      continue
    }
    if (entry.kind !== 'consume') continue
    let cost = Math.abs(entry.amount)
    if (hasPeriod) {
      const window = quotaWindow(entry.at, policy.period, timeZone)
      const used = periodicUsed.get(window) ?? 0
      const fromPeriod = Math.min(cost, Math.max(0, policy.periodAmount - used))
      periodicUsed.set(window, used + fromPeriod)
      cost -= fromPeriod
    }
    oneTimeUsed += cost
  }

  const oneTime = { total, used: oneTimeUsed, remaining: Math.max(0, total - oneTimeUsed) }
  let periodic: QuotaBalance['periodic'] = null
  if (hasPeriod) {
    const window = quotaWindow(now, policy.period, timeZone)
    const used = periodicUsed.get(window) ?? 0
    periodic = { limit: policy.periodAmount, used, remaining: Math.max(0, policy.periodAmount - used), window }
  }
  return { policy, periodic, oneTime, remaining: oneTime.remaining + (periodic?.remaining ?? 0) }
}
