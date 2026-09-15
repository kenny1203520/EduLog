import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/aggregateRouter.ts'), 'utf8')

describe('aggregate API contract', () => {
  it('uses the authenticated Supabase client and explicit fields', () => {
    expect(source).toContain('req.db')
    expect(source).toContain("select('id,name,color,address,phone,external_link")
    expect(source).not.toContain("select('*')")
  })

  it('keeps dashboard, reports, preferences and incomplete-report routes available', () => {
    expect(source).toContain("/aggregates/user-preferences")
    expect(source).toContain("/aggregates/student-reports")
    expect(source).toContain("/aggregates/incomplete-reports")
    expect(source).toContain("/aggregates/dashboard")
    expect(source).toContain("router.get('/dashboard', wrap(dashboard))")
  })

  it('keeps nested class session selects balanced for PostgREST', () => {
    expect(source).toContain("class_sessions(id,name,classroom_id,classrooms(id,name)))').eq('attendance_status'")
  })
})
