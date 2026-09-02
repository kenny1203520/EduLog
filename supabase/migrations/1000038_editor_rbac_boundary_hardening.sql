-- Editor security follow-up. Run after 1000037_editor_security_hardening.sql.
-- This migration only closes the RBAC and legacy admin paths that can bypass
-- report-editor visibility; unrelated domain tables remain unchanged here.

CREATE OR REPLACE FUNCTION public.can_manage_editor_rbac()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.resolve_user_permission(auth.uid(), 'rbac.manage', NULL, NULL) decision
        WHERE decision.is_allowed AND NOT decision.is_denied
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_editor_rbac() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_editor_rbac() TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can manage role policies" ON public.role_permission_policies;
CREATE POLICY "Editor admins can manage role policies" ON public.role_permission_policies FOR ALL
    TO authenticated
    USING (public.can_manage_editor_rbac())
    WITH CHECK (public.can_manage_editor_rbac());

DROP POLICY IF EXISTS "Authenticated users can manage role assignments" ON public.user_role_assignments;
CREATE POLICY "Editor admins can manage role assignments" ON public.user_role_assignments FOR ALL
    TO authenticated
    USING (public.can_manage_editor_rbac())
    WITH CHECK (public.can_manage_editor_rbac());

-- The legacy helper grants access to every class session and must never be
-- callable by an arbitrary authenticated browser session.
DO $$
BEGIN
    IF to_regprocedure('public.grant_admin_access(text)') IS NOT NULL THEN
        EXECUTE 'REVOKE EXECUTE ON FUNCTION public.grant_admin_access(text) FROM authenticated';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.grant_admin_access(text) TO service_role';
    END IF;
END $$;
