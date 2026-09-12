-- EduLog legacy-to-canonical upgrade bridge.
--
-- 1000040_backend_security_reconciliation.sql creates the canonical teaching,
-- RBAC and RLS state. This forward migration is intentionally separate so an
-- existing database that was upgraded through the historical chain can run an
-- explicit, repeatable consistency pass after 1000040. It is also harmless on
-- a clean install because every UPDATE is NULL-only and every check is
-- data-dependent.
--
-- Do not apply this file without 1000040. A missing prerequisite must fail
-- loudly rather than silently leaving an old database partially migrated.

DO $$
BEGIN
  IF to_regclass('public.teachings') IS NULL
     OR to_regclass('public.teaching_members') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.class_occurrences') IS NULL
     OR to_regclass('public.occurrence_reports') IS NULL
     OR to_regclass('public.report_templates') IS NULL THEN
    RAISE EXCEPTION
      '1000041 legacy upgrade bridge requires 1000040_backend_security_reconciliation.sql';
  END IF;
END;
$$;

-- Legacy report templates did not carry a teaching scope. Prefer the
-- instructor-owned teaching and send unresolvable rows to the existing
-- admin-only quarantine teaching instead of making them globally visible.
UPDATE public.report_templates template
SET teaching_id = COALESCE(
  (
    SELECT teaching.id
    FROM public.teachings teaching
    WHERE teaching.owner_user_id = template.instructor_id
      AND teaching.is_quarantine = false
    ORDER BY teaching.id
    LIMIT 1
  ),
  (
    SELECT teaching.id
    FROM public.teachings teaching
    WHERE teaching.is_quarantine = true
    ORDER BY teaching.id
    LIMIT 1
  )
)
WHERE template.teaching_id IS NULL;

-- Re-assert owner membership after an upgrade. This is deliberately
-- conflict-safe because an owner may already have a teacher/member assignment
-- created by the canonical migration or by an earlier retry.
INSERT INTO public.teaching_members(teaching_id, user_id, role_id, status)
SELECT teaching.id, teaching.owner_user_id, role.id, 'active'
FROM public.teachings teaching
JOIN public.roles role ON role.code = 'teaching_owner'
WHERE teaching.owner_user_id IS NOT NULL
  AND teaching.is_quarantine = false
ON CONFLICT (teaching_id, user_id) DO UPDATE
SET role_id = COALESCE(public.teaching_members.role_id, EXCLUDED.role_id),
    status = 'active',
    updated_at = timezone('utc'::text, now());

-- The derived resources below do not need a teaching_id column: their scope
-- must resolve through the canonical parent chain. These checks catch legacy
-- rows that would otherwise become invisible or cross-teaching accessible.
DO $$
DECLARE
  unresolved_count bigint;
BEGIN
  SELECT count(*) INTO unresolved_count
  FROM public.report_templates
  WHERE teaching_id IS NULL;
  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      '1000041 report template teaching backfill incomplete: % rows remain unscoped',
      unresolved_count;
  END IF;

  SELECT count(*) INTO unresolved_count
  FROM public.lessons lesson
  LEFT JOIN public.courses course ON course.id = lesson.course_id
  WHERE course.id IS NULL OR course.teaching_id IS NULL;
  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      '1000041 lesson teaching resolution incomplete: % rows remain unscoped',
      unresolved_count;
  END IF;

  SELECT count(*) INTO unresolved_count
  FROM public.classroom_schedules schedule
  LEFT JOIN public.classrooms classroom ON classroom.id = schedule.classroom_id
  WHERE classroom.id IS NULL OR classroom.teaching_id IS NULL;
  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      '1000041 classroom schedule teaching resolution incomplete: % rows remain unscoped',
      unresolved_count;
  END IF;

  SELECT count(*) INTO unresolved_count
  FROM public.class_session_teachers assignment
  LEFT JOIN public.class_sessions session ON session.id = assignment.class_session_id
  WHERE session.id IS NULL OR session.teaching_id IS NULL;
  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      '1000041 class session teacher teaching resolution incomplete: % rows remain unscoped',
      unresolved_count;
  END IF;

  SELECT count(*) INTO unresolved_count
  FROM public.enrollments enrollment
  LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
  LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
  LEFT JOIN public.courses course ON course.id = enrollment.course_id
  WHERE COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id) IS NULL;
  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      '1000041 enrollment teaching resolution incomplete: % rows remain unscoped',
      unresolved_count;
  END IF;

  SELECT count(*) INTO unresolved_count
  FROM public.class_occurrences occurrence
  LEFT JOIN public.class_sessions session ON session.id = occurrence.class_session_id
  WHERE session.id IS NULL OR session.teaching_id IS NULL;
  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      '1000041 occurrence teaching resolution incomplete: % rows remain unscoped',
      unresolved_count;
  END IF;

  SELECT count(*) INTO unresolved_count
  FROM public.occurrence_reports report
  LEFT JOIN public.class_occurrences occurrence ON occurrence.id = report.class_occurrence_id
  LEFT JOIN public.class_sessions session ON session.id = occurrence.class_session_id
  LEFT JOIN public.enrollments enrollment ON enrollment.id = report.enrollment_id
  LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
  LEFT JOIN public.courses course ON course.id = enrollment.course_id
  LEFT JOIN public.class_sessions enrollment_session ON enrollment_session.id = enrollment.class_session_id
  WHERE session.id IS NULL
     OR session.teaching_id IS NULL
     OR COALESCE(enrollment_session.teaching_id, classroom.teaching_id, course.teaching_id) IS NULL
     OR session.teaching_id IS DISTINCT FROM COALESCE(
       enrollment_session.teaching_id,
       classroom.teaching_id,
       course.teaching_id
     );
  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      '1000041 report teaching consistency failed: % rows are orphaned or cross-teaching',
      unresolved_count;
  END IF;
END;
$$;
