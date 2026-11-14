-- Validate attendance against the dated assignment and the caller's scoped rights.
CREATE FUNCTION private.assert_teacher_attendance_change(p_session uuid, p_date date, p_teacher uuid, p_present boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_classroom uuid;
  v_account uuid;
BEGIN
  SELECT session.classroom_id INTO v_classroom FROM public.class_sessions session WHERE session.id = p_session;
  SELECT profile.auth_user_id INTO v_account
  FROM public.class_session_teachers assignment
  JOIN public.teacher_records teacher ON teacher.id = assignment.teacher_id
  JOIN public.profiles profile ON profile.id = teacher.profile_id
  WHERE assignment.class_session_id = p_session AND assignment.teacher_id = p_teacher
    AND assignment.effective_from <= p_date AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_date)
  LIMIT 1;
  IF NOT FOUND OR v_caller IS NULL OR NOT (
    (v_account = v_caller AND (public.has_api_permission(v_caller, 'teaching.occurrences.read', NULL, p_session)
                            OR public.has_api_permission(v_caller, 'teaching.occurrences.list', NULL, p_session)))
    OR (public.has_api_permission(v_caller, 'teaching.class_sessions.update', NULL, p_session)
        AND public.has_api_permission(v_caller, 'teaching.roles.manage', NULL, p_session))
  ) IS TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;
  IF p_present AND EXISTS (
    SELECT 1 FROM public.holidays h WHERE p_date BETWEEN h.start_date AND h.end_date
      AND h.kind = 'closure'
      AND ((COALESCE(cardinality(h.classroom_ids), 0) = 0 AND COALESCE(cardinality(h.class_session_ids), 0) = 0)
        OR p_session = ANY(h.class_session_ids) OR v_classroom = ANY(h.classroom_ids))
  ) THEN RAISE EXCEPTION 'HOLIDAY_OCCURRENCE'; END IF;
  IF p_present AND EXISTS (
    SELECT 1 FROM public.holidays h WHERE p_date BETWEEN h.start_date AND h.end_date
      AND h.kind = 'teacher_leave' AND p_teacher = ANY(h.teacher_ids)
      AND ((COALESCE(cardinality(h.classroom_ids), 0) = 0 AND COALESCE(cardinality(h.class_session_ids), 0) = 0)
        OR p_session = ANY(h.class_session_ids) OR v_classroom = ANY(h.classroom_ids))
  ) THEN RAISE EXCEPTION 'TEACHER_ON_LEAVE'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_teacher_attendance_change(uuid,date,uuid,boolean) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.guard_teacher_attendance_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := COALESCE(NEW.teacher_attendance, '{}'::jsonb);
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN v_old := COALESCE(OLD.teacher_attendance, '{}'::jsonb); END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_old || v_new) LOOP
    IF v_old->v_key IS DISTINCT FROM v_new->v_key THEN
      IF jsonb_typeof(v_new->v_key) IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ATTENDANCE';
      END IF;
      PERFORM private.assert_teacher_attendance_change(NEW.class_session_id, NEW.occurrence_date, v_key::uuid, (v_new->>v_key)::boolean);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_teacher_attendance_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_teacher_attendance_change
  BEFORE INSERT OR UPDATE OF teacher_attendance ON public.class_occurrences
  FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_attendance_change();

CREATE FUNCTION public.set_occurrence_teacher_attendance(p_occurrence uuid, p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row public.class_occurrences%ROWTYPE;
  v_change record;
BEGIN
  IF auth.uid() IS NULL OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;
  SELECT * INTO v_row FROM public.class_occurrences WHERE id = p_occurrence FOR UPDATE;
  IF NOT FOUND OR NOT (
    public.has_api_permission(auth.uid(), 'teaching.occurrences.read', NULL, v_row.class_session_id)
    OR public.has_api_permission(auth.uid(), 'teaching.occurrences.list', NULL, v_row.class_session_id)
  ) IS TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;
  FOR v_change IN SELECT * FROM jsonb_each(p_changes) LOOP
    IF jsonb_typeof(v_change.value) <> 'boolean' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ATTENDANCE';
    END IF;
    PERFORM private.assert_teacher_attendance_change(v_row.class_session_id, v_row.occurrence_date, v_change.key::uuid, v_change.value::boolean);
  END LOOP;
  UPDATE public.class_occurrences SET teacher_attendance = COALESCE(v_row.teacher_attendance, '{}'::jsonb) || p_changes
  WHERE id = p_occurrence RETURNING teacher_attendance INTO v_row.teacher_attendance;
  RETURN v_row.teacher_attendance;
END;
$$;
REVOKE ALL ON FUNCTION public.set_occurrence_teacher_attendance(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_occurrence_teacher_attendance(uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';

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
           SELECT 1 FROM current_teachers identity
           JOIN public.class_session_teachers assignment
             ON assignment.teacher_id = identity.id AND assignment.class_session_id = candidate.class_session_id
           WHERE candidate.occurrence_date BETWEEN assignment.effective_from AND COALESCE(assignment.effective_to, 'infinity'::date)
             AND COALESCE(candidate.teacher_attendance ->> identity.id::text,
                          candidate.teacher_attendance ->> v_user_id::text) = 'true'
             AND NOT EXISTS (
               SELECT 1 FROM public.holidays holiday
               WHERE holiday.kind = 'teacher_leave' AND identity.id = ANY(holiday.teacher_ids)
                 AND candidate.occurrence_date BETWEEN holiday.start_date AND holiday.end_date
                 AND ((COALESCE(cardinality(holiday.classroom_ids), 0) = 0 AND COALESCE(cardinality(holiday.class_session_ids), 0) = 0)
                   OR candidate.class_session_id = ANY(holiday.class_session_ids) OR candidate.classroom_id = ANY(holiday.classroom_ids))
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


-- Keep the effective history when an administrator ends an assignment.
CREATE FUNCTION public.end_class_session_teacher_assignments(p_session uuid, p_teacher uuid, p_effective_from date)
RETURNS SETOF public.class_session_teachers
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_today date;
BEGIN
  IF NOT (public.has_api_permission(auth.uid(), 'teaching.class_sessions.update', NULL, p_session)
      AND public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, p_session)) IS TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE session.time_zone)::date INTO v_today
  FROM public.class_sessions session WHERE session.id = p_session;
  PERFORM 1 FROM public.class_sessions WHERE id = p_session FOR NO KEY UPDATE;
  RETURN QUERY UPDATE public.class_session_teachers assignment SET effective_to = v_today - 1
  WHERE assignment.class_session_id = p_session AND (p_teacher IS NULL OR assignment.teacher_id = p_teacher)
    AND (p_effective_from IS NULL OR assignment.effective_from = p_effective_from)
    AND assignment.effective_from < v_today AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_today)
  RETURNING assignment.*;
  RETURN QUERY DELETE FROM public.class_session_teachers assignment
  WHERE assignment.class_session_id = p_session AND (p_teacher IS NULL OR assignment.teacher_id = p_teacher)
    AND (p_effective_from IS NULL OR assignment.effective_from = p_effective_from)
    AND assignment.effective_from >= v_today
  RETURNING assignment.*;
END;
$$;
REVOKE ALL ON FUNCTION public.end_class_session_teacher_assignments(uuid,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_class_session_teacher_assignments(uuid,uuid,date) TO authenticated;
CREATE OR REPLACE FUNCTION public.replace_class_session_teacher_assignments(p_session_id uuid, p_teachers jsonb)
RETURNS SETOF public.class_session_teachers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_classroom uuid;
  v_today date;
  v_item jsonb;
BEGIN
  SELECT session.classroom_id, (CURRENT_TIMESTAMP AT TIME ZONE session.time_zone)::date
  INTO v_classroom, v_today FROM public.class_sessions session WHERE session.id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'CLASS_SESSION_NOT_FOUND'; END IF;
  IF auth.uid() IS NULL OR NOT (
    public.has_api_permission(auth.uid(), 'teaching.class_sessions.update', v_classroom, p_session_id)
    AND public.has_api_permission(auth.uid(), 'teaching.roles.manage', v_classroom, p_session_id)
  ) IS TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEACHER_ASSIGNMENT_REQUIRES_ROLE_MANAGEMENT';
  END IF;
  IF jsonb_typeof(p_teachers) IS DISTINCT FROM 'array' OR jsonb_array_length(p_teachers) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_TEACHER_ASSIGNMENTS';
  END IF;
  PERFORM 1 FROM public.class_sessions WHERE id = p_session_id FOR NO KEY UPDATE;
  UPDATE public.class_session_teachers assignment SET effective_to = v_today - 1
  WHERE assignment.class_session_id = p_session_id AND assignment.effective_from < v_today
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_today)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_teachers) AS requested(value)
      WHERE (value->>'teacher_id')::uuid = assignment.teacher_id AND (value->>'effective_from')::date = assignment.effective_from
    );
  DELETE FROM public.class_session_teachers assignment
  WHERE assignment.class_session_id = p_session_id AND assignment.effective_from >= v_today
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_teachers) AS requested(value)
      WHERE (value->>'teacher_id')::uuid = assignment.teacher_id AND (value->>'effective_from')::date = assignment.effective_from
    );
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_teachers) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.roles role WHERE role.id = (v_item->>'role_id')::uuid AND role.domain = 'teaching') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TEACHING_ROLE_REQUIRED';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.class_session_teachers existing
      WHERE existing.class_session_id = p_session_id AND existing.teacher_id = (v_item->>'teacher_id')::uuid
        AND existing.effective_from = (v_item->>'effective_from')::date AND existing.role_id = (v_item->>'role_id')::uuid
        AND existing.effective_to IS NOT DISTINCT FROM NULLIF(v_item->>'effective_to', '')::date
    ) THEN
      INSERT INTO public.class_session_teachers AS assignment(class_session_id, teacher_id, role_id, effective_from, effective_to)
      VALUES (p_session_id, (v_item->>'teacher_id')::uuid, (v_item->>'role_id')::uuid,
              (v_item->>'effective_from')::date, NULLIF(v_item->>'effective_to', '')::date)
      ON CONFLICT (class_session_id, teacher_id, effective_from) DO UPDATE
      SET role_id = EXCLUDED.role_id, effective_to = EXCLUDED.effective_to;
    END IF;
  END LOOP;
  RETURN QUERY SELECT assignment.* FROM public.class_session_teachers assignment
  WHERE assignment.class_session_id = p_session_id;
END;
$$;
NOTIFY pgrst, 'reload schema';
