import { readFileSync as readFileSyncRaw } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Checkouts with CRLF line endings (Windows) must compare like LF ones.
const readFileSync = (path: string) => readFileSyncRaw(path, 'utf8').replace(/\r\n/g, '\n')
const migration = readFileSync(resolve(process.cwd(), '../supabase/migrations/1000161_page_access_permissions_and_member_role.sql'))
const integration = readFileSync(resolve(process.cwd(), '../supabase/tests/member_role_integration.sql'))

const pages = ['dashboard', 'students', 'courses', 'classrooms', 'holidays', 'reports']

describe('1000161 page access permissions and member role', () => {
  it('adds one access permission per basic page and none for teachers or settings', () => {
    for (const page of pages) {
      expect(migration).toContain(`('teaching.${page}.access',`)
    }
    expect(migration).not.toContain('teaching.teachers.access')
    expect(migration).not.toContain('teaching.settings.access')
  })

  it('creates the built-in member role with only the access grants at platform scope', () => {
    expect(migration).toContain("VALUES ('member', 'Member',")
    expect(migration).toContain("'teaching', NULL, true, false)")
    expect(migration).toMatch(/SELECT role\.id, permission\.id, 'system', NULL, 'allow'\nFROM public\.roles role\nJOIN public\.permissions permission ON permission\.key IN \(/)
    expect(migration).toContain('member role must hold exactly the six page access permissions')
  })

  it('does not assign or backfill the member role', () => {
    expect(migration).not.toContain('user_role_assignments')
  })

  it('copies list allows to access on the same scope, with the dashboard following reports.list', () => {
    expect(migration).toContain("('teaching.dashboard.access', 'teaching.reports.list')")
    expect(migration).toContain("('teaching.students.access', 'teaching.students.list')")
    expect(migration).toContain("SELECT DISTINCT policy.role_id, access_permission.id, policy.scope_type, policy.scope_id, 'allow'")
    expect(migration).toContain("ON policy.permission_id = list_permission.id AND policy.effect = 'allow'")
  })

  it('reports the access keys in the navigation capability summary', () => {
    const keys = migration.slice(migration.indexOf('v_keys text[] := ARRAY['), migration.indexOf('];'))
    for (const page of pages) expect(keys).toContain(`'teaching.${page}.access'`)
    expect(keys).toContain("'teaching.teachers.list'")
  })

  it('is guarded and rerunnable', () => {
    expect(migration).toContain('1000161 prerequisites missing')
    expect(migration).toContain('ON CONFLICT (key) DO UPDATE')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_my_teaching_capabilities()')
  })

  it('has an integration test for member-only and member plus classroom teacher users', () => {
    expect(integration).toContain('member students overview must be empty')
    expect(integration).toContain('classrooms overview not limited to classroom two')
    expect(integration).toContain('ROLLBACK;')
  })
})
