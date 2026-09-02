-- Editor security hardening. This migration is additive and must run after 1000036.
-- The canonical report remains the source of truth; Yjs is only a scoped draft.

CREATE OR REPLACE FUNCTION public.can_access_occurrence_report(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        EXISTS (
            SELECT 1
            FROM public.occurrence_reports report
            JOIN public.enrollments enrollment ON enrollment.id = report.enrollment_id
            JOIN public.class_sessions session ON session.id = enrollment.class_session_id
            JOIN public.class_session_teachers assignment ON assignment.class_session_id = session.id
            JOIN public.teachers teacher ON teacher.id = assignment.teacher_id
            WHERE report.id = p_report_id
              AND teacher.user_id = auth.uid()
              AND assignment.effective_from <= CURRENT_DATE
              AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
        )
        OR EXISTS (
            SELECT 1
            FROM public.resolve_user_permission(auth.uid(), 'rbac.manage', NULL, NULL) permission
            WHERE permission.is_allowed
        );
$$;

REVOKE ALL ON FUNCTION public.can_access_occurrence_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_occurrence_report(uuid) TO authenticated;

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.occurrence_reports;
CREATE POLICY "Report editor access is scoped" ON public.occurrence_reports
    FOR ALL TO authenticated
    USING (public.can_access_occurrence_report(id))
    WITH CHECK (public.can_access_occurrence_report(id));

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.report_versions;
CREATE POLICY "Report version access is scoped" ON public.report_versions
    FOR ALL TO authenticated
    USING (public.can_access_occurrence_report(occurrence_report_id))
    WITH CHECK (public.can_access_occurrence_report(occurrence_report_id));

DROP POLICY IF EXISTS "Report collaboration follows occurrence report visibility" ON public.report_collab_docs;
DROP POLICY IF EXISTS "Allow read/write via functions or owners" ON public.report_collab_docs;
CREATE POLICY "Report collaboration access is scoped" ON public.report_collab_docs
    FOR ALL TO authenticated
    USING (public.can_access_occurrence_report(occurrence_report_id))
    WITH CHECK (public.can_access_occurrence_report(occurrence_report_id));

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
    IF p_snapshot_base64 IS NULL
       OR p_snapshot_base64 = ''
       OR length(p_snapshot_base64) > 1398104
       OR p_base_report_version IS NULL
       OR NOT public.can_access_occurrence_report(p_occurrence_report_id) THEN
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

REVOKE ALL ON FUNCTION public.save_report_collab_snapshot(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_report_collab_snapshot(uuid, text, integer) TO authenticated;

ALTER TABLE public.occurrence_reports
    DROP CONSTRAINT IF EXISTS occurrence_reports_external_link_security_check,
    ADD CONSTRAINT occurrence_reports_external_link_security_check
    CHECK (
        external_link IS NULL OR external_link = ''
        OR (
            length(external_link) <= 4096
            AND external_link ~* '^https?://[^[:space:]]+$'
        )
    ) NOT VALID;

ALTER TABLE public.report_collab_docs
    DROP CONSTRAINT IF EXISTS report_collab_docs_snapshot_size_check,
    ADD CONSTRAINT report_collab_docs_snapshot_size_check
    CHECK (length(snapshot_base64) <= 1398104) NOT VALID;

-- Private Realtime channels: only users who can read the report may receive or
-- publish room messages. The CASE avoids casting arbitrary topic names to UUID.
DROP POLICY IF EXISTS "Report editors can receive private room messages" ON realtime.messages;
CREATE POLICY "Report editors can receive private room messages"
    ON realtime.messages FOR SELECT TO authenticated
    USING (
        CASE
            WHEN realtime.topic() ~ '^room:[0-9a-fA-F-]{36}$'
            THEN public.can_access_occurrence_report(split_part(realtime.topic(), ':', 2)::uuid)
            ELSE false
        END
    );

DROP POLICY IF EXISTS "Report editors can publish private room messages" ON realtime.messages;
CREATE POLICY "Report editors can publish private room messages"
    ON realtime.messages FOR INSERT TO authenticated
    WITH CHECK (
        CASE
            WHEN realtime.topic() ~ '^room:[0-9a-fA-F-]{36}$'
            THEN public.can_access_occurrence_report(split_part(realtime.topic(), ':', 2)::uuid)
            ELSE false
        END
    );