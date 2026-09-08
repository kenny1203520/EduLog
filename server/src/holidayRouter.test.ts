import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/holidayRouter.ts'), 'utf8')

describe('holiday API contract', () => {
  it('keeps holiday mutations behind the canonical permission RPC and idempotency', () => {
    expect(source).toContain("has_api_permission")
    expect(source).toContain("teaching.holidays.${action}")
    expect(source).toContain('idempotency(req, 201, null)')
    expect(source).toContain("idempotency(req, 200, null)")
  })

  it('keeps report and teacher attendance side effects explicit', () => {
    expect(source).toContain('updateReports')
    expect(source).toContain('teacher_attendance')
    expect(source).toContain("'/holidays/check'")
  })
})
