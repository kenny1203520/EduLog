-- Require attendance, an effective class assignment, and an explicit hierarchical
-- policy before a teacher can receive incomplete-report notifications.

CREATE OR REPLACE FUNCTION public.resolve_incomplete_report_notification_permission(
    p_user_id uuid,
    p_classroom_id uuid,
    p_class_session_id uuid,
    p_effective_date date DEFAULT CURRENT_DATE
) RETURNS TABLE (is_allowed boolean, is_denied boolean, policy_configured boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
WITH target_permission AS (
    SELECT permission.id
    FROM public.permissions AS permission
    WHERE permission.key = 'reports.incomplete.receive'
), effective_class_roles AS (
    SELECT class_teacher.role_id
    FROM public.class_session_teachers AS class_teacher
    JOIN public.teachers AS teacher
      ON teacher.id = class_teacher.teacher_id
    WHERE teacher.user_id = p_user_id
      AND class_teacher.class_session_id = p_class_session_id
      AND class_teacher.effective_from <= p_effective_date
      AND (class_teacher.effective_to IS NULL OR class_teacher.effective_to >= p_effective_date)
), effective_role_policies AS (
    SELECT class_role.role_id, resolved.effect
    FROM effective_class_roles AS class_role
    LEFT JOIN LATERAL (
        SELECT policy.effect
        FROM public.role_permission_policies AS policy
        JOIN target_permission AS permission
          ON permission.id = policy.permission_id
        WHERE policy.role_id = class_role.role_id
          AND (
              (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
              OR (policy.scope_type = 'classroom' AND policy.scope_id = p_classroom_id)
              OR policy.scope_type = 'system'
          )
        ORDER BY CASE policy.scope_type
            WHEN 'class_session' THEN 3
            WHEN 'classroom' THEN 2
            ELSE 1
        END DESC
        LIMIT 1
    ) AS resolved ON true
), matching_policies AS (
    SELECT EXISTS (
        SELECT 1
        FROM public.role_permission_policies AS policy
        JOIN target_permission AS permission
          ON permission.id = policy.permission_id
        WHERE policy.scope_type = 'system'
           OR (policy.scope_type = 'classroom' AND policy.scope_id = p_classroom_id)
           OR (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
    ) AS configured
)
SELECT
    COALESCE(bool_or(effect = 'allow'), false)
        AND NOT COALESCE(bool_or(effect = 'deny'), false) AS is_allowed,
    COALESCE(bool_or(effect = 'deny'), false) AS is_denied,
    (SELECT configured FROM matching_policies) AS policy_configured
FROM effective_role_policies;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_incomplete_report_notification_permission(uuid, uuid, uuid, date)
    TO authenticated, service_role;