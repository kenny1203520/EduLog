import { describe, expect, it } from 'vitest'
import { computeQuotaBalance, pickEffectivePolicy, quotaWindow, type QuotaPolicyRow } from './quotaBalance.js'

const rows: QuotaPolicyRow[] = [
  { scope: 'default', target_id: null, one_time_total: 10, period: 'none', period_amount: null },
  { scope: 'role', target_id: 'role-teacher', one_time_total: 5, period: 'week', period_amount: 20 },
  { scope: 'role', target_id: 'role-trial', one_time_total: 3, period: 'none', period_amount: null },
  { scope: 'user', target_id: 'user-vip', one_time_total: '100', period: 'month', period_amount: '50' },
]

describe('pickEffectivePolicy', () => {
  it('prefers user overrides, then the most generous role, then the default', () => {
    expect(pickEffectivePolicy(rows, 'user-vip', ['role-teacher'])).toEqual({ oneTimeTotal: 100, period: 'month', periodAmount: 50 })
    expect(pickEffectivePolicy(rows, 'u1', ['role-trial', 'role-teacher'])).toEqual({ oneTimeTotal: 5, period: 'week', periodAmount: 20 })
    expect(pickEffectivePolicy(rows, 'u1', [])).toEqual({ oneTimeTotal: 10, period: 'none', periodAmount: 0 })
    expect(pickEffectivePolicy([], 'u1', [])).toBeNull()
  })
})

describe('quotaWindow', () => {
  it('uses the site time zone and Monday-based weeks', () => {
    // 2026-10-18T17:00Z is Monday 01:00 in Taipei.
    const instant = new Date('2026-10-18T17:00:00Z')
    expect(quotaWindow(instant, 'day', 'Asia/Taipei')).toBe('2026-10-19')
    expect(quotaWindow(instant, 'week', 'Asia/Taipei')).toBe('week:2026-10-19')
    expect(quotaWindow(instant, 'week', 'UTC')).toBe('week:2026-10-12')
    expect(quotaWindow(instant, 'month', 'Asia/Taipei')).toBe('2026-10')
  })
})

describe('computeQuotaBalance', () => {
  const now = new Date('2026-10-21T04:00:00Z')
  const consume = (at: string, delta = -1) => ({ kind: 'consume' as const, delta, created_at: at })

  it('draws from the current period first and overflows into the one-time pool', () => {
    const balance = computeQuotaBalance({ oneTimeTotal: 5, period: 'week', periodAmount: 2 }, [
      consume('2026-10-13T04:00:00Z'), // previous week, within its period allowance
      consume('2026-10-20T04:00:00Z'),
      consume('2026-10-20T05:00:00Z'),
      consume('2026-10-21T01:00:00Z', -2), // period exhausted → one-time
    ], now)
    expect(balance.periodic).toEqual({ limit: 2, used: 2, remaining: 0, window: 'week:2026-10-19' })
    expect(balance.oneTime).toEqual({ total: 5, used: 2, remaining: 3 })
    expect(balance.remaining).toBe(3)
  })

  it('adds grants to the one-time pool and a reset clears one-time usage', () => {
    const balance = computeQuotaBalance({ oneTimeTotal: 2, period: 'none', periodAmount: 0 }, [
      consume('2026-10-01T00:00:00Z', -2),
      { kind: 'reset', delta: 0, created_at: '2026-10-02T00:00:00Z' },
      { kind: 'grant', delta: 3, created_at: '2026-10-03T00:00:00Z' },
      consume('2026-10-04T00:00:00Z', -1.5),
    ], now)
    expect(balance.oneTime).toEqual({ total: 5, used: 1.5, remaining: 3.5 })
    expect(balance.periodic).toBeNull()
  })

  it('has nothing to spend without a policy or grants', () => {
    expect(computeQuotaBalance(null, [], now).remaining).toBe(0)
  })
})
