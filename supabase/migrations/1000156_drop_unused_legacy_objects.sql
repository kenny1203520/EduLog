-- Drop database objects that no code path uses any more.
--
-- * debug_report_access(uuid): a 1000012 diagnostics helper that was still
--   executable by every authenticated user.
-- * grant_admin_access(text): replaced by bootstrap_system_owner
--   (server/src/bin/bootstrapSystemOwner.ts); service-role only since 1000038.
-- * get_dashboard_page(date, date): the dashboard is served by the API's
--   /api/pages/dashboard read model; deprecated since 1000075.
-- * rbac_upsert_classroom_assignment / rbac_delete_classroom_assignment:
--   superseded by the scoped teaching-role RPCs; revoked from every client
--   role in 1000099.
-- * public.documents: the generic Yjs document table from 1000018. Report
--   collaboration uses report_collab_docs; this table has had no reader or
--   writer since 1000043 removed its last policy.
-- * teacher_role_types / incomplete_report_notification_rules: compatibility
--   views over roles and role policies left by 1000027.
--
-- No remaining function, view or policy references these objects. The default
-- RESTRICT behaviour makes the migration fail instead of cascading if one does.

DROP FUNCTION IF EXISTS public.debug_report_access(uuid);
DROP FUNCTION IF EXISTS public.grant_admin_access(text);
DROP FUNCTION IF EXISTS public.get_dashboard_page(date, date);
DROP FUNCTION IF EXISTS public.rbac_upsert_classroom_assignment(uuid, uuid, uuid, uuid, date, date, bigint);
DROP FUNCTION IF EXISTS public.rbac_delete_classroom_assignment(uuid, uuid, bigint);

DROP VIEW IF EXISTS public.teacher_role_types;
DROP VIEW IF EXISTS public.incomplete_report_notification_rules;

DROP TABLE IF EXISTS public.documents;
