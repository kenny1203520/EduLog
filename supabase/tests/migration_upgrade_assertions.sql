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
  SELECT id INTO quarantine_teaching
  FROM public.teachings
  WHERE is_quarantine = true;
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
    RAISE EXCEPTION 'owner/course/quarantine teaching backfill failed';
  END IF;
  IF classroom_session_teaching IS DISTINCT FROM classroom_teaching THEN
    RAISE EXCEPTION 'classroom teaching must take precedence over course teaching';
  END IF;
  IF course_session_teaching IS DISTINCT FROM course_teaching THEN
    RAISE EXCEPTION 'course teaching fallback failed';
  END IF;
  IF quarantine_session_teaching IS DISTINCT FROM quarantine_teaching THEN
    RAISE EXCEPTION 'quarantine teaching fallback failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_members
    WHERE teaching_id = classroom_teaching
      AND user_id = '00000000-0000-0000-0000-0000000000aa'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'owner membership backfill failed';
  END IF;
END;
$$;
DO $$
DECLARE teacher_membership_count integer;
BEGIN
  SELECT count(*) INTO teacher_membership_count
  FROM public.teaching_members
  WHERE teaching_id = (
    SELECT teaching_id FROM public.classrooms
    WHERE id = '30000000-0000-0000-0000-0000000000aa'
  )
  AND user_id = '00000000-0000-0000-0000-0000000000bb';

  IF teacher_membership_count <> 1 THEN
    RAISE EXCEPTION 'teacher membership backfill was not deduplicated: %', teacher_membership_count;
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
      AND teaching.owner_user_id = '00000000-0000-0000-0000-0000000000aa'
      AND teaching.is_quarantine = false
  ) THEN
    RAISE EXCEPTION 'legacy report template teaching bridge failed';
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
