-- Evaluate auth.uid() once per statement in the web-extension owner policies.
--
-- The Supabase linter (0003 auth_rls_initplan) flagged these policies for
-- calling auth.uid() per row. Wrapping it in a scalar subquery lets Postgres
-- run it once as an InitPlan. The rule is unchanged. The tables are reached
-- only through service_role RPCs today, so this is defence in depth.
--
-- Rerunnable.

BEGIN;

ALTER POLICY web_extension_sync_field_preferences_self ON public.web_extension_sync_field_preferences
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
ALTER POLICY web_extension_work_record_metadata_self ON public.web_extension_work_record_metadata
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
ALTER POLICY web_extension_work_record_rounds_self ON public.web_extension_work_record_rounds
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
ALTER POLICY web_extension_report_skip_decisions_self ON public.web_extension_report_skip_decisions
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

COMMIT;
