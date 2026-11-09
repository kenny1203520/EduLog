import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { applyListOrder, orderByRelation } from './relationOrder.js'

function orderParams(builder: unknown) {
  const url = (builder as { url: URL }).url
  return { order: url.searchParams.get('order'), embedded: url.searchParams.get('class_occurrences.order') }
}

const client = createClient('http://localhost:54321', 'anon-key', { auth: { persistSession: false } })
const reports = () => client.from('occurrence_reports').select('id,class_occurrences(occurrence_date,actual_start_time,original_start_time)')

describe('relation list ordering', () => {
  it('orders parent report rows by lesson date, newest first, with start-time tie-breaks', () => {
    const params = orderParams(applyListOrder(reports(), 'class_occurrences(occurrence_date)', false))
    expect(params.embedded).toBeNull()
    expect(params.order).toBe('class_occurrences(occurrence_date).desc,class_occurrences(actual_start_time).desc.nullslast,class_occurrences(original_start_time).desc.nullslast')
  })

  it('orders ascending for oldest-first lists', () => {
    expect(orderParams(orderByRelation(reports(), 'class_occurrences', 'occurrence_date', true)).order)
      .toBe('class_occurrences(occurrence_date).asc,class_occurrences(actual_start_time).asc.nullslast,class_occurrences(original_start_time).asc.nullslast')
  })

  it('keeps other relation sorts and plain columns as a single parent order', () => {
    expect(orderParams(applyListOrder(reports(), 'class_occurrences(actual_start_time)', true)).order).toBe('class_occurrences(actual_start_time).asc')
    expect(orderParams(applyListOrder(reports(), 'updated_at', false)).order).toBe('updated_at.desc')
  })
})
