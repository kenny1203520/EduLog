import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), '../supabase/migrations/1000163_account_approval_and_default_roles.sql'), 'utf8').replace(/\r\n/g, '\n')

describe('account approval migration contract', () => {
    it('starts every new GoTrue account pending, without changing existing ones', () => {
        expect(migration).toContain("CHECK (account_status IN ('active','disabled','pending'))")
        expect(migration).toContain("CASE WHEN TG_OP = 'INSERT' THEN 'pending' ELSE 'active' END")
        expect(migration).not.toMatch(/UPDATE public\.profiles SET account_status\s*=\s*'pending'/)
    })

    it('keeps every review function to the service role', () => {
        for (const fn of ['approve_account(uuid,uuid[],uuid)', 'list_pending_accounts()', 'count_pending_accounts()', 'mark_pending_account_notified(uuid)', 'set_account_default_roles(uuid[],uuid)', 'list_account_approver_emails()']) {
            expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`)
            expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`)
        }
    })

    it('never makes an owner role a default or grants it on approval', () => {
        expect(migration).toContain("RAISE EXCEPTION 'PROTECTED_ROLE_NOT_ALLOWED'")
        expect(migration).toContain('CREATE TRIGGER account_default_roles_not_protected')
    })

    it('approves only pending accounts and grants roles at platform scope', () => {
        expect(migration).toContain("RAISE EXCEPTION 'ACCOUNT_NOT_PENDING'")
        expect(migration).toContain("VALUES (p_user_id, v_role, 'system', NULL, CURRENT_DATE, 'active')")
    })
})
