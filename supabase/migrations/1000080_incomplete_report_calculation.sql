-- Canonical incomplete-report calculation for the report workflow Page API.
--
-- This is append-only.  The previous read model remains in migration history;
-- this forward migration replaces its old signature with the complete contract
-- used by the Express API.

DO $$
BEGIN
  IF to_regclass('public.occurrence_reports') IS NULL
     OR to_regclass('public.class_occurrences') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.teachers') IS NULL
     OR to_regclass('public.teaching_members') IS NULL
     OR to_regclass('public.user_preferences') IS NULL
     OR to_regprocedure('public.can_teaching_action(uuid,text,text)') IS NULL
     OR to_regprocedure('public.resolve_incomplete_report_notification_permission(uuid,uuid,uuid,date)') IS NULL THEN
    RAISE EXCEPTION '1000080 prerequisites missing; apply migrations through 1000079 first';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS class_occurrences_date_session_id_idx
  ON public.class_occurrences USING btree (occurrence_date, class_session_id, id);

CREATE INDEX IF NOT EXISTS occurrence_reports_occurrence_attendance_idx
  ON public.occurrence_reports USING btree (class_occurrence_id, attendance_status, updated_at, id);

CREATE INDEX IF NOT EXISTS class_session_teachers_user_session_effective_idx
  ON public.class_session_teachers USING btree (teacher_id, class_session_id, effective_from, effective_to);

DROP FUNCTION IF EXISTS public.get_incomplete_reports_page(integer, text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_incomplete_reports_page(
  p_days_back integer DEFAULT 90,
  p_scope text DEFAULT 'all',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT '',
  p_sort text DEFAULT '-date'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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

  v_end_date := (CURRENT_TIMESTAMP AT TIME ZONE v_time_zone)::date;
  v_start_date := v_end_date - (p_days_back - 1);

  WITH readable_teachings AS MATERIALIZED (
    SELECT teaching.id
    FROM public.teachings teaching
    WHERE public.can_teaching_action(teaching.id, 'reports', 'read')
       OR public.can_teaching_action(teaching.id, 'reports', 'list')
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
    JOIN readable_teachings teaching ON teaching.id = session.teaching_id
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
             AND NOT (
               candidate.teacher_attendance ->> identity.id::text = 'false'
               OR candidate.teacher_attendance ->> v_user_id::text = 'false'
             )
             AND (
               candidate.teacher_attendance ->> identity.id::text = 'true'
               OR candidate.teacher_attendance ->> v_user_id::text = 'true'
             )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM current_teachers identity
           WHERE (identity.id = ANY(COALESCE(candidate.teacher_ids, '{}'::uuid[]))
                  OR v_user_id = ANY(COALESCE(candidate.teacher_ids, '{}'::uuid[])))
             AND (
               candidate.teacher_attendance ->> identity.id::text = 'false'
               OR candidate.teacher_attendance ->> v_user_id::text = 'false'
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
$$;

REVOKE ALL ON FUNCTION public.get_incomplete_reports_page(integer, text, integer, integer, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_incomplete_reports_page(integer, text, integer, integer, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.get_incomplete_reports_page(integer, text, integer, integer, text, text)
  IS 'Canonical incomplete-report Page API read model with exact five-field completeness, timezone-aware range, presence/policy scope, search, sort, and pagination.';

NOTIFY pgrst, 'reload schema';
