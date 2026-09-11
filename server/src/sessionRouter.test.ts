import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('class session API contract', () => {
  it('uses the guarded schedule RPC and explicit mutation contract', () => {
    const source = readFileSync(new URL('./sessionRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("rpc('has_api_permission'")
    expect(source).toContain("teaching.class_sessions.${action}")
    expect(source).toContain("rpc('save_class_session_with_schedule'")
    expect(source).toContain('authorizeSaveScope')
    expect(source).toContain('Schedule rule kind must match schedule_mode')
    expect(source).toContain('idempotency(req')
    expect(source.indexOf("rpc('has_api_permission'")).toBeLessThan(source.indexOf('const replay'))
  })

  it('does not trust client ownership fields or expose wildcard selects', () => {
    const source = readFileSync(new URL('./sessionRouter.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('select(\'*\')')
    expect(source).not.toContain('p_session: { ...req.body')
  })
})
