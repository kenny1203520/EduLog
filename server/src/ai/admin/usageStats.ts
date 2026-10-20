/** Aggregate ai_generations + ai_adoptions rows into the admin usage report. */

export interface UsageGenerationRow {
  id: string
  user_id: string | null
  provider: string
  model_id: string
  credential_scope: 'site' | 'user'
  status: 'succeeded' | 'failed' | 'cancelled'
  tokens_in: number | null
  tokens_out: number | null
  est_cost: number | string | null
  quota_charged: number | string | null
}

export interface UsageAdoptionRow {
  generation_id: string
  final_similarity: number | string | null
}

export interface UsageBucket {
  key: string
  generations: number
  succeeded: number
  failed: number
  cancelled: number
  tokensIn: number
  tokensOut: number
  estCost: number
  quotaCharged: number
  /** Succeeded generations with at least one adopted section. */
  adopted: number
  adoptionRate: number | null
  /** Mean similarity between adopted AI text and what was finally sent, when measured. */
  avgFinalSimilarity: number | null
}

export interface UsageReport {
  totals: UsageBucket
  byUser: UsageBucket[]
  byModel: UsageBucket[]
}

const toNumber = (value: number | string | null | undefined) => (value == null || value === '' ? 0 : Number(value))

function emptyBucket(key: string): UsageBucket & { similaritySum: number, similarityCount: number } {
  return { key, generations: 0, succeeded: 0, failed: 0, cancelled: 0, tokensIn: 0, tokensOut: 0, estCost: 0, quotaCharged: 0, adopted: 0, adoptionRate: null, avgFinalSimilarity: null, similaritySum: 0, similarityCount: 0 }
}

export function aggregateUsage(generations: UsageGenerationRow[], adoptions: UsageAdoptionRow[]): UsageReport {
  const adoptionsByGeneration = new Map<string, number[]>()
  for (const adoption of adoptions) {
    const list = adoptionsByGeneration.get(adoption.generation_id) ?? []
    if (adoption.final_similarity != null) list.push(toNumber(adoption.final_similarity))
    adoptionsByGeneration.set(adoption.generation_id, list)
  }

  const totals = emptyBucket('all')
  const users = new Map<string, ReturnType<typeof emptyBucket>>()
  const models = new Map<string, ReturnType<typeof emptyBucket>>()
  const bucketFor = (map: Map<string, ReturnType<typeof emptyBucket>>, key: string) => {
    let bucket = map.get(key)
    if (!bucket) { bucket = emptyBucket(key); map.set(key, bucket) }
    return bucket
  }

  for (const row of generations) {
    const targets = [totals, bucketFor(users, row.user_id ?? 'unknown'), bucketFor(models, `${row.provider}/${row.model_id}`)]
    const similarities = adoptionsByGeneration.get(row.id)
    for (const bucket of targets) {
      bucket.generations += 1
      bucket[row.status] += 1
      bucket.tokensIn += row.tokens_in ?? 0
      bucket.tokensOut += row.tokens_out ?? 0
      bucket.estCost += toNumber(row.est_cost)
      bucket.quotaCharged += toNumber(row.quota_charged)
      if (row.status === 'succeeded' && similarities) {
        bucket.adopted += 1
        for (const value of similarities) { bucket.similaritySum += value; bucket.similarityCount += 1 }
      }
    }
  }

  const finish = ({ similaritySum, similarityCount, ...bucket }: ReturnType<typeof emptyBucket>): UsageBucket => ({
    ...bucket,
    estCost: Math.round(bucket.estCost * 1e6) / 1e6,
    adoptionRate: bucket.succeeded ? bucket.adopted / bucket.succeeded : null,
    avgFinalSimilarity: similarityCount ? similaritySum / similarityCount : null,
  })
  const sorted = (map: Map<string, ReturnType<typeof emptyBucket>>) => [...map.values()].map(finish).sort((a, b) => b.generations - a.generations)
  return { totals: finish(totals), byUser: sorted(users), byModel: sorted(models) }
}
