-- Page API performance read models (courses and teachers).
--
-- These narrow SECURITY DEFINER functions replace exact-count PostgREST
-- queries whose RLS predicates recursively resolve the same teaching scope for
-- every returned row.  They never accept a user id, use auth.uid(), project
-- only page-safe fields, and reconstruct the same canonical permission scope
-- once per teaching.

DO $$
BEGIN
  IF to_regclass('public.teachings') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.lessons') IS NULL
     OR to_regclass('public.teachers') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.occurrence_reports') IS NULL
     OR to_regclass('public.class_occurrences') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.classroom_schedules') IS NULL
     OR to_regclass('public.class_session_schedule_rules') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.class_session_teachers') IS NULL
     OR to_regclass('public.holidays') IS NULL
     OR to_regprocedure('public.can_teaching_action(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION '1000078 prerequisites missing; apply migrations through 1000077 first';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS lessons_course_id_sequence_idx
  ON public.lessons USING btree (course_id, sequence, id);

CREATE INDEX IF NOT EXISTS courses_teaching_display_name_idx
  ON public.courses USING btree (teaching_id, display_name, id);

CREATE INDEX IF NOT EXISTS class_sessions_teaching_id_idx
  ON public.class_sessions USING btree (teaching_id);

CREATE INDEX IF NOT EXISTS class_session_teachers_session_teacher_idx
  ON public.class_session_teachers USING btree (class_session_id, teacher_id);

CREATE INDEX IF NOT EXISTS teachers_user_id_idx
  ON public.teachers USING btree (user_id);

CREATE INDEX IF NOT EXISTS class_occurrences_date_session_idx
  ON public.class_occurrences USING btree (occurrence_date, class_session_id, id);

CREATE INDEX IF NOT EXISTS occurrence_reports_occurrence_status_idx
  ON public.occurrence_reports USING btree (class_occurrence_id, attendance_status, updated_at, id);

CREATE INDEX IF NOT EXISTS enrollments_class_session_student_idx
  ON public.enrollments USING btree (class_session_id, student_id, id);

CREATE INDEX IF NOT EXISTS holidays_date_idx
  ON public.holidays USING btree (start_date, end_date, id);

CREATE OR REPLACE FUNCTION public.get_courses_overview(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT '',
  p_sort text DEFAULT 'display_name'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
  IF p_sort IS NULL OR p_sort NOT IN (
    'display_name', '-display_name', 'subject', '-subject',
    'stage', '-stage', 'created_at', '-created_at'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SORT';
  END IF;

  WITH readable_teachings AS MATERIALIZED (
    SELECT teaching.id
    FROM public.teachings teaching
    WHERE public.can_teaching_action(teaching.id, 'courses', 'read')
       OR public.can_teaching_action(teaching.id, 'courses', 'list')
  ),
  filtered_courses AS MATERIALIZED (
    SELECT course.id, course.subject, course.stage, course.display_name,
           course.description, course.description_document, course.teaching_id,
           course.user_id, course.created_at, course.updated_at
    FROM public.courses course
    JOIN readable_teachings teaching ON teaching.id = course.teaching_id
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
$$;

CREATE OR REPLACE FUNCTION public.get_teachers_overview(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT '',
  p_sort text DEFAULT 'name'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
  IF p_sort IS NULL OR p_sort NOT IN ('name', '-name', 'created_at', '-created_at') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SORT';
  END IF;

  WITH readable_teachings AS MATERIALIZED (
    SELECT teaching.id
    FROM public.teachings teaching
    WHERE public.can_teaching_action(teaching.id, 'teachers', 'read')
       OR public.can_teaching_action(teaching.id, 'teachers', 'list')
  ),
  visible_teacher_ids AS MATERIALIZED (
    SELECT teacher.id FROM public.teachers teacher WHERE teacher.user_id = v_user_id
    UNION
    SELECT assignment.teacher_id
    FROM public.class_session_teachers assignment
    JOIN public.class_sessions session ON session.id = assignment.class_session_id
    JOIN readable_teachings teaching ON teaching.id = session.teaching_id
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
$$;

CREATE OR REPLACE FUNCTION public.get_classrooms_overview(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT '',
  p_visibility text DEFAULT 'all',
  p_session_limit integer DEFAULT 50,
  p_session_offset integer DEFAULT 0,
  p_classroom_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_search text := btrim(COALESCE(p_search, ''));
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_session_limit IS NULL OR p_session_limit < 1 OR p_session_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_LIMIT';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000
     OR p_session_offset IS NULL OR p_session_offset < 0 OR p_session_offset > 1000000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_OFFSET';
  END IF;
  IF char_length(v_search) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SEARCH';
  END IF;
  IF p_visibility IS NULL OR p_visibility NOT IN ('all', 'visible', 'hidden') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_VISIBILITY';
  END IF;

  WITH hidden AS MATERIALIZED (
    SELECT entity_type, entity_id
    FROM public.user_entity_visibility_preferences
    WHERE user_id = v_user_id AND is_hidden IS TRUE
      AND entity_type IN ('classroom', 'class_session')
  ),
  classroom_teachings AS MATERIALIZED (
    SELECT teaching.id
    FROM public.teachings teaching
    WHERE public.can_teaching_action(teaching.id, 'classrooms', 'read')
       OR public.can_teaching_action(teaching.id, 'classrooms', 'list')
  ),
  session_teachings AS MATERIALIZED (
    SELECT teaching.id
    FROM public.teachings teaching
    WHERE public.can_teaching_action(teaching.id, 'class_sessions', 'read')
       OR public.can_teaching_action(teaching.id, 'class_sessions', 'list')
  ),
  visible_classrooms AS MATERIALIZED (
    SELECT classroom.id, classroom.name, classroom.color, classroom.external_link,
           classroom.teaching_id, classroom.user_id, classroom.created_at, classroom.updated_at,
           EXISTS (SELECT 1 FROM hidden WHERE entity_type = 'classroom' AND entity_id = classroom.id) AS is_hidden
    FROM public.classrooms classroom
    JOIN classroom_teachings teaching ON teaching.id = classroom.teaching_id
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
    JOIN session_teachings teaching ON teaching.id = session.teaching_id
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
$$;

CREATE OR REPLACE FUNCTION public.get_incomplete_reports_page(
  p_days_back integer DEFAULT 90,
  p_scope text DEFAULT 'all',
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
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

  WITH readable_teachings AS MATERIALIZED (
    SELECT teaching.id
    FROM public.teachings teaching
    WHERE public.can_teaching_action(teaching.id, 'reports', 'read')
       OR public.can_teaching_action(teaching.id, 'reports', 'list')
  ),
  current_teacher AS MATERIALIZED (
    SELECT teacher.id
    FROM public.teachers teacher
    WHERE teacher.user_id = v_user_id
    ORDER BY teacher.id
    LIMIT 1
  ),
  candidates AS MATERIALIZED (
    SELECT report.id, report.enrollment_id, report.class_occurrence_id,
           report.content, report.lesson_id, report.is_completed,
           report.progress_letter, report.attendance_status,
           report.class_participation, report.classroom_behavior,
           report.version, report.updated_at,
           enrollment.course_id,
           student.name AS student_name,
           occurrence.occurrence_date,
           occurrence.teacher_ids, occurrence.teacher_attendance,
           session.name AS class_name,
           classroom.name AS classroom_name
    FROM public.occurrence_reports report
    JOIN public.enrollments enrollment ON enrollment.id = report.enrollment_id
    JOIN public.students student ON student.id = enrollment.student_id
    JOIN public.class_occurrences occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.class_sessions session ON session.id = occurrence.class_session_id
    LEFT JOIN public.classrooms classroom ON classroom.id = session.classroom_id
    JOIN readable_teachings teaching ON teaching.id = session.teaching_id
    WHERE report.attendance_status = 'present'
      AND occurrence.occurrence_date BETWEEN (CURRENT_DATE - p_days_back) AND CURRENT_DATE
  ),
  flagged AS (
    SELECT candidate.*,
           (NULLIF(btrim(COALESCE(candidate.content, '')), '') IS NULL) AS missing_content,
           (candidate.lesson_id IS NULL) AS missing_lesson,
           (NOT (candidate.is_completed IS TRUE OR NULLIF(btrim(COALESCE(candidate.progress_letter, '')), '') IS NOT NULL)) AS missing_progress,
           (NOT (candidate.class_participation IS NOT NULL AND candidate.class_participation > 0)) AS missing_participation,
           (NOT (candidate.classroom_behavior IS NOT NULL AND candidate.classroom_behavior > 0)) AS missing_behavior
    FROM candidates candidate
  ),
  filtered AS MATERIALIZED (
    SELECT flagged.*,
           (flagged.missing_content OR flagged.missing_lesson OR flagged.missing_progress
            OR flagged.missing_participation OR flagged.missing_behavior) AS is_missing
    FROM flagged
    LEFT JOIN current_teacher teacher ON TRUE
    WHERE (p_scope = 'all' OR (
      teacher.id IS NOT NULL
      AND (teacher.id = ANY(COALESCE(flagged.teacher_ids, '{}'::uuid[]))
        OR v_user_id = ANY(COALESCE(flagged.teacher_ids, '{}'::uuid[])))
      AND NOT (flagged.teacher_attendance ->> teacher.id::text = 'false'
        OR flagged.teacher_attendance ->> v_user_id::text = 'false')
      AND (flagged.teacher_attendance ->> teacher.id::text = 'true'
        OR flagged.teacher_attendance ->> v_user_id::text = 'true')
    ))
  ),
  incomplete AS MATERIALIZED (
    SELECT filtered.*
    FROM filtered
    WHERE filtered.is_missing
  ),
  ordered AS MATERIALIZED (
    SELECT incomplete.*, row_number() OVER (ORDER BY incomplete.updated_at DESC NULLS LAST, incomplete.id) AS page_ordinal
    FROM incomplete
  ),
  page AS MATERIALIZED (
    SELECT * FROM ordered ORDER BY page_ordinal LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', item.id, 'reportId', item.id, 'enrollmentId', item.enrollment_id,
        'occurrenceId', item.class_occurrence_id, 'studentName', COALESCE(item.student_name, 'Unknown'),
        'courseId', item.course_id, 'className', COALESCE(item.class_name, '-'),
        'classroomName', COALESCE(item.classroom_name, '-'), 'date', item.occurrence_date,
        'content', COALESCE(item.content, ''), 'missingContent', item.missing_content,
        'missingLesson', item.missing_lesson, 'missingProgress', item.missing_progress,
        'missingParticipation', item.missing_participation, 'missingBehavior', item.missing_behavior,
        'isMissing', item.is_missing, 'version', item.version,
        'attendanceStatus', item.attendance_status, 'updatedAt', item.updated_at
      ) ORDER BY item.page_ordinal)
      FROM page item
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM incomplete)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

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
AS $$
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
       AND (public.has_api_permission(v_user_id, 'teaching.holidays.read', NULL::uuid, NULL::uuid)
         OR public.has_api_permission(v_user_id, 'teaching.holidays.list', NULL::uuid, NULL::uuid)))
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
$$;

CREATE OR REPLACE FUNCTION public.get_class_session_workspace(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_session_id IS NULL OR NOT (
    public.can_access_class_session(p_session_id, 'teaching.class_sessions.read')
    OR public.can_access_class_session(p_session_id, 'teaching.class_sessions.list')
  ) THEN
    RETURN jsonb_build_object('session', NULL, 'enrollments', '[]'::jsonb, 'teachers', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'session', (
      SELECT jsonb_build_object(
        'id', session.id, 'name', session.name, 'classroom_id', session.classroom_id,
        'course_ids', session.course_ids, 'day_of_week', session.day_of_week,
        'start_time', session.start_time, 'end_time', session.end_time,
        'capacity', session.capacity, 'lesson_number', session.lesson_number,
        'external_link', session.external_link, 'start_date', session.start_date,
        'end_date', session.end_date, 'time_zone', session.time_zone,
        'session_type', session.session_type, 'schedule_mode', session.schedule_mode,
        'created_at', session.created_at, 'updated_at', session.updated_at,
        'classrooms', (SELECT CASE WHEN classroom.id IS NULL THEN NULL ELSE jsonb_build_object('id', classroom.id, 'name', classroom.name, 'color', classroom.color, 'external_link', classroom.external_link) END FROM public.classrooms classroom WHERE classroom.id = session.classroom_id),
        'schedule_rules', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', rule.id, 'schedule_kind', rule.schedule_kind, 'day_of_week', rule.day_of_week,
          'day_of_month', rule.day_of_month, 'occurrence_date', rule.occurrence_date,
          'start_time', rule.start_time, 'end_time', rule.end_time
        ) ORDER BY rule.occurrence_date NULLS LAST, rule.day_of_week NULLS LAST, rule.start_time, rule.id)
        FROM public.class_session_schedule_rules rule WHERE rule.class_session_id = session.id), '[]'::jsonb)
      )
      FROM public.class_sessions session WHERE session.id = p_session_id
    ),
    'enrollments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', enrollment.id, 'student_id', enrollment.student_id, 'course_id', enrollment.course_id,
        'classroom_id', enrollment.classroom_id, 'class_session_id', enrollment.class_session_id,
        'status', enrollment.status, 'start_date', enrollment.start_date,
        'lesson_number', enrollment.lesson_number, 'external_link', enrollment.external_link,
        'time_zone', enrollment.time_zone, 'koding_admission_id', enrollment.koding_admission_id,
        'created_at', enrollment.created_at, 'updated_at', enrollment.updated_at,
        'courses', (SELECT jsonb_build_object('subject', course.subject, 'stage', course.stage, 'display_name', course.display_name) FROM public.courses course WHERE course.id = enrollment.course_id),
        'classrooms', (SELECT jsonb_build_object('name', classroom.name) FROM public.classrooms classroom WHERE classroom.id = enrollment.classroom_id),
        'students', (SELECT jsonb_build_object('name', student.name) FROM public.students student WHERE student.id = enrollment.student_id)
      ) ORDER BY enrollment.created_at, enrollment.id)
      FROM public.enrollments enrollment WHERE enrollment.class_session_id = p_session_id
    ), '[]'::jsonb),
    'teachers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', teacher.id, 'user_id', teacher.user_id, 'name', teacher.name) ORDER BY teacher.name, teacher.id)
      FROM public.class_session_teachers assignment
      JOIN public.teachers teacher ON teacher.id = assignment.teacher_id
      WHERE assignment.class_session_id = p_session_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_courses_overview(integer, integer, text, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_teachers_overview(integer, integer, text, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_classrooms_overview(integer, integer, text, text, integer, integer, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_incomplete_reports_page(integer, text, integer, integer)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_holidays_overview(integer, integer, text, text, boolean)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_class_session_workspace(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_courses_overview(integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teachers_overview(integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_classrooms_overview(integer, integer, text, text, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_incomplete_reports_page(integer, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_holidays_overview(integer, integer, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_session_workspace(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_courses_overview(integer, integer, text, text)
  IS 'Safe, set-based course Page API read model using the caller JWT and canonical teaching permissions.';
COMMENT ON FUNCTION public.get_teachers_overview(integer, integer, text, text)
  IS 'Safe, set-based teacher Page API read model using the caller JWT and canonical teaching permissions.';
COMMENT ON FUNCTION public.get_classrooms_overview(integer, integer, text, text, integer, integer, uuid)
  IS 'Safe, set-based classroom and class-session Page API read model using the caller JWT and visibility preferences.';
COMMENT ON FUNCTION public.get_incomplete_reports_page(integer, text, integer, integer)
  IS 'Safe, set-based incomplete report Page API read model with server-side completeness, scope, and pagination.';
COMMENT ON FUNCTION public.get_holidays_overview(integer, integer, text, text, boolean)
  IS 'Safe, set-based holiday Page API read model with canonical scoped visibility.';
COMMENT ON FUNCTION public.get_class_session_workspace(uuid)
  IS 'Safe class-session workspace Page API read model scoped by the caller JWT.';

NOTIFY pgrst, 'reload schema';
