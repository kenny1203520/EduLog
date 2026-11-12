-- Multi-lesson reports keep shared attendance/comment fields on one report and
-- version the per-enrollment lesson progress alongside that report.

ALTER TABLE public.occurrence_reports
  ADD COLUMN IF NOT EXISTS lesson_entries jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS primary_lesson_entry_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.occurrence_reports'::regclass
      AND conname = 'occurrence_reports_lesson_entries_array_check'
  ) THEN
    ALTER TABLE public.occurrence_reports
      ADD CONSTRAINT occurrence_reports_lesson_entries_array_check
        CHECK (jsonb_typeof(lesson_entries) = 'array') NOT VALID;
  END IF;
END;
$$;

-- Existing one-lesson reports become one-entry reports without changing their
-- report id, version, or legacy scalar projection.
ALTER TABLE public.occurrence_reports
  DISABLE TRIGGER update_occurrence_reports_updated_at;

WITH legacy_entries AS (
  SELECT report.id AS report_id,
         gen_random_uuid() AS entry_id,
         report.enrollment_id,
         enrollment.course_id,
         report.lesson_id,
         COALESCE(report.is_completed, false) AS is_completed,
         report.progress_letter
  FROM public.occurrence_reports AS report
  JOIN public.enrollments AS enrollment ON enrollment.id = report.enrollment_id
  WHERE report.lesson_id IS NOT NULL
    AND COALESCE(report.lesson_entries, '[]'::jsonb) = '[]'::jsonb
)
UPDATE public.occurrence_reports AS report
SET lesson_entries = jsonb_build_array(jsonb_build_object(
      'id', legacy.entry_id,
      'enrollment_id', legacy.enrollment_id,
      'course_id', legacy.course_id,
      'lesson_id', legacy.lesson_id,
      'is_completed', legacy.is_completed,
      'progress_letter', legacy.progress_letter
    )),
    primary_lesson_entry_id = legacy.entry_id
FROM legacy_entries AS legacy
WHERE report.id = legacy.report_id;

ALTER TABLE public.occurrence_reports
  ENABLE TRIGGER update_occurrence_reports_updated_at;

ALTER TABLE public.occurrence_reports
  VALIDATE CONSTRAINT occurrence_reports_lesson_entries_array_check;

-- A report version snapshot is created once per version transition. The
-- lifecycle wrapper writes lesson_entries after the legacy scalar lifecycle
-- has incremented the version, in the same database transaction.
CREATE OR REPLACE FUNCTION public.create_report_version_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
    IF OLD.version IS DISTINCT FROM NEW.version THEN
        BEGIN
            INSERT INTO public.report_versions (
                occurrence_report_id, version, content, edited_by, snapshot
            ) VALUES (
                OLD.id, OLD.version, COALESCE(OLD.content, ''), OLD.last_edited_by, to_jsonb(OLD.*)
            );
        EXCEPTION WHEN unique_violation THEN
            NULL;
        END;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_enrollment_lesson_number(p_enrollment_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  UPDATE public.enrollments AS enrollment
  SET lesson_number = COALESCE((
    SELECT min(lesson.sequence)
    FROM public.lessons AS lesson
    WHERE lesson.course_id = enrollment.course_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.occurrence_reports AS report
        WHERE (
          report.enrollment_id = enrollment.id
          AND report.lesson_id = lesson.id
          AND report.is_completed IS TRUE
        ) OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(report.lesson_entries, '[]'::jsonb)) AS entry(value)
          WHERE entry.value->>'enrollment_id' = enrollment.id::text
            AND entry.value->>'lesson_id' = lesson.id::text
            AND entry.value->>'is_completed' = 'true'
        )
      )
  ), enrollment.lesson_number, 1)
  WHERE enrollment.id = p_enrollment_id;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_enrollment_lesson_number(uuid) FROM PUBLIC, anon, authenticated;

-- JSON lesson-entry references cannot use a normal foreign key. Protect the
-- enrollment identity they refer to at the database boundary as well as in
-- the API, including concurrent report saves.
CREATE OR REPLACE FUNCTION public.prevent_enrollment_identity_change_with_lesson_entries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id
     AND NEW.course_id IS NOT DISTINCT FROM OLD.course_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.occurrence_reports AS report
    WHERE report.enrollment_id <> OLD.id
      AND report.lesson_entries @> jsonb_build_array(jsonb_build_object('enrollment_id', OLD.id))
  ) THEN
    RAISE EXCEPTION 'ENROLLMENT_HAS_LINKED_REPORT_PROGRESS';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM public.occurrence_reports AS report
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(report.lesson_entries, '[]'::jsonb)) AS entry(value)
      WHERE report.enrollment_id = OLD.id
        AND entry.value->>'enrollment_id' IS DISTINCT FROM OLD.id::text
    ) THEN
      RAISE EXCEPTION 'ENROLLMENT_HAS_LINKED_REPORT_PROGRESS';
    END IF;
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.occurrence_reports AS report
    WHERE report.enrollment_id = OLD.id
      AND jsonb_array_length(COALESCE(report.lesson_entries, '[]'::jsonb)) > 0
  ) THEN
    RAISE EXCEPTION 'ENROLLMENT_HAS_LINKED_REPORT_PROGRESS';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_enrollment_identity_change_with_lesson_entries() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS prevent_enrollment_identity_change_with_lesson_entries ON public.enrollments;
CREATE TRIGGER prevent_enrollment_identity_change_with_lesson_entries
BEFORE UPDATE OF student_id, course_id OR DELETE ON public.enrollments
FOR EACH ROW EXECUTE FUNCTION public.prevent_enrollment_identity_change_with_lesson_entries();

DO $$
BEGIN
  IF to_regprocedure('public.apply_occurrence_report_lifecycle_single_lesson(uuid,integer,jsonb,uuid,text)') IS NULL THEN
    ALTER FUNCTION public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text)
      RENAME TO apply_occurrence_report_lifecycle_single_lesson;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_occurrence_report_lifecycle_single_lesson(uuid,integer,jsonb,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_occurrence_report_lifecycle(
  p_report_id uuid,
  p_expected_version integer,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_actor uuid DEFAULT auth.uid(),
  p_operation text DEFAULT 'update'
) RETURNS public.occurrence_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current public.occurrence_reports%ROWTYPE;
  v_report public.occurrence_reports%ROWTYPE;
  v_patch jsonb := COALESCE(p_patch, '{}'::jsonb);
  v_legacy_patch jsonb;
  v_entries jsonb;
  v_next_entries jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_primary_entry jsonb;
  v_primary_id uuid;
  v_entry_id uuid;
  v_entry_enrollment_id uuid;
  v_entry_course_id uuid;
  v_entry_teaching_id uuid;
  v_entry_lesson_id uuid;
  v_anchor_student_id uuid;
  v_anchor_teaching_id uuid;
  v_enrollment_student_id uuid;
  v_enrollment_course_id uuid;
  v_lesson_course_id uuid;
  v_enrollment_id uuid;
  v_permission text;
  v_entries_changed boolean := false;
  v_has_primary boolean := false;
  v_course_and_lesson record;
BEGIN
  IF jsonb_typeof(v_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_REPORT_PATCH';
  END IF;
  IF p_operation NOT IN ('update', 'delete') THEN
    RAISE EXCEPTION 'INVALID_OPERATION';
  END IF;
  IF p_actor IS NULL OR auth.uid() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  v_permission := CASE WHEN p_operation = 'delete' THEN 'teaching.reports.delete' ELSE 'teaching.reports.update' END;
  IF NOT EXISTS (SELECT 1 FROM public.get_occurrence_report_mutation_context(p_report_id, v_permission)) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT * INTO v_current
  FROM public.occurrence_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_current.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;

  IF p_operation = 'delete' THEN
    IF v_patch <> '{}'::jsonb THEN RAISE EXCEPTION 'INVALID_DELETE_PATCH'; END IF;
    v_report := public.apply_occurrence_report_lifecycle_single_lesson(
      p_report_id, p_expected_version, '{}'::jsonb, p_actor, p_operation
    );
    FOR v_enrollment_id IN
      SELECT DISTINCT (entry.value->>'enrollment_id')::uuid
      FROM jsonb_array_elements(COALESCE(v_current.lesson_entries, '[]'::jsonb)) AS entry(value)
    LOOP
      PERFORM public.recalculate_enrollment_lesson_number(v_enrollment_id);
    END LOOP;
    PERFORM public.recalculate_enrollment_lesson_number(v_current.enrollment_id);
    RETURN v_report;
  END IF;

  IF v_patch ? 'lesson_entries' OR v_patch ? 'primary_lesson_entry_id' THEN
    IF NOT (v_patch ? 'lesson_entries' AND v_patch ? 'primary_lesson_entry_id') THEN
      RAISE EXCEPTION 'INVALID_REPORT_PATCH';
    END IF;
    v_entries := v_patch->'lesson_entries';
    IF jsonb_typeof(v_entries) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INVALID_REPORT_PATCH';
    END IF;
    IF jsonb_array_length(v_entries) > 25 THEN
      RAISE EXCEPTION 'INVALID_REPORT_PATCH';
    END IF;
    IF v_patch->'primary_lesson_entry_id' = 'null'::jsonb THEN
      v_primary_id := NULL;
    ELSIF jsonb_typeof(v_patch->'primary_lesson_entry_id') = 'string'
       AND v_patch->>'primary_lesson_entry_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      v_primary_id := (v_patch->>'primary_lesson_entry_id')::uuid;
    ELSE
      RAISE EXCEPTION 'INVALID_REPORT_PATCH';
    END IF;
    IF jsonb_array_length(v_entries) = 0 AND v_primary_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_REPORT_PATCH';
    ELSIF jsonb_array_length(v_entries) > 0 AND v_primary_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_REPORT_PATCH';
    END IF;
    SELECT enrollment.student_id, session.teaching_id
      INTO v_anchor_student_id, v_anchor_teaching_id
    FROM public.enrollments AS enrollment
    JOIN public.class_occurrences AS occurrence
      ON occurrence.id = v_current.class_occurrence_id
    JOIN public.class_sessions AS session
      ON session.id = occurrence.class_session_id
    WHERE enrollment.id = v_current.enrollment_id;
    IF v_anchor_student_id IS NULL OR v_anchor_teaching_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_REPORT_PATCH';
    END IF;

    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
      IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
         OR (v_entry - ARRAY['id','enrollment_id','course_id','lesson_id','is_completed','progress_letter']) <> '{}'::jsonb
         OR jsonb_typeof(v_entry->'id') IS DISTINCT FROM 'string'
         OR (v_entry->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR jsonb_typeof(v_entry->'enrollment_id') IS DISTINCT FROM 'string'
         OR (v_entry->>'enrollment_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR jsonb_typeof(v_entry->'course_id') IS DISTINCT FROM 'string'
         OR (v_entry->>'course_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR jsonb_typeof(v_entry->'lesson_id') IS DISTINCT FROM 'string'
         OR (v_entry->>'lesson_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR jsonb_typeof(v_entry->'is_completed') IS DISTINCT FROM 'boolean'
         OR NOT (v_entry ? 'progress_letter')
         OR (v_entry->'progress_letter' <> 'null'::jsonb AND (
           jsonb_typeof(v_entry->'progress_letter') IS DISTINCT FROM 'string'
           OR length(v_entry->>'progress_letter') > 32
           OR (v_entry->>'progress_letter') !~ '^[A-Z](-[A-Z])?$'
         )) THEN
        RAISE EXCEPTION 'INVALID_REPORT_LESSON_ENTRY';
      END IF;
      v_entry_id := (v_entry->>'id')::uuid;
      v_entry_enrollment_id := (v_entry->>'enrollment_id')::uuid;
      v_entry_course_id := (v_entry->>'course_id')::uuid;
      v_entry_lesson_id := (v_entry->>'lesson_id')::uuid;
      SELECT enrollment.student_id, enrollment.course_id, course.teaching_id
        INTO v_enrollment_student_id, v_enrollment_course_id, v_entry_teaching_id
      FROM public.enrollments AS enrollment
      JOIN public.courses AS course ON course.id = enrollment.course_id
      WHERE enrollment.id = v_entry_enrollment_id
        AND enrollment.status IS DISTINCT FROM 'dropped'
      -- SHARE conflicts with the NO KEY UPDATE lock taken when an enrollment's
      -- student/course identity changes. The identity trigger will then see
      -- this entry after our transaction commits, or this writer will observe
      -- the new identity and reject it.
      FOR SHARE OF enrollment, course;
      IF v_enrollment_student_id IS DISTINCT FROM v_anchor_student_id
         OR v_enrollment_course_id IS DISTINCT FROM v_entry_course_id
         OR v_entry_teaching_id IS DISTINCT FROM v_anchor_teaching_id THEN
        RAISE EXCEPTION 'REPORT_LESSON_ENROLLMENT_MISMATCH';
      END IF;
      SELECT lesson.course_id INTO v_lesson_course_id
      FROM public.lessons AS lesson
      WHERE lesson.id = v_entry_lesson_id;
      IF v_lesson_course_id IS DISTINCT FROM v_entry_course_id THEN
        RAISE EXCEPTION 'REPORT_LESSON_COURSE_MISMATCH';
      END IF;
      IF (SELECT count(*) FROM jsonb_array_elements(v_entries) AS duplicate(value)
          WHERE duplicate.value->>'id' = v_entry_id::text) > 1
         OR (SELECT count(*) FROM jsonb_array_elements(v_entries) AS duplicate(value)
             WHERE duplicate.value->>'enrollment_id' = v_entry_enrollment_id::text
               AND duplicate.value->>'lesson_id' = v_entry_lesson_id::text) > 1 THEN
        RAISE EXCEPTION 'DUPLICATE_REPORT_LESSON_ENTRY';
      END IF;
      IF v_entry_id = v_primary_id THEN
        v_primary_entry := v_entry;
        v_has_primary := true;
      END IF;
    END LOOP;
    IF jsonb_array_length(v_entries) > 0 AND NOT v_has_primary THEN
      RAISE EXCEPTION 'INVALID_REPORT_PRIMARY_LESSON_ENTRY';
    END IF;
    v_entries_changed := true;
    v_legacy_patch := v_patch - 'lesson_entries' - 'primary_lesson_entry_id' - 'lesson_id' - 'is_completed' - 'progress_letter';
    IF v_primary_entry IS NULL THEN
      IF v_current.lesson_id IS NOT NULL THEN v_legacy_patch := v_legacy_patch || jsonb_build_object('lesson_id', NULL); END IF;
      IF v_current.is_completed IS DISTINCT FROM false THEN v_legacy_patch := v_legacy_patch || jsonb_build_object('is_completed', false); END IF;
      IF v_current.progress_letter IS NOT NULL THEN v_legacy_patch := v_legacy_patch || jsonb_build_object('progress_letter', NULL); END IF;
    ELSE
      IF v_current.lesson_id IS DISTINCT FROM (v_primary_entry->>'lesson_id')::uuid THEN v_legacy_patch := v_legacy_patch || jsonb_build_object('lesson_id', v_primary_entry->'lesson_id'); END IF;
      IF v_current.is_completed IS DISTINCT FROM (v_primary_entry->>'is_completed')::boolean THEN v_legacy_patch := v_legacy_patch || jsonb_build_object('is_completed', v_primary_entry->'is_completed'); END IF;
      IF v_current.progress_letter IS DISTINCT FROM NULLIF(v_primary_entry->>'progress_letter', '') THEN v_legacy_patch := v_legacy_patch || jsonb_build_object('progress_letter', v_primary_entry->'progress_letter'); END IF;
    END IF;
  ELSE
    -- Compatibility for clients that still send the original scalar fields.
    v_entries := COALESCE(v_current.lesson_entries, '[]'::jsonb);
    v_primary_id := v_current.primary_lesson_entry_id;
    IF v_patch ? 'lesson_id' OR v_patch ? 'is_completed' OR v_patch ? 'progress_letter' THEN
      v_next_entries := '[]'::jsonb;
      v_has_primary := false;
      FOR v_entry IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
        IF v_entry->>'id' = v_primary_id::text THEN
          v_has_primary := true;
          v_entry_enrollment_id := (v_entry->>'enrollment_id')::uuid;
        END IF;
      END LOOP;
      IF NOT v_has_primary THEN v_entry_enrollment_id := v_current.enrollment_id; END IF;
      SELECT enrollment.course_id INTO v_entry_course_id
      FROM public.enrollments AS enrollment
      WHERE enrollment.id = v_entry_enrollment_id;
      IF v_patch ? 'lesson_id' THEN
        IF v_patch->'lesson_id' = 'null'::jsonb THEN v_entry_lesson_id := NULL;
        ELSE v_entry_lesson_id := NULLIF(v_patch->>'lesson_id', '')::uuid;
        END IF;
      ELSE
        SELECT (value->>'lesson_id')::uuid INTO v_entry_lesson_id
        FROM jsonb_array_elements(v_entries) AS item(value)
        WHERE value->>'id' = v_primary_id::text;
        IF NOT FOUND THEN v_entry_lesson_id := v_current.lesson_id; END IF;
      END IF;
      IF v_entry_lesson_id IS NULL THEN
        v_primary_id := NULL;
        FOR v_entry IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
          IF v_entry->>'id' <> v_current.primary_lesson_entry_id::text THEN
            v_next_entries := v_next_entries || jsonb_build_array(v_entry);
            IF v_primary_id IS NULL THEN v_primary_id := (v_entry->>'id')::uuid; END IF;
          END IF;
        END LOOP;
        IF v_primary_id IS NOT NULL THEN
          SELECT value INTO v_primary_entry
          FROM jsonb_array_elements(v_next_entries) AS remaining(value)
          WHERE value->>'id' = v_primary_id::text;
        END IF;
      ELSE
        SELECT lesson.course_id INTO v_lesson_course_id
        FROM public.lessons AS lesson
        WHERE lesson.id = v_entry_lesson_id;
        IF v_lesson_course_id IS DISTINCT FROM v_entry_course_id THEN
          RAISE EXCEPTION 'REPORT_LESSON_COURSE_MISMATCH';
        END IF;
        IF v_primary_id IS NULL THEN v_primary_id := gen_random_uuid(); END IF;
        FOR v_entry IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
          IF v_entry->>'id' = v_current.primary_lesson_entry_id::text THEN
            v_entry := v_entry || jsonb_build_object(
              'enrollment_id', v_entry_enrollment_id,
              'course_id', v_entry_course_id,
              'lesson_id', v_entry_lesson_id,
              'is_completed', CASE WHEN v_patch ? 'is_completed' THEN (v_patch->>'is_completed')::boolean ELSE COALESCE((v_entry->>'is_completed')::boolean, v_current.is_completed, false) END,
              'progress_letter', CASE WHEN v_patch ? 'progress_letter' THEN v_patch->'progress_letter' ELSE COALESCE(v_entry->'progress_letter', to_jsonb(v_current.progress_letter)) END
            );
            v_has_primary := true;
          END IF;
          v_next_entries := v_next_entries || jsonb_build_array(v_entry);
        END LOOP;
        IF NOT v_has_primary THEN
          v_next_entries := v_next_entries || jsonb_build_array(jsonb_build_object(
            'id', v_primary_id,
            'enrollment_id', v_entry_enrollment_id,
            'course_id', v_entry_course_id,
            'lesson_id', v_entry_lesson_id,
            'is_completed', CASE WHEN v_patch ? 'is_completed' THEN (v_patch->>'is_completed')::boolean ELSE COALESCE(v_current.is_completed, false) END,
            'progress_letter', CASE WHEN v_patch ? 'progress_letter' THEN v_patch->'progress_letter' ELSE to_jsonb(v_current.progress_letter) END
          ));
        END IF;
      END IF;
      v_entries := v_next_entries;
      v_entries_changed := true;
    END IF;
    v_legacy_patch := v_patch - 'lesson_entries' - 'primary_lesson_entry_id';
    IF v_patch ? 'lesson_id' AND v_patch->'lesson_id' = 'null'::jsonb AND v_primary_entry IS NOT NULL THEN
      -- A scalar client cleared the old primary. Keep the legacy projection
      -- aligned with the next surviving entry for older readers.
      v_legacy_patch := v_legacy_patch || jsonb_build_object(
        'lesson_id', v_primary_entry->'lesson_id',
        'is_completed', v_primary_entry->'is_completed',
        'progress_letter', v_primary_entry->'progress_letter'
      );
    END IF;
  END IF;

  -- Delegate existing field validation and report lifecycle behavior to the
  -- previous guarded implementation. The companion entries are written in
  -- this same RPC transaction and carry the exact same report version.
  v_report := public.apply_occurrence_report_lifecycle_single_lesson(
    p_report_id, p_expected_version, v_legacy_patch, p_actor, p_operation
  );
  IF v_entries_changed THEN
    UPDATE public.occurrence_reports
    SET lesson_entries = v_entries,
        primary_lesson_entry_id = v_primary_id
    WHERE id = p_report_id;
    SELECT * INTO v_report FROM public.occurrence_reports WHERE id = p_report_id;
  END IF;

  FOR v_enrollment_id IN
    SELECT DISTINCT (entry.value->>'enrollment_id')::uuid
    FROM jsonb_array_elements(COALESCE(v_current.lesson_entries, '[]'::jsonb) || COALESCE(v_entries, '[]'::jsonb)) AS entry(value)
  LOOP
    PERFORM public.recalculate_enrollment_lesson_number(v_enrollment_id);
  END LOOP;
  PERFORM public.recalculate_enrollment_lesson_number(v_current.enrollment_id);
  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text) TO authenticated, service_role;
