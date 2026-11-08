-- Scoped teaching access.
--
-- Before this migration every page gate, overview RPC and most RLS policies
-- asked "does the user hold this permission at platform level?". A teacher
-- who was only assigned to a classroom (user_role_assignments.scope_type =
-- 'classroom') or to a class session (class roster grant or class_session
-- assignment) therefore saw "permission denied" on nearly every page and
-- could not save reports: has_active_teaching_role only counted platform
-- assignments.
--
-- This migration makes access scope-aware:
--
-- * private.teaching_grant_targets lists the classrooms and class sessions in
--   which a user holds an active teaching role.
-- * has_teaching_permission_any_scope answers "does the user hold this
--   permission anywhere?" (platform, classroom or class session). The API
--   uses it for page entry; the RPCs then filter rows by scope.
-- * accessible_class_session_ids / accessible_classroom_ids return the rows a
--   user may see for a permission (everything for platform-level grants).
-- * has_active_teaching_role counts classroom and class-session grants.
-- * can_create_occurrence_report is permission based (it still used the
--   pre-RBAC teachers.user_id and rbac.manage checks).
-- * Overview RPCs (dashboard, classrooms, courses, teachers, incomplete
--   reports, holidays) and the RLS policies on classrooms, class_sessions,
--   courses, lessons, report_templates and occurrence_reports filter by scope.
--   Courses, lessons, templates and platform-wide holidays are platform data:
--   holding the read permission in any scope reads all of them; writes still
--   need the platform-level permission.
--
-- Rerunnable: CREATE OR REPLACE and ALTER POLICY only.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- 1. Scope helpers.

CREATE OR REPLACE FUNCTION private.teaching_grant_targets(p_user_id uuid, p_effective_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(classroom_id uuid, class_session_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT assignment.scope_id, NULL::uuid
  FROM public.user_role_assignments assignment
  JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
  JOIN public.classrooms classroom ON classroom.id = assignment.scope_id
  WHERE assignment.user_id = p_user_id AND assignment.status = 'active'
    AND assignment.scope_type = 'classroom'
    AND assignment.effective_from <= p_effective_date
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_effective_date)
  UNION
  SELECT session.classroom_id, session.id
  FROM public.user_role_assignments assignment
  JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
  JOIN public.class_sessions session ON session.id = assignment.scope_id
  WHERE assignment.user_id = p_user_id AND assignment.status = 'active'
    AND assignment.scope_type = 'class_session'
    AND assignment.effective_from <= p_effective_date
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_effective_date)
  UNION
  SELECT session.classroom_id, session.id
  FROM public.class_session_teacher_role_grants grant_row
  JOIN public.roles role ON role.id = grant_row.role_id AND role.domain = 'teaching'
  JOIN public.class_sessions session ON session.id = grant_row.class_session_id
  WHERE grant_row.user_id = p_user_id
    AND grant_row.effective_from <= p_effective_date
    AND (grant_row.effective_to IS NULL OR grant_row.effective_to >= p_effective_date);
$function$;

REVOKE ALL ON FUNCTION private.teaching_grant_targets(uuid, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.has_teaching_permission_any_scope(p_user_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RETURN false;
  END IF;
  IF public.has_api_permission(p_user_id, p_permission_key, NULL, NULL) THEN
    RETURN true;
  END IF;
  IF p_permission_key LIKE 'system.%' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM private.teaching_grant_targets(p_user_id) target
    WHERE public.has_api_permission(p_user_id, p_permission_key, target.classroom_id, target.class_session_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.accessible_class_session_ids(p_user_id uuid, p_permission_key text)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RETURN;
  END IF;
  IF public.has_api_permission(p_user_id, p_permission_key, NULL, NULL) THEN
    RETURN QUERY SELECT session.id FROM public.class_sessions session;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT session.id
    FROM private.teaching_grant_targets(p_user_id) target
    JOIN public.class_sessions session
      ON session.id = target.class_session_id
      OR (target.class_session_id IS NULL AND session.classroom_id = target.classroom_id)
    WHERE public.has_api_permission(p_user_id, p_permission_key, session.classroom_id, session.id);
END;
$function$;

-- A classroom is accessible when the permission holds at classroom level, or
-- in one of its class sessions (the classroom is then a read-only container
-- for those sessions).
CREATE OR REPLACE FUNCTION public.accessible_classroom_ids(p_user_id uuid, p_permission_key text)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RETURN;
  END IF;
  IF public.has_api_permission(p_user_id, p_permission_key, NULL, NULL) THEN
    RETURN QUERY SELECT classroom.id FROM public.classrooms classroom;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT target.classroom_id
    FROM private.teaching_grant_targets(p_user_id) target
    WHERE target.classroom_id IS NOT NULL
      AND public.has_api_permission(p_user_id, p_permission_key, target.classroom_id, target.class_session_id);
END;
$function$;

-- Platform data (courses, lessons, templates) readable from any scope.
CREATE OR REPLACE FUNCTION public.can_teaching_resource_action_any_scope(p_resource text, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.has_teaching_permission_any_scope(auth.uid(), 'teaching.' || p_resource || '.' || p_action)
      OR public.has_teaching_permission_any_scope(auth.uid(), 'teaching.' || p_resource || '.manage');
$function$;

-- Row-level check at a classroom / class-session scope (NULLs = platform).
CREATE OR REPLACE FUNCTION public.can_teaching_scope_action(p_resource text, p_action text, p_classroom_id uuid, p_class_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.has_api_permission(auth.uid(), 'teaching.' || p_resource || '.' || p_action, p_classroom_id, p_class_session_id)
      OR public.has_api_permission(auth.uid(), 'teaching.' || p_resource || '.manage', p_classroom_id, p_class_session_id);
$function$;

REVOKE ALL ON FUNCTION public.has_teaching_permission_any_scope(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accessible_class_session_ids(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accessible_classroom_ids(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_teaching_resource_action_any_scope(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_teaching_scope_action(text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_teaching_permission_any_scope(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accessible_class_session_ids(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accessible_classroom_ids(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_teaching_resource_action_any_scope(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_teaching_scope_action(text, text, uuid, uuid) TO authenticated, service_role;

-- Navigation and action summary for the caller: for each teaching permission,
-- whether it holds anywhere ("any") and at platform level ("platform").
CREATE OR REPLACE FUNCTION public.get_my_teaching_capabilities()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_keys text[] := ARRAY[
    'teaching.reports.list', 'teaching.reports.create', 'teaching.reports.update', 'teaching.reports.delete',
    'teaching.students.list', 'teaching.students.create', 'teaching.students.update', 'teaching.students.delete',
    'teaching.courses.list', 'teaching.courses.create', 'teaching.courses.update', 'teaching.courses.delete',
    'teaching.lessons.create', 'teaching.lessons.update', 'teaching.lessons.delete',
    'teaching.classrooms.list', 'teaching.classrooms.create', 'teaching.classrooms.update', 'teaching.classrooms.delete',
    'teaching.class_sessions.list', 'teaching.class_sessions.create', 'teaching.class_sessions.update', 'teaching.class_sessions.delete',
    'teaching.holidays.list', 'teaching.holidays.create', 'teaching.holidays.update', 'teaching.holidays.delete',
    'teaching.teachers.list', 'teaching.teachers.create', 'teaching.teachers.update', 'teaching.teachers.delete',
    'teaching.teachers.read_sensitive', 'teaching.teachers.update_sensitive',
    'teaching.roles.read', 'teaching.roles.manage', 'teaching.role_assignments.manage', 'teaching.permissions.read'
  ];
  v_key text;
  v_platform boolean;
  v_result jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  FOREACH v_key IN ARRAY v_keys LOOP
    v_platform := public.has_api_permission(v_user_id, v_key, NULL, NULL);
    v_result := v_result || jsonb_build_object(v_key, jsonb_build_object(
      'platform', v_platform,
      'any', v_platform OR public.has_teaching_permission_any_scope(v_user_id, v_key)
    ));
  END LOOP;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_teaching_capabilities() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_teaching_capabilities() TO authenticated;

-- 2. A classroom or class-session grant is an active teaching role. Report
-- update/delete (get_occurrence_report_mutation_context), enrollment scope
-- checks and idempotent delete replay all require it.
CREATE OR REPLACE FUNCTION public.has_active_teaching_role(p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_role_assignments assignment
    JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
    WHERE assignment.user_id = p_user_id
      AND assignment.status = 'active'
      AND assignment.effective_from <= CURRENT_DATE AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
  ) OR EXISTS (
    SELECT 1 FROM public.class_session_teacher_role_grants grant_row
    JOIN public.roles role ON role.id = grant_row.role_id AND role.domain = 'teaching'
    WHERE grant_row.user_id = p_user_id
      AND grant_row.effective_from <= CURRENT_DATE AND (grant_row.effective_to IS NULL OR grant_row.effective_to >= CURRENT_DATE)
  );
$function$;

-- 3. Report creation follows teaching.reports.create at the class session's
-- scope, and the enrollment must be on the occurrence's effective roster.
CREATE OR REPLACE FUNCTION public.can_create_occurrence_report(p_enrollment_id uuid, p_class_occurrence_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.class_occurrences occurrence
    JOIN public.class_sessions session ON session.id = occurrence.class_session_id
    JOIN public.enrollments enrollment ON enrollment.id = p_enrollment_id
    WHERE occurrence.id = p_class_occurrence_id
      AND EXISTS (
        SELECT 1 FROM public.get_effective_occurrence_enrollment_ids(occurrence.id) roster
        WHERE roster.enrollment_id = enrollment.id
      )
      AND public.can_teaching_scope_action('reports', 'create', session.classroom_id, session.id)
  );
$function$;

-- 4. RLS policies.
ALTER POLICY "Canonical classrooms read" ON public.classrooms
  USING (id IN (SELECT public.accessible_classroom_ids((SELECT auth.uid()), 'teaching.classrooms.read'))
      OR id IN (SELECT public.accessible_classroom_ids((SELECT auth.uid()), 'teaching.classrooms.list'))
      OR id IN (SELECT public.accessible_classroom_ids((SELECT auth.uid()), 'teaching.classrooms.manage')));
ALTER POLICY "Canonical classrooms update" ON public.classrooms
  USING (public.can_teaching_scope_action('classrooms', 'update', id, NULL))
  WITH CHECK (public.can_teaching_scope_action('classrooms', 'update', id, NULL));

ALTER POLICY "Canonical sessions read" ON public.class_sessions
  USING (id IN (SELECT public.accessible_class_session_ids((SELECT auth.uid()), 'teaching.class_sessions.read'))
      OR id IN (SELECT public.accessible_class_session_ids((SELECT auth.uid()), 'teaching.class_sessions.list'))
      OR id IN (SELECT public.accessible_class_session_ids((SELECT auth.uid()), 'teaching.class_sessions.manage')));
ALTER POLICY "Canonical sessions create" ON public.class_sessions
  WITH CHECK (public.can_teaching_scope_action('class_sessions', 'create', classroom_id, NULL));
ALTER POLICY "Canonical sessions update" ON public.class_sessions
  USING (public.can_teaching_scope_action('class_sessions', 'update', classroom_id, id))
  WITH CHECK (public.can_teaching_scope_action('class_sessions', 'update', classroom_id, id));
ALTER POLICY "Canonical sessions delete" ON public.class_sessions
  USING (public.can_teaching_scope_action('class_sessions', 'delete', classroom_id, id));

ALTER POLICY "Canonical courses read" ON public.courses
  USING ((SELECT public.can_teaching_resource_action_any_scope('courses', 'read'))
      OR (SELECT public.can_teaching_resource_action_any_scope('courses', 'list')));

ALTER POLICY "Teaching lessons read" ON public.lessons
  USING (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id)
     AND ((SELECT public.can_teaching_resource_action_any_scope('lessons', 'read'))
       OR (SELECT public.can_teaching_resource_action_any_scope('lessons', 'list'))));

ALTER POLICY "Teaching templates read" ON public.report_templates
  USING ((SELECT public.can_teaching_resource_action_any_scope('templates', 'read'))
      OR (SELECT public.can_teaching_resource_action_any_scope('templates', 'list'))
      OR instructor_id = (SELECT auth.uid()));

-- Platform-wide holidays (no classroom or session) are readable from any
-- scope; scoped holidays keep their per-classroom / per-session checks.
ALTER POLICY "Canonical holidays read" ON public.holidays
  USING (
    (COALESCE(cardinality(classroom_ids), 0) = 0
     AND COALESCE(cardinality(class_session_ids), 0) = 0
     AND ((SELECT public.has_teaching_permission_any_scope((SELECT auth.uid()), 'teaching.holidays.read'))
       OR (SELECT public.has_teaching_permission_any_scope((SELECT auth.uid()), 'teaching.holidays.list'))))
    OR (
      (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(holidays.classroom_ids, '{}'::uuid[])) scoped_classroom(scoped_classroom_id)
        WHERE NOT (public.can_access_classroom(scoped_classroom.scoped_classroom_id, 'teaching.holidays.read')
          OR public.can_access_classroom(scoped_classroom.scoped_classroom_id, 'teaching.holidays.list'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(holidays.class_session_ids, '{}'::uuid[])) scoped_session(scoped_session_id)
        WHERE NOT (public.can_access_class_session(scoped_session.scoped_session_id, 'teaching.holidays.read')
          OR public.can_access_class_session(scoped_session.scoped_session_id, 'teaching.holidays.list'))
      )
    )
  );

ALTER POLICY "Canonical reports update" ON public.occurrence_reports
  USING (public.can_access_occurrence_report(id) OR public.can_access_report(id, 'teaching.reports.update'))
  WITH CHECK (public.can_access_occurrence_report(id) OR EXISTS (
    SELECT 1 FROM public.class_occurrences occurrence
    JOIN public.class_sessions session ON session.id = occurrence.class_session_id
    WHERE occurrence.id = occurrence_reports.class_occurrence_id
      AND public.can_teaching_scope_action('reports', 'update', session.classroom_id, session.id)
  ));

-- 5. Overview RPCs filtered by scope.

CREATE OR REPLACE FUNCTION public.get_dashboard_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_global_students boolean;
  v_any_students boolean;
  v_courses boolean;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;

  v_global_students := public.has_api_permission(v_user_id, 'teaching.students.read', NULL, NULL);
  v_any_students := v_global_students OR public.has_teaching_permission_any_scope(v_user_id, 'teaching.students.read');
  v_courses := public.can_teaching_resource_action_any_scope('courses', 'read')
            OR public.can_teaching_resource_action_any_scope('courses', 'list');

  RETURN (
    WITH enrollment_scopes AS MATERIALIZED (
      SELECT enrollment.student_id,
             COALESCE(enrollment.classroom_id, session.classroom_id) AS classroom_id,
             session.id AS class_session_id
      FROM public.enrollments enrollment
      LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
      WHERE v_any_students
    ),
    visible_student_ids AS MATERIALIZED (
      SELECT student.id FROM public.students student WHERE student.user_id = v_user_id
      UNION
      SELECT enrollment.student_id FROM enrollment_scopes enrollment WHERE v_global_students
      UNION
      SELECT enrollment.student_id FROM enrollment_scopes enrollment
      WHERE NOT v_global_students
        AND (enrollment.classroom_id IS NOT NULL OR enrollment.class_session_id IS NOT NULL)
        AND public.has_api_permission(v_user_id, 'teaching.students.read',
              enrollment.classroom_id, enrollment.class_session_id)
    )
    SELECT jsonb_build_object(
      'totalStudents', (SELECT count(*) FROM visible_student_ids),
      'activeCourses', (SELECT count(*) FROM public.courses course WHERE v_courses)
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
    SELECT public.accessible_classroom_ids(v_user_id, 'teaching.classrooms.read') AS id
    UNION SELECT public.accessible_classroom_ids(v_user_id, 'teaching.classrooms.list')
    UNION SELECT public.accessible_classroom_ids(v_user_id, 'teaching.classrooms.manage')
  ),
  session_scopes AS MATERIALIZED (
    SELECT public.accessible_class_session_ids(v_user_id, 'teaching.class_sessions.read') AS id
    UNION SELECT public.accessible_class_session_ids(v_user_id, 'teaching.class_sessions.list')
    UNION SELECT public.accessible_class_session_ids(v_user_id, 'teaching.class_sessions.manage')
  ),
  visible_classrooms AS MATERIALIZED (
    SELECT classroom.id, classroom.name, classroom.color, classroom.external_link,
           classroom.teaching_id, classroom.user_id, classroom.created_at, classroom.updated_at,
           EXISTS (SELECT 1 FROM hidden WHERE entity_type = 'classroom' AND entity_id = classroom.id) AS is_hidden
    FROM public.classrooms classroom
    JOIN classroom_scopes scope ON scope.id = classroom.id
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
    JOIN session_scopes scope ON scope.id = session.id
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
    WHERE public.can_teaching_resource_action_any_scope('courses', 'read')
       OR public.can_teaching_resource_action_any_scope('courses', 'list')
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

  -- The teachers view applies can_access_teacher: the caller's own record,
  -- every teacher for a platform-level read grant (including teachers with
  -- no class assignment yet), or teachers sharing a class session the caller
  -- may read teachers in.
  WITH access AS MATERIALIZED (
    SELECT public.has_teaching_permission_any_scope(v_user_id, 'teaching.teachers.read')
        OR public.has_teaching_permission_any_scope(v_user_id, 'teaching.teachers.list') AS allowed
  ),
  visible_teachers AS MATERIALIZED (
    SELECT teacher.id, teacher.user_id, teacher.name, teacher.bio, teacher.bio_document,
           teacher.created_at, teacher.updated_at
    FROM public.teachers teacher CROSS JOIN access
    WHERE teacher.user_id = v_user_id OR access.allowed
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
    SELECT public.accessible_class_session_ids(v_user_id, 'teaching.reports.read') AS id
    UNION SELECT public.accessible_class_session_ids(v_user_id, 'teaching.reports.list')
    UNION SELECT public.accessible_class_session_ids(v_user_id, 'teaching.reports.manage')
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
    JOIN readable_scopes scope ON scope.id = session.id
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

CREATE OR REPLACE FUNCTION public.get_holidays_overview(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT '',
  p_sort text DEFAULT '-start_date',
  p_expand boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_search text := btrim(COALESCE(p_search, ''));
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
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
  IF p_sort IS NULL OR p_sort NOT IN ('start_date', '-start_date', 'name', '-name') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SORT';
  END IF;

  WITH visible AS MATERIALIZED (
    SELECT holiday.id, holiday.name, holiday.kind, holiday.time_zone,
           holiday.created_at, holiday.updated_at, holiday.start_date,
           holiday.end_date, holiday.classroom_ids, holiday.class_session_ids,
           holiday.teacher_ids
    FROM public.holidays holiday
    WHERE (
      (COALESCE(cardinality(holiday.classroom_ids), 0) = 0
       AND COALESCE(cardinality(holiday.class_session_ids), 0) = 0
       AND (public.has_teaching_permission_any_scope(v_user_id, 'teaching.holidays.read')
         OR public.has_teaching_permission_any_scope(v_user_id, 'teaching.holidays.list')))
      OR (
        (COALESCE(cardinality(holiday.classroom_ids), 0) > 0
          OR COALESCE(cardinality(holiday.class_session_ids), 0) > 0)
        AND NOT EXISTS (
          SELECT 1 FROM unnest(COALESCE(holiday.classroom_ids, '{}'::uuid[])) scoped(classroom_id)
          WHERE NOT (public.can_access_classroom(scoped.classroom_id, 'teaching.holidays.read')
            OR public.can_access_classroom(scoped.classroom_id, 'teaching.holidays.list'))
        )
        AND NOT EXISTS (
          SELECT 1 FROM unnest(COALESCE(holiday.class_session_ids, '{}'::uuid[])) scoped(class_session_id)
          WHERE NOT (public.can_access_class_session(scoped.class_session_id, 'teaching.holidays.read')
            OR public.can_access_class_session(scoped.class_session_id, 'teaching.holidays.list'))
        )
      )
    )
  ),
  filtered AS MATERIALIZED (
    SELECT visible.*
    FROM visible
    WHERE v_search = '' OR strpos(lower(COALESCE(visible.name, '')), lower(v_search)) > 0
  ),
  ordered AS MATERIALIZED (
    SELECT filtered.*, row_number() OVER (ORDER BY
      CASE WHEN p_sort = 'start_date' THEN filtered.start_date END ASC,
      CASE WHEN p_sort = '-start_date' THEN filtered.start_date END DESC,
      CASE WHEN p_sort = 'name' THEN lower(COALESCE(filtered.name, '')) END ASC,
      CASE WHEN p_sort = '-name' THEN lower(COALESCE(filtered.name, '')) END DESC,
      filtered.id
    ) AS page_ordinal
    FROM filtered
  ),
  page AS MATERIALIZED (
    SELECT * FROM ordered ORDER BY page_ordinal LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', item.id, 'name', item.name, 'kind', item.kind, 'time_zone', item.time_zone,
        'created_at', item.created_at,
        'updated_at', item.updated_at, 'start_date', item.start_date,
        'end_date', item.end_date, 'classroom_ids', item.classroom_ids,
        'class_session_ids', item.class_session_ids,
        'classroomNames', CASE WHEN p_expand THEN COALESCE((SELECT jsonb_agg(classroom.name ORDER BY classroom.name) FROM public.classrooms classroom WHERE classroom.id = ANY(COALESCE(item.classroom_ids, '{}'::uuid[]))), '[]'::jsonb) ELSE '[]'::jsonb END,
        'classSessionNames', CASE WHEN p_expand THEN COALESCE((SELECT jsonb_agg(session.name ORDER BY session.name) FROM public.class_sessions session WHERE session.id = ANY(COALESCE(item.class_session_ids, '{}'::uuid[]))), '[]'::jsonb) ELSE '[]'::jsonb END,
        'teacher_ids', item.teacher_ids,
        'teacherNames', CASE WHEN p_expand THEN COALESCE((SELECT jsonb_agg(teacher.name ORDER BY teacher.name) FROM public.teachers teacher WHERE teacher.id = ANY(COALESCE(item.teacher_ids, '{}'::uuid[]))), '[]'::jsonb) ELSE '[]'::jsonb END
      ) ORDER BY item.page_ordinal)
      FROM page item
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_holidays_overview(integer, integer, text, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_holidays_overview(integer, integer, text, text, boolean) TO authenticated;

COMMIT;
