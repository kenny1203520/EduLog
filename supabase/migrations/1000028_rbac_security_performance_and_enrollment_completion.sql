-- v1.7.1 security, performance, and enrollment lifecycle corrections.
-- This migration is forward-only and assumes 1000027 has already introduced the RBAC tables.

CREATE OR REPLACE VIEW public.teacher_role_types
WITH (security_invoker = true)
AS
SELECT *
FROM public.roles;

CREATE OR REPLACE VIEW public.incomplete_report_notification_rules
WITH (security_invoker = true)
AS
SELECT policy.id,
       CASE policy.scope_type WHEN 'system' THEN 'global' ELSE policy.scope_type END AS scope_type,
       CASE WHEN policy.scope_type = 'classroom' THEN policy.scope_id END AS classroom_id,
       CASE WHEN policy.scope_type = 'class_session' THEN policy.scope_id END AS class_session_id,
       policy.role_id AS role_type_id,
       policy.created_at,
       policy.updated_at
FROM public.role_permission_policies AS policy
JOIN public.permissions AS permission
  ON permission.id = policy.permission_id
WHERE permission.key = 'reports.incomplete.receive'
  AND policy.effect = 'allow';

CREATE OR REPLACE FUNCTION public.set_default_class_session_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.role_id IS NULL THEN
        SELECT role.id
        INTO NEW.role_id
        FROM public.roles AS role
        WHERE role.code = 'teacher';
    END IF;
    RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS public.idx_class_session_teachers_role_type_id;
DROP INDEX IF EXISTS public.teacher_role_types_code_unique;
DROP INDEX IF EXISTS public.teacher_role_types_name_unique;

CREATE OR REPLACE FUNCTION public.complete_enrollment_from_final_attended_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.attendance_status = 'present'
       AND NEW.is_completed IS TRUE
       AND NEW.lesson_id IS NOT NULL THEN
        UPDATE public.enrollments AS enrollment
        SET status = 'completed'
        WHERE enrollment.id = NEW.enrollment_id
          AND enrollment.status = 'regular'
          AND EXISTS (
              SELECT 1
              FROM public.lessons AS current_lesson
              WHERE current_lesson.id = NEW.lesson_id
                AND current_lesson.course_id = enrollment.course_id
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.lessons AS later_lesson
                    WHERE later_lesson.course_id = enrollment.course_id
                      AND later_lesson.sequence > current_lesson.sequence
                )
          );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS complete_enrollment_from_final_attended_report
ON public.occurrence_reports;

CREATE TRIGGER complete_enrollment_from_final_attended_report
AFTER INSERT OR UPDATE OF attendance_status, is_completed, lesson_id
ON public.occurrence_reports
FOR EACH ROW
EXECUTE FUNCTION public.complete_enrollment_from_final_attended_report();

-- Reconcile records saved before this trigger existed without downgrading completed enrollments.
UPDATE public.enrollments AS enrollment
SET status = 'completed'
WHERE enrollment.status = 'regular'
  AND EXISTS (
      SELECT 1
      FROM public.occurrence_reports AS report
      JOIN public.lessons AS current_lesson
        ON current_lesson.id = report.lesson_id
      WHERE report.enrollment_id = enrollment.id
        AND report.attendance_status = 'present'
        AND report.is_completed IS TRUE
        AND current_lesson.course_id = enrollment.course_id
        AND NOT EXISTS (
            SELECT 1
            FROM public.lessons AS later_lesson
            WHERE later_lesson.course_id = enrollment.course_id
              AND later_lesson.sequence > current_lesson.sequence
        )
  );

GRANT SELECT ON public.teacher_role_types, public.incomplete_report_notification_rules TO authenticated;
