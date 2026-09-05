-- Fix editor report provisioning under the scoped report policies.
--
-- 1000037 used can_access_occurrence_report(id) as the INSERT WITH CHECK
-- expression.  During an INSERT/UPSERT the row does not exist yet, so that
-- helper necessarily returned false for every otherwise valid teacher.  Keep
-- read/update/delete visibility tied to the persisted report and use a
-- separate, key-based predicate for new rows.

CREATE OR REPLACE FUNCTION public.can_access_occurrence_report(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND (
            EXISTS (
                SELECT 1
                FROM public.occurrence_reports report
                JOIN public.enrollments enrollment
                  ON enrollment.id = report.enrollment_id
                JOIN public.class_occurrences occurrence
                  ON occurrence.id = report.class_occurrence_id
                JOIN public.class_sessions session
                  ON session.id = occurrence.class_session_id
                JOIN public.class_session_teachers assignment
                  ON assignment.class_session_id = occurrence.class_session_id
                JOIN public.teachers teacher
                  ON teacher.id = assignment.teacher_id
                WHERE report.id = p_report_id
                  AND teacher.user_id = auth.uid()
                  AND assignment.effective_from <= occurrence.occurrence_date
                  AND (
                      assignment.effective_to IS NULL
                      OR assignment.effective_to >= occurrence.occurrence_date
                  )
                  AND (
                      enrollment.class_session_id = occurrence.class_session_id
                      OR EXISTS (
                          SELECT 1
                          FROM public.get_effective_occurrence_enrollment_ids(occurrence.id) roster
                          WHERE roster.enrollment_id = report.enrollment_id
                      )
                  )
            )
            OR EXISTS (
                SELECT 1
                FROM public.resolve_user_permission(auth.uid(), 'rbac.manage', NULL, NULL) permission
                WHERE permission.is_allowed
                  AND NOT permission.is_denied
            )
        );
$$;

CREATE OR REPLACE FUNCTION public.can_create_occurrence_report(
    p_enrollment_id uuid,
    p_class_occurrence_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.class_occurrences occurrence
            JOIN public.enrollments enrollment
              ON enrollment.id = p_enrollment_id
            WHERE occurrence.id = p_class_occurrence_id
        )
        AND (
            EXISTS (
                SELECT 1
                FROM public.class_occurrences occurrence
                JOIN public.class_session_teachers assignment
                  ON assignment.class_session_id = occurrence.class_session_id
                JOIN public.teachers teacher
                  ON teacher.id = assignment.teacher_id
                WHERE occurrence.id = p_class_occurrence_id
                  AND teacher.user_id = auth.uid()
                  AND assignment.effective_from <= occurrence.occurrence_date
                  AND (
                      assignment.effective_to IS NULL
                      OR assignment.effective_to >= occurrence.occurrence_date
                  )
                  AND EXISTS (
                      SELECT 1
                      FROM public.get_effective_occurrence_enrollment_ids(occurrence.id) roster
                      WHERE roster.enrollment_id = p_enrollment_id
                  )
            )
            OR EXISTS (
                SELECT 1
                FROM public.resolve_user_permission(auth.uid(), 'rbac.manage', NULL, NULL) permission
                WHERE permission.is_allowed
                  AND NOT permission.is_denied
            )
        );
$$;

REVOKE ALL ON FUNCTION public.can_access_occurrence_report(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_create_occurrence_report(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_occurrence_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_occurrence_report(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor access is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor read is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor insert is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor update is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor delete is scoped" ON public.occurrence_reports;

CREATE POLICY "Report editor read is scoped" ON public.occurrence_reports
    FOR SELECT TO authenticated
    USING (public.can_access_occurrence_report(id));

CREATE POLICY "Report editor insert is scoped" ON public.occurrence_reports
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_create_occurrence_report(enrollment_id, class_occurrence_id)
    );

CREATE POLICY "Report editor update is scoped" ON public.occurrence_reports
    FOR UPDATE TO authenticated
    USING (public.can_access_occurrence_report(id))
    WITH CHECK (public.can_access_occurrence_report(id));

CREATE POLICY "Report editor delete is scoped" ON public.occurrence_reports
    FOR DELETE TO authenticated
    USING (public.can_access_occurrence_report(id));
