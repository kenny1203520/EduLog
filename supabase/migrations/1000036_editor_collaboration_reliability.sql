-- Keep collaboration snapshots from locking the canonical report row.
-- occurrence_reports.version remains the authoritative optimistic-concurrency guard.

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
    IF p_snapshot_base64 IS NULL OR p_snapshot_base64 = '' OR p_base_report_version IS NULL THEN
        RETURN false;
    END IF;

    INSERT INTO public.report_collab_docs (
        occurrence_report_id,
        snapshot_base64,
        base_report_version,
        last_updated_by,
        last_updated_at
    )
    SELECT
        p_occurrence_report_id,
        p_snapshot_base64,
        p_base_report_version,
        auth.uid(),
        timezone('utc'::text, now())
    WHERE EXISTS (
        SELECT 1
        FROM public.occurrence_reports report
        WHERE report.id = p_occurrence_report_id
          AND report.version = p_base_report_version
    )
    ON CONFLICT (occurrence_report_id) DO UPDATE SET
        snapshot_base64 = EXCLUDED.snapshot_base64,
        base_report_version = EXCLUDED.base_report_version,
        last_updated_by = EXCLUDED.last_updated_by,
        last_updated_at = EXCLUDED.last_updated_at
    WHERE public.report_collab_docs.base_report_version IS NULL
       OR public.report_collab_docs.base_report_version <= EXCLUDED.base_report_version
    RETURNING true INTO saved;

    RETURN COALESCE(saved, false);
END;
$$;

REVOKE ALL ON FUNCTION public.save_report_collab_snapshot(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_report_collab_snapshot(uuid, text, integer) TO authenticated;

DROP POLICY IF EXISTS "Allow read/write via functions or owners" ON public.report_collab_docs;
CREATE POLICY "Report collaboration follows occurrence report visibility"
    ON public.report_collab_docs
    FOR ALL
    USING (
        (SELECT auth.role()) = 'authenticated'
        AND EXISTS (
            SELECT 1
            FROM public.occurrence_reports report
            WHERE report.id = report_collab_docs.occurrence_report_id
        )
    )
    WITH CHECK (
        (SELECT auth.role()) = 'authenticated'
        AND EXISTS (
            SELECT 1
            FROM public.occurrence_reports report
            WHERE report.id = report_collab_docs.occurrence_report_id
        )
    );
