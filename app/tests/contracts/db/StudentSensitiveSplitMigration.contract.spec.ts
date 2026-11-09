import { readFileSync as readFileSyncRaw } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Checkouts with CRLF line endings (Windows) must compare like LF ones.
const readFileSync = (path: string) => readFileSyncRaw(path, 'utf8').replace(/\r\n/g, '\n')
const migration = readFileSync(resolve(process.cwd(), '../supabase/migrations/1000162_split_student_sensitive_permissions.sql'))

const sections = ['schools', 'personal', 'contacts', 'credentials'] as const

describe('1000162 student sensitive permission split', () => {
  it('adds a read and update permission for each section', () => {
    for (const section of sections) {
      expect(migration).toContain(`('teaching.student_${section}.read',`)
      expect(migration).toContain(`('teaching.student_${section}.update',`)
    }
  })

  it('maps old grants with the same role, scope and effect, then drops only the student keys', () => {
    for (const section of sections) {
      expect(migration).toContain(`('teaching.students.read_sensitive', 'teaching.student_${section}.read')`)
      expect(migration).toContain(`('teaching.students.update_sensitive', 'teaching.student_${section}.update')`)
    }
    expect(migration).toContain('SELECT DISTINCT policy.role_id, new_permission.id, policy.scope_type, policy.scope_id, policy.effect')
    expect(migration).toContain("WHERE key IN ('teaching.students.read_sensitive', 'teaching.students.update_sensitive');")
    expect(migration).toContain('1000162 must not change teacher sensitive permissions')
  })

  it('accepts only the section keys in the sensitive student helper', () => {
    const helper = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.can_access_sensitive_student'), migration.indexOf('REVOKE ALL ON FUNCTION public.can_access_sensitive_student'))
    for (const section of sections) {
      expect(helper).toContain(`'teaching.student_${section}.read'`)
      expect(helper).toContain(`'teaching.student_${section}.update'`)
    }
    expect(helper).not.toContain('read_sensitive')
    expect(helper).not.toContain('update_sensitive')
  })

  it('protects each child table with its own section', () => {
    for (const [table, section] of [['contacts', 'contacts'], ['schools', 'schools'], ['credentials', 'credentials']] as const) {
      for (const action of ['read', 'create', 'update', 'delete']) {
        expect(migration).toContain(`CREATE POLICY "Canonical student ${table} ${action}" ON public.student_${table}`)
      }
      expect(migration).toContain(`public.can_access_sensitive_student(student_id, 'teaching.student_${section}.read')`)
      expect(migration).toContain(`public.can_access_sensitive_student(student_id, 'teaching.student_${section}.update')`)
    }
  })

  it('keeps the personal RPCs on the personal section and returns personal data only', () => {
    expect(migration).toContain("can_access_sensitive_student(p_student_id, 'teaching.student_personal.read')")
    expect(migration).toContain("can_access_sensitive_student(p_student_id, 'teaching.student_personal.update')")
    expect(migration).toContain("RETURN jsonb_build_object('student', student_row);")
  })

  it('reduces the current-school summary to the grade without school read access', () => {
    expect(migration).toContain("ELSE jsonb_build_object('grade', school.grade)")
    expect(migration).toContain("v_all_schools OR public.can_access_sensitive_student(page_row.id, 'teaching.student_schools.read')")
    expect(migration).toContain("private.student_current_school_summary(student.id, capability.schools_read)")
  })

  it('returns nested per-section capabilities on the profile page', () => {
    for (const section of sections) {
      expect(migration).toContain(`'${section}', jsonb_build_object('read', capability.${section}_read, 'update', capability.${section}_update)`)
    }
    expect(migration).not.toContain("'read_sensitive', public.can_access_sensitive_student")
  })
})
