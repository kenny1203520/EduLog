import { createClient } from '@supabase/supabase-js'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('round-trips a linked enrollment through the real Supabase client and PostgreSQL JSONB', async () => {
  const db = new PGlite()
  const entry = { enrollment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  try {
    const client = createClient('http://example.test', 'test', {
      global: { fetch: async input => {
        const filter = new URL(String(input)).searchParams.get('lesson_entries')!.slice(3)
        try {
          const { rows } = await db.query('SELECT 1 AS id WHERE $1::jsonb @> $2::jsonb', [JSON.stringify([entry]), filter])
          return Response.json(rows)
        } catch (error) {
          return Response.json({ code: (error as { code: string }).code }, { status: 400 })
        }
      } },
    })
    const broken = await client.from('occurrence_reports').select('id').contains('lesson_entries', [entry])
    expect(broken.error?.code).toBe('22P02')
    const fixed = await client.from('occurrence_reports').select('id').contains('lesson_entries', JSON.stringify([entry]))
    expect(fixed.data).toEqual([{ id: 1 }])
  } finally { await db.close() }
})
