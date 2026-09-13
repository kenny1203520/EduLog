-- Editor report RLS follow-up.
--
-- 1000039 correctly separated INSERT from persisted-report visibility, but it
-- only considered class_session_teachers.  Sessions created by a teacher may
-- legitimately have no assignment row (occurrence generation already falls
-- back to class_sessions.user_id), so that owner must be part of the same
-- editor boundary.  This migration is forward-only and does not weaken the
-- report scope for arbitrary authenticated users.

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
                WHERE report.id = p_report_id
                  AND (
                      session.user_id = auth.uid()
                      OR EXISTS (
                          SELECT 1
                          FROM public.class_session_teachers assignment
                          JOIN public.teachers teacher
                            ON teacher.id = assignment.teacher_id
                          WHERE assignment.class_session_id = occurrence.class_session_id
                            AND teacher.user_id = auth.uid()
                            AND assignment.effective_from <= occurrence.occurrence_date
                            AND (
                                assignment.effective_to IS NULL
                                OR assignment.effective_to >= occurrence.occurrence_date
                            )
                      )
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
    WITH context AS (
        SELECT
            occurrence.id,
            occurrence.class_session_id,
            occurrence.occurrence_date,
            enrollment.id AS enrollment_id
        FROM public.class_occurrences occurrence
        JOIN public.enrollments enrollment ON enrollment.id = p_enrollment_id
        WHERE occurrence.id = p_class_occurrence_id
    ), effective_roster AS (
        SELECT 1
        FROM context
        JOIN public.get_effective_occurrence_enrollment_ids(context.id) roster
          ON roster.enrollment_id = context.enrollment_id
    ), manager AS (
        SELECT 1
        FROM public.resolve_user_permission(auth.uid(), 'rbac.manage', NULL, NULL) permission
        WHERE permission.is_allowed
          AND NOT permission.is_denied
    ), actor AS (
        SELECT 1
        FROM context
        JOIN public.class_sessions session ON session.id = context.class_session_id
        WHERE session.user_id = auth.uid()
           OR EXISTS (
               SELECT 1
               FROM public.class_session_teachers assignment
               JOIN public.teachers teacher ON teacher.id = assignment.teacher_id
               WHERE assignment.class_session_id = context.class_session_id
                 AND teacher.user_id = auth.uid()
                 AND assignment.effective_from <= context.occurrence_date
                 AND (
                     assignment.effective_to IS NULL
                     OR assignment.effective_to >= context.occurrence_date
                 )
           )
    )
    SELECT
        auth.uid() IS NOT NULL
        AND EXISTS (SELECT 1 FROM context)
        AND (
            EXISTS (SELECT 1 FROM manager)
            OR (
                EXISTS (SELECT 1 FROM effective_roster)
                AND EXISTS (SELECT 1 FROM actor)
            )
        );
$$;

REVOKE ALL ON FUNCTION public.can_access_occurrence_report(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_create_occurrence_report(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_occurrence_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_occurrence_report(uuid, uuid) TO authenticated;

-- Keep INSERT key-based and make the report scope explicit for every other
-- operation.  In particular, do not regress to a broad policy whose INSERT
-- checks can_access_occurrence_report only after the row exists.
DROP POLICY IF EXISTS "Report editor read is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor insert is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor update is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor delete is scoped" ON public.occurrence_reports;

CREATE POLICY "Report editor read is scoped" ON public.occurrence_reports
    FOR SELECT TO authenticated
    USING (public.can_access_occurrence_report(id));

CREATE POLICY "Report editor insert is scoped" ON public.occurrence_reports
    FOR INSERT TO authenticated
    WITH CHECK (public.can_create_occurrence_report(enrollment_id, class_occurrence_id));

CREATE POLICY "Report editor update is scoped" ON public.occurrence_reports
    FOR UPDATE TO authenticated
    USING (public.can_access_occurrence_report(id))
    WITH CHECK (public.can_access_occurrence_report(id));

CREATE POLICY "Report editor delete is scoped" ON public.occurrence_reports
    FOR DELETE TO authenticated
    USING (public.can_access_occurrence_report(id));

-- Ensure legacy report policies cannot remain permissive if 1000039 was skipped.
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor access is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.report_versions;
DROP POLICY IF EXISTS "Report version access is scoped" ON public.report_versions;
CREATE POLICY "Report version access is scoped" ON public.report_versions
    FOR ALL TO authenticated
    USING (public.can_access_occurrence_report(occurrence_report_id))
    WITH CHECK (public.can_access_occurrence_report(occurrence_report_id));
DROP POLICY IF EXISTS "Allow read/write via functions or owners" ON public.report_collab_docs;
DROP POLICY IF EXISTS "Report collaboration access is scoped" ON public.report_collab_docs;
CREATE POLICY "Report collaboration access is scoped" ON public.report_collab_docs
    FOR ALL TO authenticated
    USING (public.can_access_occurrence_report(occurrence_report_id))
    WITH CHECK (public.can_access_occurrence_report(occurrence_report_id));
