BEGIN;

DO $$
BEGIN
  IF to_regclass('public.report_collab_docs') IS NULL
     OR to_regprocedure('public.can_access_report(uuid,text)') IS NULL
     OR to_regprocedure('public.save_report_collab_snapshot(uuid,text,integer)') IS NULL THEN
    RAISE EXCEPTION '1000103 prerequisites missing; apply the report and teaching RBAC migrations first';
  END IF;
END;
$$;

-- Snapshot rows are accessed only through the authenticated report boundary.
-- Explicit table grants are needed by the SECURITY INVOKER RPC; RLS below
-- limits each command to its matching teaching permission.
REVOKE ALL ON public.report_collab_docs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_collab_docs TO authenticated;
GRANT ALL ON public.report_collab_docs TO service_role;

DROP POLICY IF EXISTS "Allow read/write via functions or owners" ON public.report_collab_docs;
DROP POLICY IF EXISTS "Report collaboration follows occurrence report visibility" ON public.report_collab_docs;
DROP POLICY IF EXISTS "Report collaboration access is scoped" ON public.report_collab_docs;
DROP POLICY IF EXISTS "Report collaboration read is scoped" ON public.report_collab_docs;
DROP POLICY IF EXISTS "Report collaboration create is scoped" ON public.report_collab_docs;
DROP POLICY IF EXISTS "Report collaboration update is scoped" ON public.report_collab_docs;
DROP POLICY IF EXISTS "Report collaboration delete is scoped" ON public.report_collab_docs;

CREATE POLICY "Report collaboration read is scoped" ON public.report_collab_docs
  FOR SELECT TO authenticated
  USING (public.can_access_report(occurrence_report_id, 'teaching.reports.read'));

CREATE POLICY "Report collaboration create is scoped" ON public.report_collab_docs
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_report(occurrence_report_id, 'teaching.reports.update'));

CREATE POLICY "Report collaboration update is scoped" ON public.report_collab_docs
  FOR UPDATE TO authenticated
  USING (public.can_access_report(occurrence_report_id, 'teaching.reports.update'))
  WITH CHECK (public.can_access_report(occurrence_report_id, 'teaching.reports.update'));

CREATE POLICY "Report collaboration delete is scoped" ON public.report_collab_docs
  FOR DELETE TO authenticated
  USING (public.can_access_report(occurrence_report_id, 'teaching.reports.delete'));

CREATE OR REPLACE FUNCTION public.save_report_collab_snapshot(
    p_occurrence_report_id uuid,
    p_snapshot_base64 text,
    p_base_report_version integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    saved boolean := false;
BEGIN
    IF auth.uid() IS NULL
       OR p_snapshot_base64 IS NULL
       OR p_snapshot_base64 = ''
       OR length(p_snapshot_base64) > 1398104
       OR p_base_report_version IS NULL
       OR NOT public.can_access_report(p_occurrence_report_id, 'teaching.reports.update') THEN
        RETURN false;
    END IF;

    INSERT INTO public.report_collab_docs (
        occurrence_report_id, snapshot_base64, base_report_version,
        last_updated_by, last_updated_at
    )
    SELECT
        p_occurrence_report_id, p_snapshot_base64, p_base_report_version,
        auth.uid(), timezone('utc'::text, now())
    WHERE EXISTS (
        SELECT 1
        FROM public.occurrence_reports report
        WHERE report.id = p_occurrence_report_id
          AND report.version = p_base_report_version
    )
    ON CONFLICT (occurrence_report_id) DO UPDATE SET
        snapshot_base64 = EXCLUDED.snapshot_base64,
        base_report_version = EXCLUDED.base_report_version,
        last_updated_by = auth.uid(),
        last_updated_at = timezone('utc'::text, now())
    WHERE public.report_collab_docs.base_report_version IS NULL
       OR public.report_collab_docs.base_report_version <= EXCLUDED.base_report_version
    RETURNING true INTO saved;

    RETURN COALESCE(saved, false);
END;
$$;

REVOKE ALL ON FUNCTION public.save_report_collab_snapshot(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_report_collab_snapshot(uuid, text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
