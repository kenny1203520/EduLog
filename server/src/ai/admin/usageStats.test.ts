import { describe, expect, it } from 'vitest'
import { aggregateUsage, type UsageGenerationRow } from './usageStats.js'

const row = (id: string, overrides: Partial<UsageGenerationRow> = {}): UsageGenerationRow => ({
  id, user_id: 'u1', provider: 'anthropic', model_id: 'sonnet', credential_scope: 'site', status: 'succeeded',
  tokens_in: 100, tokens_out: 50, est_cost: '0.001', quota_charged: '1', ...overrides,
})

describe('aggregateUsage', () => {
  it('totals by user and model with adoption rate and similarity', () => {
    const report = aggregateUsage([
      row('g1'),
      row('g2', { user_id: 'u2', provider: 'ollama', model_id: 'qwen', credential_scope: 'user', est_cost: null, quota_charged: 0 }),
      row('g3', { status: 'failed', tokens_in: null, tokens_out: null, est_cost: null, quota_charged: 0 }),
      row('g4'),
    ], [
      { generation_id: 'g1', final_similarity: '0.9' },
      { generation_id: 'g1', final_similarity: null },
      { generation_id: 'g2', final_similarity: 0.5 },
    ])

    expect(report.totals).toMatchObject({ generations: 4, succeeded: 3, failed: 1, tokensIn: 300, tokensOut: 150, estCost: 0.002, quotaCharged: 2, adopted: 2 })
    expect(report.totals.adoptionRate).toBeCloseTo(2 / 3)
    expect(report.totals.avgFinalSimilarity).toBeCloseTo(0.7)
    expect(report.byUser.map((bucket) => [bucket.key, bucket.generations, bucket.adopted])).toEqual([['u1', 3, 1], ['u2', 1, 1]])
    expect(report.byModel.map((bucket) => bucket.key)).toEqual(['anthropic/sonnet', 'ollama/qwen'])
  })

  it('reports no rates when nothing succeeded', () => {
    const report = aggregateUsage([row('g1', { status: 'cancelled' })], [])
    expect(report.totals.adoptionRate).toBeNull()
    expect(report.totals.avgFinalSimilarity).toBeNull()
  })
})
