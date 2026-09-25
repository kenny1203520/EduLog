\set ON_ERROR_STOP on

DO $$
DECLARE classroom_teaching uuid;
DECLARE course_teaching uuid;
DECLARE quarantine_teaching uuid;
DECLARE classroom_session_teaching uuid;
DECLARE course_session_teaching uuid;
DECLARE quarantine_session_teaching uuid;
BEGIN
  SELECT teaching_id INTO classroom_teaching
  FROM public.classrooms
  WHERE id = '30000000-0000-0000-0000-0000000000aa';
  SELECT teaching_id INTO course_teaching
  FROM public.courses
  WHERE id = '50000000-0000-0000-0000-0000000000bb';
  -- After platform promotion there is one teaching-domain root; quarantined
  -- workspace rows are archival history and no longer own runtime records.
  SELECT id INTO quarantine_teaching
  FROM public.teachings
  WHERE is_global = true;
  SELECT teaching_id INTO classroom_session_teaching
  FROM public.class_sessions
  WHERE id = '60000000-0000-0000-0000-0000000000aa';
  SELECT teaching_id INTO course_session_teaching
  FROM public.class_sessions
  WHERE id = '60000000-0000-0000-0000-0000000000ab';
  SELECT teaching_id INTO quarantine_session_teaching
  FROM public.class_sessions
  WHERE id = '60000000-0000-0000-0000-0000000000ac';

  IF classroom_teaching IS NULL OR course_teaching IS NULL OR quarantine_teaching IS NULL THEN
    RAISE EXCEPTION 'platform teaching root backfill failed';
  END IF;
  IF classroom_session_teaching IS DISTINCT FROM classroom_teaching THEN
    RAISE EXCEPTION 'classroom teaching must take precedence over course teaching';
  END IF;
  IF course_session_teaching IS DISTINCT FROM course_teaching THEN
    RAISE EXCEPTION 'course teaching fallback failed';
  END IF;
  IF classroom_teaching IS DISTINCT FROM quarantine_teaching
     OR course_teaching IS DISTINCT FROM quarantine_teaching
     OR classroom_session_teaching IS DISTINCT FROM quarantine_teaching
     OR course_session_teaching IS DISTINCT FROM quarantine_teaching THEN
    RAISE EXCEPTION 'teaching data was not assigned to the platform root';
  END IF;
  IF quarantine_session_teaching IS DISTINCT FROM quarantine_teaching THEN
    RAISE EXCEPTION 'session was not promoted to platform teaching root';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_role_assignments assignment
    JOIN public.roles role ON role.id = assignment.role_id
    WHERE assignment.scope_type = 'system' AND assignment.scope_id IS NULL
      AND assignment.user_id = '00000000-0000-0000-0000-0000000000aa'
      AND assignment.status = 'active' AND role.domain = 'teaching'
      AND role.code = 'teaching_owner'
  ) THEN
    RAISE EXCEPTION 'platform teaching owner assignment backfill failed';
  END IF;
END;
$$;
DO $$
DECLARE teacher_membership_count integer;
BEGIN
  SELECT count(*) INTO teacher_membership_count
  FROM public.user_role_assignments assignment
  JOIN public.roles role ON role.id = assignment.role_id
  WHERE assignment.scope_type = 'system' AND assignment.scope_id IS NULL
    AND assignment.status = 'active' AND role.domain = 'teaching'
    AND role.code = 'teacher'
    AND assignment.user_id = '00000000-0000-0000-0000-0000000000bb';

  IF teacher_membership_count <> 1 THEN
    RAISE EXCEPTION 'platform teacher assignment backfill was not deduplicated: %', teacher_membership_count;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.report_templates template
    JOIN public.teachings teaching ON teaching.id = template.teaching_id
    WHERE template.id = '51000000-0000-0000-0000-0000000000aa'
      AND teaching.is_global = true
  ) THEN
    RAISE EXCEPTION 'report template was not promoted to platform teaching root';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.holidays
    WHERE id = '90000000-0000-0000-0000-0000000000aa'
      AND COALESCE(cardinality(classroom_ids), 0) = 0
      AND COALESCE(cardinality(class_session_ids), 0) = 0
  ) THEN
    RAISE EXCEPTION 'legacy global holiday compatibility row was lost';
  END IF;
END;
$$;
