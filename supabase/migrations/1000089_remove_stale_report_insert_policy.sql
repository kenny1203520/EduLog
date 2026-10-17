-- 1000089: remove the stale all-operation report policy.
--
-- 1000037 introduced an ALL policy whose INSERT WITH CHECK evaluated
-- can_access_occurrence_report(id).  A generated report id is not visible
-- before INSERT, so that historical policy can reject a legitimate insert
-- even when the canonical INSERT policy allows it.

DO $$
BEGIN
  IF to_regclass('public.occurrence_reports') IS NULL THEN
    RAISE EXCEPTION '1000089 prerequisites missing; apply migrations through 1000088 first';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Report editor access is scoped" ON public.occurrence_reports;

NOTIFY pgrst, 'reload schema';
