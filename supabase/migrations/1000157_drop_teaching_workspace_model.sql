-- Remove the archived teaching-workspace model.
--
-- Teaching workspaces (`teachings`, `teaching_members`) have been read-only
-- since 1000099; permissions resolve from platform role assignments. This
-- migration moves the remaining callers off the workspace helpers and drops:
--
-- * tables: teachings, teaching_members, teachings_legacy_archive,
--   teaching_members_legacy_archive, rbac_domain_rebuild_state,
--   global_scope_migration_report;
-- * functions: is_teaching_member, can_access_teaching, can_teaching_action,
--   resolve_teaching_permission, ensure_teaching_owner_policies,
--   provision_teaching_owner_member, validate_teaching_member_role_domain,
--   reject_archived_teaching_workspace_write, rbac_scope_teaching_id.
--
-- Replacements (same results; the teaching id argument was already ignored):
--
-- * resolve_scoped_permission(user, key, classroom, session, date) is
--   resolve_teaching_permission without the unused teaching id.
-- * has_active_teaching_role(user) is is_teaching_member without the unused
--   teaching id.
-- * can_teaching_resource_action(resource, action) is can_teaching_action
--   without the unused teaching id. The RLS policies on classrooms, courses,
--   class_sessions, lessons, occurrence_reports and report_templates use it.
-- * private.assert_overview_request holds the argument checks shared by the
--   classroom, course and teacher overview RPCs rewritten here.
--
-- Kept on purpose:
--
-- * The teaching_id columns on classrooms, courses, class_sessions,
--   report_templates, roles and api_idempotency_keys. Their foreign keys to
--   teachings are dropped. Many functions and the API still compare these
--   columns, so normalize_global_teaching_row keeps stamping the former global
--   teaching id (a constant per database) on new rows.
-- * has_teaching_permission keeps its signature: the API and older
--   migrations call it. It now uses resolve_scoped_permission.
-- * clear_legacy_owner: it still clears the legacy user_id owner column that
--   live RPCs write on eleven tables. It does not use teachings.
--
-- Rerunnable: every step checks what exists. Reconciliation reruns of older
-- migrations that read teachings must run before this one.

BEGIN;

-- 1. Replacement helpers.

-- Shared argument checks for the overview RPCs rewritten below. Errors keep
-- their former order: AUTH_REQUIRED, INVALID_LIMIT, INVALID_OFFSET,
-- INVALID_SEARCH, INVALID_SORT. The session paging pair is optional.
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.assert_overview_request(
    p_limit integer,
    p_offset integer,
    p_search text,
    p_sort text DEFAULT NULL,
    p_allowed_sorts text[] DEFAULT NULL,
    p_session_limit integer DEFAULT 1,
    p_session_offset integer DEFAULT 0
)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR p_session_limit IS NULL OR p_session_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_LIMIT';
  END IF;
  IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000
     OR p_session_offset IS NULL OR p_session_offset NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_OFFSET';
  END IF;
  IF char_length(p_search) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SEARCH';
  END IF;
  IF p_allowed_sorts IS NOT NULL
     AND (p_sort IS NULL OR NOT p_sort = ANY (p_allowed_sorts)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SORT';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.assert_overview_request(integer, integer, text, text, text[], integer, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resolve_scoped_permission(p_user_id uuid, p_permission_key text, p_classroom_id uuid DEFAULT NULL::uuid, p_class_session_id uuid DEFAULT NULL::uuid, p_effective_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(is_allowed boolean, is_denied boolean, policy_configured boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
WITH RECURSIVE target AS (
  SELECT COALESCE(p_classroom_id, (SELECT session.classroom_id FROM public.class_sessions session WHERE session.id = p_class_session_id)) AS classroom_id
), directives AS (
  SELECT assignment.role_id, assignment.scope_type, assignment.scope_id,
         CASE assignment.scope_type WHEN 'system' THEN 0 WHEN 'classroom' THEN 1 ELSE 2 END AS depth,
         'grant'::text AS directive
  FROM public.user_role_assignments assignment
  JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
  CROSS JOIN target
  WHERE assignment.user_id = p_user_id AND assignment.status = 'active'
    AND assignment.effective_from <= p_effective_date
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_effective_date)
    AND (assignment.scope_type = 'system'
      OR (assignment.scope_type = 'classroom' AND assignment.scope_id = target.classroom_id)
      OR (assignment.scope_type = 'class_session' AND assignment.scope_id = p_class_session_id))
  UNION ALL
  SELECT grant_row.role_id, 'class_session', grant_row.class_session_id, 2, 'grant'::text
  FROM public.class_session_teacher_role_grants grant_row
  JOIN public.roles role ON role.id = grant_row.role_id AND role.domain = 'teaching'
  WHERE grant_row.user_id = p_user_id AND grant_row.class_session_id = p_class_session_id
    AND grant_row.effective_from <= p_effective_date
    AND (grant_row.effective_to IS NULL OR grant_row.effective_to >= p_effective_date)
  UNION ALL
  SELECT exclusion.role_id, exclusion.scope_type, exclusion.scope_id,
         CASE exclusion.scope_type WHEN 'classroom' THEN 1 ELSE 2 END,
         'exclude'::text
  FROM public.user_role_assignment_exclusions exclusion CROSS JOIN target
  WHERE exclusion.user_id = p_user_id AND exclusion.effective_from <= p_effective_date
    AND (exclusion.effective_to IS NULL OR exclusion.effective_to >= p_effective_date)
    AND ((exclusion.scope_type = 'classroom' AND exclusion.scope_id = target.classroom_id)
      OR (exclusion.scope_type = 'class_session' AND exclusion.scope_id = p_class_session_id))
), ranked AS (
  SELECT directives.*, row_number() OVER (PARTITION BY role_id ORDER BY depth DESC, (directive = 'exclude') DESC) AS rank
  FROM directives
), assigned_roles AS (
  SELECT role_id FROM ranked WHERE rank = 1 AND directive = 'grant'
), role_tree(role_id) AS (
  SELECT role_id FROM assigned_roles
  UNION
  SELECT inheritance.parent_role_id FROM public.role_inheritance inheritance JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  JOIN role_tree role ON role.role_id = policy.role_id CROSS JOIN target
  WHERE permission.key = p_permission_key AND (
    policy.scope_type = 'system'
    OR (policy.scope_type = 'classroom' AND policy.scope_id = target.classroom_id)
    OR (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
  )
)
SELECT COALESCE(bool_or(effect = 'allow'), false) AND NOT COALESCE(bool_or(effect = 'deny'), false),
       COALESCE(bool_or(effect = 'deny'), false), EXISTS (SELECT 1 FROM matched)
FROM matched;
$function$;

CREATE OR REPLACE FUNCTION public.has_active_teaching_role(p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_role_assignments assignment
    JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
    WHERE assignment.user_id = p_user_id AND assignment.scope_type = 'system'
      AND assignment.status = 'active'
      AND assignment.effective_from <= CURRENT_DATE AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_teaching_resource_action(p_resource text, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.has_api_permission(auth.uid(), 'teaching.' || p_resource || '.' || p_action, NULL, NULL)
      OR public.has_api_permission(auth.uid(), 'teaching.' || p_resource || '.manage', NULL, NULL);
$function$;

REVOKE ALL ON FUNCTION public.resolve_scoped_permission(uuid, text, uuid, uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_active_teaching_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_teaching_resource_action(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_scoped_permission(uuid, text, uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_teaching_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_teaching_resource_action(text, text) TO authenticated, service_role;

-- 2. Callers of the workspace helpers. Bodies match the current definitions
-- except for the helper calls; workspace CTEs become one permission row.

CREATE OR REPLACE FUNCTION public.has_teaching_permission(p_user_id uuid, p_permission_key text, p_teaching_id uuid, p_classroom_id uuid DEFAULT NULL::uuid, p_class_session_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE WHEN auth.role() = 'service_role' OR auth.uid() = p_user_id
    THEN COALESCE((SELECT is_allowed AND NOT is_denied FROM public.resolve_scoped_permission(p_user_id, p_permission_key, p_classroom_id, p_class_session_id, CURRENT_DATE) LIMIT 1), false)
    ELSE false END;
$function$;

CREATE OR REPLACE FUNCTION public.has_api_permission(p_user_id uuid, p_permission_key text, p_classroom_id uuid DEFAULT NULL::uuid, p_class_session_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_classroom_id uuid;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RETURN false; END IF;
  IF p_permission_key LIKE 'system.%' THEN
    IF p_classroom_id IS NOT NULL OR p_class_session_id IS NOT NULL THEN RETURN false; END IF;
    RETURN public.has_system_permission(p_user_id, p_permission_key);
  END IF;
  IF p_class_session_id IS NOT NULL THEN
    SELECT session.classroom_id INTO v_classroom_id
    FROM public.class_sessions session WHERE session.id = p_class_session_id;
    IF NOT FOUND OR (p_classroom_id IS NOT NULL AND p_classroom_id <> v_classroom_id) THEN RETURN false; END IF;
    p_classroom_id := v_classroom_id;
  ELSIF p_classroom_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.classrooms classroom WHERE classroom.id = p_classroom_id
  ) THEN RETURN false;
  END IF;
  RETURN COALESCE((SELECT resolved.is_allowed AND NOT resolved.is_denied
    FROM public.resolve_scoped_permission(p_user_id, p_permission_key, p_classroom_id, p_class_session_id, CURRENT_DATE) resolved), false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_incomplete_report_notification_permission(p_user_id uuid, p_classroom_id uuid, p_class_session_id uuid, p_effective_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(is_allowed boolean, is_denied boolean, policy_configured boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH assignment AS (
    SELECT EXISTS (
        SELECT 1
        FROM public.class_session_teachers AS class_teacher
        JOIN public.teacher_records AS teacher
          ON teacher.id = class_teacher.teacher_id
        JOIN public.profiles AS profile
          ON profile.id = teacher.profile_id
        WHERE profile.auth_user_id = p_user_id
          AND class_teacher.class_session_id = p_class_session_id
          AND class_teacher.effective_from <= p_effective_date
          AND (class_teacher.effective_to IS NULL OR class_teacher.effective_to >= p_effective_date)
    ) AS is_assigned
)
SELECT resolved.is_allowed, resolved.is_denied, resolved.policy_configured
FROM assignment
CROSS JOIN LATERAL public.resolve_scoped_permission(
    p_user_id,
    'reports.incomplete.receive',
    p_classroom_id,
    p_class_session_id,
    p_effective_date
) AS resolved
WHERE assignment.is_assigned
UNION ALL
SELECT false, false, false
FROM assignment
WHERE NOT assignment.is_assigned;
$function$;

CREATE OR REPLACE FUNCTION public.replay_deleted_report_idempotency(p_user_id uuid, p_key text, p_method text, p_route text, p_resource_id uuid, p_permission_key text)
 RETURNS TABLE(is_replay boolean, response_status integer, response_body jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.api_idempotency_keys%ROWTYPE;
  v_allowed boolean;
  v_denied boolean;
  v_configured boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  SELECT * INTO v_row
  FROM public.api_idempotency_keys
  WHERE user_id = p_user_id AND idempotency_key = p_key;

  IF NOT FOUND
     OR v_row.method IS DISTINCT FROM p_method
     OR v_row.route IS DISTINCT FROM p_route
     OR v_row.resource_id IS DISTINCT FROM p_resource_id
     OR v_row.permission_key IS DISTINCT FROM p_permission_key
     OR v_row.response_status IS NULL
     OR v_row.teaching_id IS NULL
     OR NOT public.has_active_teaching_role(p_user_id) THEN
    RETURN;
  END IF;

  SELECT resolved.is_allowed, resolved.is_denied, resolved.policy_configured
    INTO v_allowed, v_denied, v_configured
  FROM public.resolve_scoped_permission(
    p_user_id,
    v_row.permission_key,
    v_row.classroom_id,
    v_row.class_session_id,
    CURRENT_DATE
  ) AS resolved;

  IF COALESCE(v_configured, false) IS NOT TRUE
     OR COALESCE(v_allowed, false) IS NOT TRUE
     OR COALESCE(v_denied, false) IS TRUE THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_row.response_status, v_row.response_body;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_access_enrollment_scope(p_student_id uuid, p_course_id uuid, p_classroom_id uuid, p_class_session_id uuid, p_permission_key text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.students student
    LEFT JOIN public.courses course ON course.id = p_course_id
    LEFT JOIN public.classrooms classroom ON classroom.id = p_classroom_id
    LEFT JOIN public.class_sessions session ON session.id = p_class_session_id
    WHERE student.id = p_student_id
      AND COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id) IS NOT NULL
      AND (session.teaching_id IS NULL OR session.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND (classroom.teaching_id IS NULL OR classroom.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND (course.teaching_id IS NULL OR course.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND CASE WHEN p_permission_key = 'teaching.enrollments.create'
        THEN public.has_teaching_permission(auth.uid(), 'teaching.students.read',
          COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
          COALESCE(classroom.id, session.classroom_id), session.id)
        ELSE public.can_access_student(student.id, p_permission_key)
      END
      AND CASE WHEN p_permission_key IS NULL
        THEN public.has_active_teaching_role(auth.uid())
        ELSE public.has_teaching_permission(auth.uid(), p_permission_key,
          COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
          COALESCE(classroom.id, session.classroom_id), session.id)
      END
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_access_student(p_student_id uuid, p_permission_key text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT p_permission_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id = p_student_id AND (
      public.has_teaching_permission(auth.uid(), p_permission_key,
        NULL, NULL, NULL)
      OR EXISTS (
        SELECT 1 FROM public.enrollments enrollment
        LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
        LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
        WHERE enrollment.student_id = student.id
          AND public.has_teaching_permission(auth.uid(), p_permission_key,
            COALESCE(session.teaching_id, classroom.teaching_id),
            COALESCE(classroom.id, session.classroom_id), session.id)
      )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_occurrence_report_mutation_context(p_report_id uuid, p_permission_key text)
 RETURNS TABLE(report_id uuid, version integer, attendance_status text, absence_reason text, enrollment_id uuid, class_occurrence_id uuid, teaching_id uuid, classroom_id uuid, class_session_id uuid, lesson_id uuid, is_completed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    report.id,
    report.version,
    report.attendance_status,
    report.absence_reason,
    report.enrollment_id,
    report.class_occurrence_id,
    session.teaching_id,
    session.classroom_id,
    session.id,
    report.lesson_id,
    report.is_completed
  FROM public.occurrence_reports report
  JOIN public.class_occurrences occurrence
    ON occurrence.id = report.class_occurrence_id
  JOIN public.class_sessions session
    ON session.id = occurrence.class_session_id
  WHERE report.id = p_report_id
    AND auth.uid() IS NOT NULL
    AND p_permission_key IN ('teaching.reports.update', 'teaching.reports.delete')
    AND public.has_active_teaching_role(auth.uid())
    AND public.has_teaching_permission(auth.uid(), p_permission_key, session.teaching_id, session.classroom_id, session.id);
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;

  RETURN (
    WITH enrollment_scopes AS MATERIALIZED (
      SELECT
        enrollment.student_id,
        COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id) AS teaching_id
      FROM public.enrollments enrollment
      LEFT JOIN public.class_sessions session
        ON session.id = enrollment.class_session_id
      LEFT JOIN public.classrooms classroom
        ON classroom.id = enrollment.classroom_id
      LEFT JOIN public.courses course
        ON course.id = enrollment.course_id
    ),
    candidate_scopes AS MATERIALIZED (
      SELECT teaching_id
      FROM enrollment_scopes
      WHERE teaching_id IS NOT NULL
      UNION
      SELECT course.teaching_id
      FROM public.courses course
      WHERE course.teaching_id IS NOT NULL
    ),
    student_scopes AS MATERIALIZED (
      SELECT candidate.teaching_id
      FROM candidate_scopes candidate
      WHERE public.has_api_permission(auth.uid(), 'teaching.students.read', NULL, NULL)
    ),
    course_scopes AS MATERIALIZED (
      SELECT candidate.teaching_id
      FROM candidate_scopes candidate
      WHERE public.can_teaching_resource_action('courses', 'read')
         OR public.can_teaching_resource_action('courses', 'list')
    ),
    visible_student_ids AS MATERIALIZED (
      SELECT student.id
      FROM public.students student
      WHERE student.user_id = v_user_id
      UNION
      SELECT enrollment.student_id
      FROM enrollment_scopes enrollment
      JOIN student_scopes teaching
        ON teaching.teaching_id = enrollment.teaching_id
    )
    SELECT jsonb_build_object(
      'totalStudents', (SELECT count(*) FROM visible_student_ids),
      'activeCourses', (
        SELECT count(course.id)
        FROM public.courses course
        JOIN course_scopes teaching
          ON teaching.teaching_id = course.teaching_id
      )
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_classrooms_overview(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_search text DEFAULT ''::text, p_visibility text DEFAULT 'all'::text, p_session_limit integer DEFAULT 50, p_session_offset integer DEFAULT 0, p_classroom_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_search text := btrim(COALESCE(p_search, ''));
  v_result jsonb;
BEGIN
  PERFORM private.assert_overview_request(p_limit, p_offset, v_search,
    p_session_limit => p_session_limit, p_session_offset => p_session_offset);
  IF p_visibility IS NULL OR p_visibility NOT IN ('all', 'visible', 'hidden') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_VISIBILITY';
  END IF;

  WITH hidden AS MATERIALIZED (
    SELECT entity_type, entity_id
    FROM public.user_entity_visibility_preferences
    WHERE user_id = v_user_id AND is_hidden IS TRUE
      AND entity_type IN ('classroom', 'class_session')
  ),
  classroom_scopes AS MATERIALIZED (
    SELECT true AS allowed
    WHERE public.can_teaching_resource_action('classrooms', 'read')
       OR public.can_teaching_resource_action('classrooms', 'list')
  ),
  session_scopes AS MATERIALIZED (
    SELECT true AS allowed
    WHERE public.can_teaching_resource_action('class_sessions', 'read')
       OR public.can_teaching_resource_action('class_sessions', 'list')
  ),
  visible_classrooms AS MATERIALIZED (
    SELECT classroom.id, classroom.name, classroom.color, classroom.external_link,
           classroom.teaching_id, classroom.user_id, classroom.created_at, classroom.updated_at,
           EXISTS (SELECT 1 FROM hidden WHERE entity_type = 'classroom' AND entity_id = classroom.id) AS is_hidden
    FROM public.classrooms classroom
    JOIN classroom_scopes teaching ON classroom.teaching_id IS NOT NULL
  ),
  filtered_classrooms AS MATERIALIZED (
    SELECT * FROM visible_classrooms classroom
    WHERE (v_search = '' OR strpos(lower(COALESCE(classroom.name, '')), lower(v_search)) > 0)
      AND (p_visibility = 'all' OR (p_visibility = 'hidden' AND classroom.is_hidden) OR (p_visibility = 'visible' AND NOT classroom.is_hidden))
  ),
  ordered_classrooms AS MATERIALIZED (
    SELECT classroom.*, row_number() OVER (ORDER BY lower(COALESCE(classroom.name, '')), classroom.id) AS page_ordinal
    FROM filtered_classrooms classroom
  ),
  page_classrooms AS MATERIALIZED (
    SELECT * FROM ordered_classrooms ORDER BY page_ordinal LIMIT p_limit OFFSET p_offset
  ),
  visible_sessions AS MATERIALIZED (
    SELECT session.id, session.name, session.classroom_id, session.course_ids, session.day_of_week,
           session.start_time, session.end_time, session.capacity, session.lesson_number,
           session.external_link, session.start_date, session.end_date, session.time_zone,
           session.session_type, session.schedule_mode, session.teaching_id, session.user_id,
           session.created_at, session.updated_at,
           EXISTS (SELECT 1 FROM hidden WHERE entity_type = 'class_session' AND entity_id = session.id) AS is_hidden
    FROM public.class_sessions session
    JOIN session_scopes teaching ON session.teaching_id IS NOT NULL
  ),
  filtered_sessions AS MATERIALIZED (
    SELECT * FROM visible_sessions session
    WHERE (v_search = '' OR strpos(lower(COALESCE(session.name, '')), lower(v_search)) > 0)
      AND (p_classroom_id IS NULL OR session.classroom_id = p_classroom_id)
      AND (p_visibility = 'all' OR (p_visibility = 'hidden' AND session.is_hidden) OR (p_visibility = 'visible' AND NOT session.is_hidden))
  ),
  ordered_sessions AS MATERIALIZED (
    SELECT session.*, row_number() OVER (ORDER BY lower(COALESCE(session.name, '')), session.id) AS page_ordinal
    FROM filtered_sessions session
  ),
  page_sessions AS MATERIALIZED (
    SELECT * FROM ordered_sessions ORDER BY page_ordinal LIMIT p_session_limit OFFSET p_session_offset
  )
  SELECT jsonb_build_object(
    'classrooms', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', classroom.id, 'name', classroom.name, 'color', classroom.color,
        'external_link', classroom.external_link, 'teaching_id', classroom.teaching_id,
        'user_id', classroom.user_id, 'created_at', classroom.created_at, 'updated_at', classroom.updated_at,
        'classroom_schedules', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', schedule.id, 'classroom_id', schedule.classroom_id,
            'day_of_week', schedule.day_of_week, 'start_time', schedule.start_time,
            'end_time', schedule.end_time, 'user_id', schedule.user_id,
            'created_at', schedule.created_at, 'updated_at', schedule.updated_at
          ) ORDER BY schedule.day_of_week, schedule.start_time, schedule.id)
          FROM public.classroom_schedules schedule WHERE schedule.classroom_id = classroom.id
        ), '[]'::jsonb)
      ) ORDER BY classroom.page_ordinal)
      FROM page_classrooms classroom
    ), '[]'::jsonb),
    'count', (SELECT count(*) FROM filtered_classrooms),
    'classroomTotal', (SELECT count(*) FROM visible_classrooms),
    'visibleClassroomCount', (SELECT count(*) FROM visible_classrooms WHERE NOT is_hidden),
    'hiddenClassroomCount', (SELECT count(*) FROM visible_classrooms WHERE is_hidden),
    'hiddenClassroomIds', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM visible_classrooms WHERE is_hidden), '[]'::jsonb),
    'hiddenSessionIds', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM visible_sessions WHERE is_hidden), '[]'::jsonb),
    'classSessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', session.id, 'name', session.name, 'classroom_id', session.classroom_id,
        'course_ids', session.course_ids, 'day_of_week', session.day_of_week,
        'start_time', session.start_time, 'end_time', session.end_time,
        'capacity', session.capacity, 'lesson_number', session.lesson_number,
        'external_link', session.external_link, 'start_date', session.start_date,
        'end_date', session.end_date, 'time_zone', session.time_zone,
        'session_type', session.session_type, 'schedule_mode', session.schedule_mode,
        'teaching_id', session.teaching_id, 'user_id', session.user_id,
        'created_at', session.created_at, 'updated_at', session.updated_at,
        'classrooms', (SELECT CASE WHEN classroom.id IS NULL THEN NULL ELSE jsonb_build_object('id', classroom.id, 'name', classroom.name, 'color', classroom.color) END FROM public.classrooms classroom WHERE classroom.id = session.classroom_id),
        'schedule_rules', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', rule.id, 'schedule_kind', rule.schedule_kind, 'day_of_week', rule.day_of_week,
            'day_of_month', rule.day_of_month, 'occurrence_date', rule.occurrence_date,
            'start_time', rule.start_time, 'end_time', rule.end_time
          ) ORDER BY rule.occurrence_date NULLS LAST, rule.day_of_week NULLS LAST, rule.start_time, rule.id)
          FROM public.class_session_schedule_rules rule WHERE rule.class_session_id = session.id
        ), '[]'::jsonb)
      ) ORDER BY session.page_ordinal)
      FROM page_sessions session
    ), '[]'::jsonb),
    'sessionCount', (SELECT count(*) FROM filtered_sessions),
    'sessionTotal', (SELECT count(*) FROM visible_sessions),
    'visibleSessionCount', (SELECT count(*) FROM visible_sessions WHERE NOT is_hidden),
    'hiddenSessionCount', (SELECT count(*) FROM visible_sessions WHERE is_hidden)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_courses_overview(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_search text DEFAULT ''::text, p_sort text DEFAULT 'display_name'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_search text := btrim(COALESCE(p_search, ''));
  v_result jsonb;
BEGIN
  PERFORM private.assert_overview_request(
    p_limit, p_offset, v_search, p_sort,
    ARRAY['display_name', '-display_name', 'subject', '-subject',
          'stage', '-stage', 'created_at', '-created_at']
  );

  WITH readable_scopes AS MATERIALIZED (
    SELECT true AS allowed
    WHERE public.can_teaching_resource_action('courses', 'read')
       OR public.can_teaching_resource_action('courses', 'list')
  ),
  filtered_courses AS MATERIALIZED (
    SELECT course.id, course.subject, course.stage, course.display_name,
           course.description, course.description_document, course.teaching_id,
           course.user_id, course.created_at, course.updated_at
    FROM public.courses course
    JOIN readable_scopes teaching ON course.teaching_id IS NOT NULL
    WHERE v_search = ''
       OR strpos(lower(COALESCE(course.display_name, '')), lower(v_search)) > 0
       OR strpos(lower(COALESCE(course.subject, '')), lower(v_search)) > 0
       OR strpos(lower(COALESCE(course.stage, '')), lower(v_search)) > 0
  ),
  ordered_courses AS MATERIALIZED (
    SELECT course.*, row_number() OVER (
      ORDER BY
        CASE WHEN p_sort = 'display_name' THEN lower(COALESCE(course.display_name, '')) END ASC,
        CASE WHEN p_sort = '-display_name' THEN lower(COALESCE(course.display_name, '')) END DESC,
        CASE WHEN p_sort = 'subject' THEN lower(COALESCE(course.subject, '')) END ASC,
        CASE WHEN p_sort = '-subject' THEN lower(COALESCE(course.subject, '')) END DESC,
        CASE WHEN p_sort = 'stage' THEN lower(COALESCE(course.stage, '')) END ASC,
        CASE WHEN p_sort = '-stage' THEN lower(COALESCE(course.stage, '')) END DESC,
        CASE WHEN p_sort = 'created_at' THEN course.created_at END ASC,
        CASE WHEN p_sort = '-created_at' THEN course.created_at END DESC,
        course.id ASC
    ) AS page_ordinal
    FROM filtered_courses course
  ),
  page_courses AS MATERIALIZED (
    SELECT * FROM ordered_courses ORDER BY page_ordinal LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', course.id, 'subject', course.subject, 'stage', course.stage,
        'display_name', course.display_name, 'description', course.description,
        'description_document', course.description_document, 'teaching_id', course.teaching_id,
        'user_id', course.user_id, 'created_at', course.created_at, 'updated_at', course.updated_at,
        'lessons', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', lesson.id, 'course_id', lesson.course_id, 'title', lesson.title,
            'sequence', lesson.sequence, 'user_id', lesson.user_id,
            'created_at', lesson.created_at, 'updated_at', lesson.updated_at
          ) ORDER BY lesson.sequence, lesson.id)
          FROM public.lessons lesson WHERE lesson.course_id = course.id
        ), '[]'::jsonb)
      ) ORDER BY course.page_ordinal)
      FROM page_courses course
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered_courses)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_teachers_overview(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_search text DEFAULT ''::text, p_sort text DEFAULT 'name'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_search text := btrim(COALESCE(p_search, ''));
  v_result jsonb;
BEGIN
  PERFORM private.assert_overview_request(
    p_limit, p_offset, v_search, p_sort,
    ARRAY['name', '-name', 'created_at', '-created_at']
  );

  WITH readable_scopes AS MATERIALIZED (
    SELECT true AS allowed
    WHERE public.can_teaching_resource_action('teachers', 'read')
       OR public.can_teaching_resource_action('teachers', 'list')
  ),
  visible_teacher_ids AS MATERIALIZED (
    SELECT teacher.id FROM public.teachers teacher WHERE teacher.user_id = v_user_id
    UNION
    SELECT assignment.teacher_id
    FROM public.class_session_teachers assignment
    JOIN public.class_sessions session ON session.id = assignment.class_session_id
    JOIN readable_scopes teaching ON session.teaching_id IS NOT NULL
  ),
  visible_teachers AS MATERIALIZED (
    SELECT teacher.id, teacher.user_id, teacher.name, teacher.bio, teacher.bio_document,
           teacher.created_at, teacher.updated_at
    FROM public.teachers teacher JOIN visible_teacher_ids visible ON visible.id = teacher.id
  ),
  filtered_teachers AS MATERIALIZED (
    SELECT * FROM visible_teachers teacher
    WHERE v_search = '' OR strpos(lower(COALESCE(teacher.name, '')), lower(v_search)) > 0
  ),
  ordered_teachers AS MATERIALIZED (
    SELECT teacher.*, row_number() OVER (
      ORDER BY
        CASE WHEN p_sort = 'name' THEN lower(COALESCE(teacher.name, '')) END ASC,
        CASE WHEN p_sort = '-name' THEN lower(COALESCE(teacher.name, '')) END DESC,
        CASE WHEN p_sort = 'created_at' THEN teacher.created_at END ASC,
        CASE WHEN p_sort = '-created_at' THEN teacher.created_at END DESC,
        teacher.id ASC
    ) AS page_ordinal
    FROM filtered_teachers teacher
  ),
  page_teachers AS MATERIALIZED (
    SELECT * FROM ordered_teachers ORDER BY page_ordinal LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', teacher.id, 'user_id', teacher.user_id, 'name', teacher.name,
        'bio', teacher.bio, 'bio_document', teacher.bio_document,
        'created_at', teacher.created_at, 'updated_at', teacher.updated_at
      ) ORDER BY teacher.page_ordinal) FROM page_teachers teacher
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered_teachers),
    'statistics', jsonb_build_object(
      'totalTeachers', (SELECT count(*) FROM visible_teachers),
      'linkedAccounts', (SELECT count(*) FROM visible_teachers WHERE user_id IS NOT NULL),
      'unlinkedAccounts', (SELECT count(*) FROM visible_teachers WHERE user_id IS NULL),
      'completeProfiles', (SELECT count(*) FROM visible_teachers WHERE name IS NOT NULL AND bio IS NOT NULL)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_incomplete_reports_page(p_days_back integer DEFAULT 90, p_scope text DEFAULT 'all'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_search text DEFAULT ''::text, p_sort text DEFAULT '-date'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_time_zone text := 'UTC';
  v_end_date date;
  v_start_date date;
  v_search text := btrim(COALESCE(p_search, ''));
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_days_back IS NULL OR p_days_back < 1 OR p_days_back > 3650 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DAYS_BACK';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('all', 'my_present', 'my_notifications') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SCOPE';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_LIMIT';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_OFFSET';
  END IF;
  IF char_length(v_search) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SEARCH';
  END IF;
  IF p_sort IS NULL OR p_sort NOT IN ('date', '-date', 'updated_at', '-updated_at') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SORT';
  END IF;

  SELECT COALESCE(NULLIF(preference.time_zone, ''), 'UTC')
    INTO v_time_zone
  FROM public.user_preferences preference
  WHERE preference.user_id = v_user_id
  LIMIT 1;
  v_time_zone := COALESCE(v_time_zone, 'UTC');

  v_end_date := (CURRENT_TIMESTAMP AT TIME ZONE v_time_zone)::date;
  v_start_date := v_end_date - (p_days_back - 1);

  WITH readable_scopes AS MATERIALIZED (
    SELECT true AS allowed
    WHERE public.can_teaching_resource_action('reports', 'read')
       OR public.can_teaching_resource_action('reports', 'list')
  ),
  current_teachers AS MATERIALIZED (
    SELECT teacher.id, teacher.user_id
    FROM public.teachers teacher
    WHERE teacher.user_id = v_user_id
  ),
  candidates AS MATERIALIZED (
    SELECT report.id,
           report.enrollment_id,
           report.class_occurrence_id,
           report.content,
           report.content_document,
           report.lesson_id,
           report.is_completed,
           report.progress_letter,
           report.attendance_status,
           report.absence_reason,
           report.class_participation,
           report.classroom_behavior,
           report.contact_notes,
           report.class_notes,
           report.external_link,
           report.version,
           report.updated_at,
           enrollment.course_id,
           student.name AS student_name,
           occurrence.class_session_id,
           occurrence.occurrence_date,
           occurrence.time_zone,
           occurrence.actual_start_time,
           occurrence.actual_end_time,
           occurrence.original_start_time,
           occurrence.original_end_time,
           occurrence.teacher_ids,
           occurrence.teacher_attendance,
           session.name AS class_name,
           session.classroom_id,
           classroom.name AS classroom_name
    FROM public.occurrence_reports report
    JOIN public.enrollments enrollment ON enrollment.id = report.enrollment_id
    JOIN public.students student ON student.id = enrollment.student_id
    JOIN public.class_occurrences occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.class_sessions session ON session.id = occurrence.class_session_id
    LEFT JOIN public.classrooms classroom ON classroom.id = session.classroom_id
    JOIN readable_scopes teaching ON session.teaching_id IS NOT NULL
    WHERE report.attendance_status = 'present'
      AND occurrence.is_conducted IS TRUE
      AND occurrence.status NOT IN ('cancelled', 'rescheduled')
      AND occurrence.occurrence_date BETWEEN v_start_date AND v_end_date
  ),
  presence_scoped AS MATERIALIZED (
    SELECT candidate.*
    FROM candidates candidate
    WHERE p_scope = 'all'
       OR (
         EXISTS (
           SELECT 1
           FROM current_teachers identity
           WHERE (identity.id = ANY(COALESCE(candidate.teacher_ids, '{}'::uuid[]))
                  OR v_user_id = ANY(COALESCE(candidate.teacher_ids, '{}'::uuid[])))
             AND (
               candidate.teacher_attendance ->> identity.id::text IS DISTINCT FROM 'false'
               AND candidate.teacher_attendance ->> v_user_id::text IS DISTINCT FROM 'false'
             )
             AND (
               candidate.teacher_attendance ->> identity.id::text IS NOT DISTINCT FROM 'true'
               OR candidate.teacher_attendance ->> v_user_id::text IS NOT DISTINCT FROM 'true'
             )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM current_teachers identity
           WHERE (identity.id = ANY(COALESCE(candidate.teacher_ids, '{}'::uuid[]))
                  OR v_user_id = ANY(COALESCE(candidate.teacher_ids, '{}'::uuid[])))
             AND (
               candidate.teacher_attendance ->> identity.id::text IS NOT DISTINCT FROM 'false'
               OR candidate.teacher_attendance ->> v_user_id::text IS NOT DISTINCT FROM 'false'
             )
         )
       )
  ),
  notification_scopes AS MATERIALIZED (
    SELECT DISTINCT scoped.classroom_id, scoped.class_session_id, scoped.occurrence_date
    FROM presence_scoped scoped
    WHERE p_scope = 'my_notifications'
  ),
  notification_decisions AS MATERIALIZED (
    SELECT scope.classroom_id, scope.class_session_id, scope.occurrence_date,
           decision.is_allowed, decision.is_denied, decision.policy_configured
    FROM notification_scopes scope
    CROSS JOIN LATERAL public.resolve_incomplete_report_notification_permission(
      v_user_id,
      scope.classroom_id,
      scope.class_session_id,
      scope.occurrence_date
    ) decision
  ),
  flagged AS MATERIALIZED (
    SELECT scoped.*,
           (NULLIF(btrim(COALESCE(scoped.content, '')), '') IS NULL) AS missing_content,
           (scoped.lesson_id IS NULL) AS missing_lesson,
           (NOT (scoped.is_completed IS TRUE
                 OR NULLIF(btrim(COALESCE(scoped.progress_letter, '')), '') IS NOT NULL)) AS missing_progress,
           (NOT (scoped.class_participation IS NOT NULL AND scoped.class_participation > 0)) AS missing_participation,
           (NOT (scoped.classroom_behavior IS NOT NULL AND scoped.classroom_behavior > 0)) AS missing_behavior
    FROM presence_scoped scoped
    LEFT JOIN notification_decisions decision
      ON decision.classroom_id IS NOT DISTINCT FROM scoped.classroom_id
     AND decision.class_session_id = scoped.class_session_id
     AND decision.occurrence_date = scoped.occurrence_date
    WHERE p_scope <> 'my_notifications'
       OR (decision.is_allowed IS TRUE
           AND decision.is_denied IS FALSE
           AND decision.policy_configured IS TRUE)
  ),
  incomplete AS MATERIALIZED (
    SELECT flagged.*,
           (flagged.missing_content OR flagged.missing_lesson OR flagged.missing_progress
            OR flagged.missing_participation OR flagged.missing_behavior) AS is_incomplete
    FROM flagged
  ),
  searched AS MATERIALIZED (
    SELECT item.*
    FROM incomplete item
    WHERE item.is_incomplete
      AND (
        v_search = ''
        OR strpos(lower(COALESCE(item.student_name, '')), lower(v_search)) > 0
        OR strpos(lower(COALESCE(item.class_name, '')), lower(v_search)) > 0
        OR strpos(lower(COALESCE(item.classroom_name, '')), lower(v_search)) > 0
      )
  ),
  ordered AS MATERIALIZED (
    SELECT item.*,
           row_number() OVER (ORDER BY
             CASE WHEN p_sort = 'date' THEN item.occurrence_date END ASC,
             CASE WHEN p_sort = '-date' THEN item.occurrence_date END DESC,
             CASE WHEN p_sort = 'updated_at' THEN item.updated_at END ASC NULLS LAST,
             CASE WHEN p_sort = '-updated_at' THEN item.updated_at END DESC NULLS LAST,
             item.occurrence_date DESC,
             item.updated_at DESC NULLS LAST,
             item.id
           ) AS page_ordinal
    FROM searched item
  ),
  page AS MATERIALIZED (
    SELECT *
    FROM ordered
    ORDER BY page_ordinal
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', item.id,
        'reportId', item.id,
        'enrollmentId', item.enrollment_id,
        'occurrenceId', item.class_occurrence_id,
        'sessionId', item.class_session_id,
        'classroomId', item.classroom_id,
        'studentName', COALESCE(item.student_name, 'Unknown'),
        'courseId', item.course_id,
        'className', COALESCE(item.class_name, '-'),
        'classroomName', COALESCE(item.classroom_name, '-'),
        'date', item.occurrence_date,
        'timeZone', item.time_zone,
        'startTime', COALESCE(item.actual_start_time, item.original_start_time),
        'endTime', COALESCE(item.actual_end_time, item.original_end_time),
        'content', COALESCE(item.content, ''),
        'contentDocument', item.content_document,
        'lessonId', item.lesson_id,
        'missingContent', item.missing_content,
        'missingLesson', item.missing_lesson,
        'missingProgress', item.missing_progress,
        'missingParticipation', item.missing_participation,
        'missingBehavior', item.missing_behavior,
        'isIncomplete', true,
        'isMissing', false,
        'isCompleted', item.is_completed,
        'progressLetter', item.progress_letter,
        'attendanceStatus', item.attendance_status,
        'absenceReason', item.absence_reason,
        'classParticipation', item.class_participation,
        'classroomBehavior', item.classroom_behavior,
        'contactNotes', item.contact_notes,
        'classNotes', item.class_notes,
        'externalLink', item.external_link,
        'version', item.version,
        'updatedAt', item.updated_at
      ) ORDER BY item.page_ordinal)
      FROM page item
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM searched)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rbac_scope_exists(p_scope_type text, p_scope_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE p_scope_type
    WHEN 'system' THEN
      p_scope_id IS NULL
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, NULL)
      )
    WHEN 'classroom' THEN
      EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_scope_id)
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL)
        OR public.has_api_permission(auth.uid(), 'teaching.members.manage', p_scope_id, NULL)
      )
    WHEN 'class_session' THEN
      EXISTS (SELECT 1 FROM public.class_sessions WHERE id = p_scope_id)
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, p_scope_id)
        OR public.has_api_permission(auth.uid(), 'teaching.members.manage', NULL, p_scope_id)
      )
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.rbac_delete_role(p_role_id uuid, p_expected_epoch bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_role public.roles;
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 0);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR UPDATE;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF v_role.is_builtin OR v_role.is_protected THEN RAISE EXCEPTION 'PROTECTED_ROLE'; END IF;
  IF NOT public.rbac_can_manage_domain(v_role.domain, v_role.teaching_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.class_session_teachers WHERE role_id = p_role_id)
     OR EXISTS (SELECT 1 FROM public.user_role_assignments WHERE role_id = p_role_id) THEN
    RAISE EXCEPTION 'ROLE_IN_USE';
  END IF;
  DELETE FROM public.roles WHERE id = p_role_id;
END;
$function$;

-- 3. RLS policies: same expressions, without the ignored teaching id.
ALTER POLICY "Canonical sessions create" ON public.class_sessions
  WITH CHECK (public.can_teaching_resource_action('class_sessions'::text, 'create'::text));
ALTER POLICY "Canonical sessions delete" ON public.class_sessions
  USING (public.can_teaching_resource_action('class_sessions'::text, 'delete'::text));
ALTER POLICY "Canonical sessions read" ON public.class_sessions
  USING ((public.can_teaching_resource_action('class_sessions'::text, 'read'::text) OR public.can_teaching_resource_action('class_sessions'::text, 'list'::text)));
ALTER POLICY "Canonical sessions update" ON public.class_sessions
  USING (public.can_teaching_resource_action('class_sessions'::text, 'update'::text))
  WITH CHECK (public.can_teaching_resource_action('class_sessions'::text, 'update'::text));
ALTER POLICY "Canonical classrooms create" ON public.classrooms
  WITH CHECK (public.can_teaching_resource_action('classrooms'::text, 'create'::text));
ALTER POLICY "Canonical classrooms delete" ON public.classrooms
  USING (public.can_teaching_resource_action('classrooms'::text, 'delete'::text));
ALTER POLICY "Canonical classrooms read" ON public.classrooms
  USING ((public.can_teaching_resource_action('classrooms'::text, 'read'::text) OR public.can_teaching_resource_action('classrooms'::text, 'list'::text)));
ALTER POLICY "Canonical classrooms update" ON public.classrooms
  USING (public.can_teaching_resource_action('classrooms'::text, 'update'::text))
  WITH CHECK (public.can_teaching_resource_action('classrooms'::text, 'update'::text));
ALTER POLICY "Canonical courses create" ON public.courses
  WITH CHECK (public.can_teaching_resource_action('courses'::text, 'create'::text));
ALTER POLICY "Canonical courses delete" ON public.courses
  USING (public.can_teaching_resource_action('courses'::text, 'delete'::text));
ALTER POLICY "Canonical courses read" ON public.courses
  USING ((public.can_teaching_resource_action('courses'::text, 'read'::text) OR public.can_teaching_resource_action('courses'::text, 'list'::text)));
ALTER POLICY "Canonical courses update" ON public.courses
  USING (public.can_teaching_resource_action('courses'::text, 'update'::text))
  WITH CHECK (public.can_teaching_resource_action('courses'::text, 'update'::text));
ALTER POLICY "Teaching lessons create" ON public.lessons
  WITH CHECK ((EXISTS ( SELECT 1
   FROM courses course
  WHERE ((course.id = lessons.course_id) AND public.can_teaching_resource_action('lessons'::text, 'create'::text)))));
ALTER POLICY "Teaching lessons delete" ON public.lessons
  USING ((EXISTS ( SELECT 1
   FROM courses course
  WHERE ((course.id = lessons.course_id) AND public.can_teaching_resource_action('lessons'::text, 'delete'::text)))));
ALTER POLICY "Teaching lessons read" ON public.lessons
  USING ((EXISTS ( SELECT 1
   FROM courses course
  WHERE ((course.id = lessons.course_id) AND (public.can_teaching_resource_action('lessons'::text, 'read'::text) OR public.can_teaching_resource_action('lessons'::text, 'list'::text))))));
ALTER POLICY "Teaching lessons update" ON public.lessons
  USING ((EXISTS ( SELECT 1
   FROM courses course
  WHERE ((course.id = lessons.course_id) AND public.can_teaching_resource_action('lessons'::text, 'update'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM courses course
  WHERE ((course.id = lessons.course_id) AND public.can_teaching_resource_action('lessons'::text, 'update'::text)))));
ALTER POLICY "Canonical reports update" ON public.occurrence_reports
  USING ((can_access_occurrence_report(id) OR can_access_report(id, 'teaching.reports.update'::text)))
  WITH CHECK ((can_access_occurrence_report(id) OR (EXISTS ( SELECT 1
   FROM (class_occurrences occurrence
     JOIN class_sessions session ON ((session.id = occurrence.class_session_id)))
  WHERE ((occurrence.id = occurrence_reports.class_occurrence_id) AND public.can_teaching_resource_action('reports'::text, 'update'::text))))));
ALTER POLICY "Teaching templates create" ON public.report_templates
  WITH CHECK ((public.can_teaching_resource_action('templates'::text, 'create'::text) OR (instructor_id = ( SELECT auth.uid() AS uid))));
ALTER POLICY "Teaching templates delete" ON public.report_templates
  USING ((public.can_teaching_resource_action('templates'::text, 'delete'::text) OR (instructor_id = ( SELECT auth.uid() AS uid))));
ALTER POLICY "Teaching templates read" ON public.report_templates
  USING ((public.can_teaching_resource_action('templates'::text, 'read'::text) OR public.can_teaching_resource_action('templates'::text, 'list'::text) OR (instructor_id = ( SELECT auth.uid() AS uid))));
ALTER POLICY "Teaching templates update" ON public.report_templates
  USING ((public.can_teaching_resource_action('templates'::text, 'update'::text) OR (instructor_id = ( SELECT auth.uid() AS uid))))
  WITH CHECK ((public.can_teaching_resource_action('templates'::text, 'update'::text) OR (instructor_id = ( SELECT auth.uid() AS uid))));

-- 4. Freeze the former global teaching id into the normalization trigger, so
-- teaching_id keeps its current value without the teachings table.
DO $$
DECLARE v_global_id uuid;
BEGIN
  IF to_regclass('public.teachings') IS NULL THEN
    RETURN;
  END IF;
  SELECT id INTO v_global_id FROM public.teachings WHERE is_global LIMIT 1;
  IF v_global_id IS NULL THEN
    RAISE EXCEPTION 'GLOBAL_TEACHING_SCOPE_MISSING';
  END IF;
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION public.normalize_global_teaching_row()
     RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path TO 'public'
    AS $function$
    BEGIN
      -- Former global teaching id, kept until teaching_id columns are dropped.
      NEW.teaching_id := %L::uuid;
      RETURN NEW;
    END;
    $function$
  $sql$, v_global_id);
END;
$$;

ALTER TABLE public.classrooms DROP CONSTRAINT IF EXISTS classrooms_teaching_id_fkey;
ALTER TABLE public.courses DROP CONSTRAINT IF EXISTS courses_teaching_id_fkey;
ALTER TABLE public.class_sessions DROP CONSTRAINT IF EXISTS class_sessions_teaching_id_fkey;
ALTER TABLE public.report_templates DROP CONSTRAINT IF EXISTS report_templates_teaching_id_fkey;
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_teaching_id_fkey;

-- 5. Drop the workspace model. RESTRICT (the default) fails on any dependency
-- left behind.
DROP TABLE IF EXISTS public.teaching_members;
DROP TABLE IF EXISTS public.teachings;
DROP TABLE IF EXISTS public.teaching_members_legacy_archive;
DROP TABLE IF EXISTS public.teachings_legacy_archive;
DROP TABLE IF EXISTS public.rbac_domain_rebuild_state;
DROP TABLE IF EXISTS public.global_scope_migration_report;

DROP FUNCTION IF EXISTS public.can_teaching_action(uuid, text, text);
DROP FUNCTION IF EXISTS public.can_access_teaching(uuid, text);
DROP FUNCTION IF EXISTS public.is_teaching_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.resolve_teaching_permission(uuid, text, uuid, uuid, uuid, date);
DROP FUNCTION IF EXISTS public.ensure_teaching_owner_policies();
DROP FUNCTION IF EXISTS public.provision_teaching_owner_member();
DROP FUNCTION IF EXISTS public.validate_teaching_member_role_domain();
DROP FUNCTION IF EXISTS public.reject_archived_teaching_workspace_write();
DROP FUNCTION IF EXISTS public.rbac_scope_teaching_id(text, uuid);

COMMIT;
