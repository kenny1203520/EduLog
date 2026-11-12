-- Move a report to the occurrence where the student was actually taught.
-- The report row remains the same resource so its versions, collaboration
-- history, and external source identity stay attached to it.

CREATE OR REPLACE FUNCTION public.correct_occurrence_report(
  p_report_id uuid,
  p_target_class_occurrence_id uuid,
  p_expected_version integer,
  p_target_enrollment_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_current public.occurrence_reports%ROWTYPE;
  v_target_report public.occurrence_reports%ROWTYPE;
  v_target_report_id uuid;
  v_replaced_report_id uuid;
  v_moved public.occurrence_reports%ROWTYPE;
  v_source_occurrence public.class_occurrences%ROWTYPE;
  v_target_occurrence public.class_occurrences%ROWTYPE;
  v_source_session public.class_sessions%ROWTYPE;
  v_target_session public.class_sessions%ROWTYPE;
  v_source_enrollment public.enrollments%ROWTYPE;
  v_target_enrollment public.enrollments%ROWTYPE;
  v_candidate_enrollment_ids uuid[];
  v_lock_report_id uuid;
  v_student_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_report_id IS NULL OR p_target_class_occurrence_id IS NULL
     OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'INVALID_REPORT_CORRECTION' USING ERRCODE = '22023';
  END IF;

  -- The source check also keeps reports outside the caller's teaching scope
  -- from being used as an existence oracle.
  IF NOT EXISTS (
    SELECT 1 FROM public.get_occurrence_report_mutation_context(
      p_report_id, 'teaching.reports.update'
    )
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT report.* INTO v_current
  FROM public.occurrence_reports AS report
  WHERE report.id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;
  IF v_current.class_occurrence_id = p_target_class_occurrence_id THEN
    RAISE EXCEPTION 'REPORT_TARGET_OCCURRENCE_UNCHANGED' USING ERRCODE = '22023';
  END IF;

  -- Keep occurrence/session identity stable for this move. Lock in identifier
  -- order so reciprocal corrections cannot deadlock.
  PERFORM occurrence.id
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id IN (v_current.class_occurrence_id, p_target_class_occurrence_id)
  ORDER BY occurrence.id
  FOR SHARE;

  SELECT occurrence.* INTO v_source_occurrence
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id = v_current.class_occurrence_id;
  SELECT session.* INTO v_source_session
  FROM public.class_sessions AS session
  WHERE session.id = v_source_occurrence.class_session_id;
  SELECT occurrence.* INTO v_target_occurrence
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id = p_target_class_occurrence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_TARGET_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT session.* INTO v_target_session
  FROM public.class_sessions AS session
  WHERE session.id = v_target_occurrence.class_session_id;

  PERFORM session.id
  FROM public.class_sessions AS session
  WHERE session.id IN (v_source_session.id, v_target_session.id)
  ORDER BY session.id
  FOR SHARE;
  SELECT session.* INTO v_source_session
  FROM public.class_sessions AS session
  WHERE session.id = v_source_occurrence.class_session_id;
  SELECT session.* INTO v_target_session
  FROM public.class_sessions AS session
  WHERE session.id = v_target_occurrence.class_session_id;

  IF NOT public.has_teaching_permission(
    auth.uid(), 'teaching.reports.update', v_target_session.teaching_id,
    v_target_session.classroom_id, v_target_session.id
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;
  IF v_source_session.teaching_id IS DISTINCT FROM v_target_session.teaching_id THEN
    RAISE EXCEPTION 'REPORT_TARGET_TEACHING_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT enrollment.* INTO v_source_enrollment
  FROM public.enrollments AS enrollment
  WHERE enrollment.id = v_current.enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_SOURCE_ENROLLMENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  v_student_id := v_source_enrollment.student_id;

  SELECT COALESCE(array_agg(DISTINCT enrollment.id ORDER BY enrollment.id), ARRAY[]::uuid[])
    INTO v_candidate_enrollment_ids
  FROM public.get_effective_occurrence_enrollment_ids(p_target_class_occurrence_id) AS roster
  JOIN public.enrollments AS enrollment ON enrollment.id = roster.enrollment_id
  WHERE enrollment.student_id = v_student_id
    AND enrollment.status <> 'dropped';

  IF cardinality(v_candidate_enrollment_ids) = 0 THEN
    RAISE EXCEPTION 'REPORT_TARGET_NOT_ON_ROSTER' USING ERRCODE = 'P0001';
  END IF;

  IF p_target_enrollment_id IS NOT NULL THEN
    IF NOT (p_target_enrollment_id = ANY(v_candidate_enrollment_ids)) THEN
      RAISE EXCEPTION 'REPORT_TARGET_NOT_ON_ROSTER' USING ERRCODE = 'P0001';
    END IF;
    v_target_enrollment.id := p_target_enrollment_id;
  ELSIF v_current.enrollment_id = ANY(v_candidate_enrollment_ids) THEN
    v_target_enrollment.id := v_current.enrollment_id;
  ELSIF cardinality(v_candidate_enrollment_ids) = 1 THEN
    v_target_enrollment.id := v_candidate_enrollment_ids[1];
  ELSE
    RAISE EXCEPTION 'REPORT_TARGET_ENROLLMENT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Lock source and target enrollment identities in a stable order before
  -- committing the move, preventing opposite-direction corrections from
  -- deadlocking while roster/identity changes are in progress.
  PERFORM enrollment.id
  FROM public.enrollments AS enrollment
  WHERE enrollment.id IN (v_current.enrollment_id, v_target_enrollment.id)
  ORDER BY enrollment.id
  FOR SHARE;
  SELECT enrollment.* INTO v_source_enrollment
  FROM public.enrollments AS enrollment
  WHERE enrollment.id = v_current.enrollment_id;
  SELECT enrollment.* INTO v_target_enrollment
  FROM public.enrollments AS enrollment
  WHERE enrollment.id = v_target_enrollment.id
    AND enrollment.student_id = v_student_id;
  IF NOT FOUND OR v_source_enrollment.student_id IS DISTINCT FROM v_student_id OR NOT EXISTS (
    SELECT 1 FROM public.get_effective_occurrence_enrollment_ids(p_target_class_occurrence_id) AS roster
    WHERE roster.enrollment_id = v_target_enrollment.id
  ) THEN
    RAISE EXCEPTION 'REPORT_TARGET_NOT_ON_ROSTER' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize corrections into the same target slot. Lock both report rows in
  -- a stable order so concurrent A-to-B and B-to-A corrections do not deadlock.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'report-occurrence-correction:' || v_target_enrollment.id::text || ':' || p_target_class_occurrence_id::text,
    0
  ));
  SELECT report.id INTO v_target_report_id
  FROM public.occurrence_reports AS report
  WHERE report.enrollment_id = v_target_enrollment.id
    AND report.class_occurrence_id = p_target_class_occurrence_id
    AND report.id <> p_report_id;

  FOR v_lock_report_id IN
    SELECT DISTINCT candidate.report_id
    FROM unnest(ARRAY[p_report_id, v_target_report_id]) AS candidate(report_id)
    WHERE candidate.report_id IS NOT NULL
    ORDER BY candidate.report_id
  LOOP
    PERFORM report.id
    FROM public.occurrence_reports AS report
    WHERE report.id = v_lock_report_id
    FOR UPDATE;
  END LOOP;

  SELECT report.* INTO v_current
  FROM public.occurrence_reports AS report
  WHERE report.id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;
  IF v_current.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.class_occurrence_id = p_target_class_occurrence_id THEN
    RAISE EXCEPTION 'REPORT_TARGET_OCCURRENCE_UNCHANGED' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_occurrence_report_mutation_context(
      p_report_id, 'teaching.reports.update'
    )
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;

  -- Re-check the target grant and roster after taking the row/slot locks.
  IF NOT public.has_teaching_permission(
    auth.uid(), 'teaching.reports.update', v_target_session.teaching_id,
    v_target_session.classroom_id, v_target_session.id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.get_effective_occurrence_enrollment_ids(p_target_class_occurrence_id) AS roster
    WHERE roster.enrollment_id = v_target_enrollment.id
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT report.* INTO v_target_report
  FROM public.occurrence_reports AS report
  WHERE report.enrollment_id = v_target_enrollment.id
    AND report.class_occurrence_id = p_target_class_occurrence_id
    AND report.id <> p_report_id
  FOR UPDATE;

  IF FOUND THEN
    -- Only a pristine provisioned row is replaceable: v1, never edited,
    -- empty content/documents/comments/ratings/progress, pending attendance,
    -- no link or source binding, and no saved version or collaboration draft.
    IF v_target_report.version IS DISTINCT FROM 1
       OR v_target_report.last_edited_by IS NOT NULL
       OR v_target_report.last_edited_at IS DISTINCT FROM v_target_report.created_at
       OR COALESCE(v_target_report.content, '') <> ''
       OR v_target_report.content_document IS NOT NULL
          AND v_target_report.content_document <> '{}'::jsonb
       OR v_target_report.lesson_id IS NOT NULL
       OR COALESCE(v_target_report.is_completed, false) IS TRUE
       OR v_target_report.progress_letter IS NOT NULL
       OR COALESCE(v_target_report.lesson_entries, '[]'::jsonb) <> '[]'::jsonb
       OR v_target_report.primary_lesson_entry_id IS NOT NULL
       OR v_target_report.attendance_status IS DISTINCT FROM 'pending'
       OR v_target_report.absence_reason IS NOT NULL
       OR v_target_report.class_participation IS NOT NULL
       OR v_target_report.classroom_behavior IS NOT NULL
       OR COALESCE(v_target_report.contact_notes, '') <> ''
       OR (v_target_report.contact_notes_document IS NOT NULL AND v_target_report.contact_notes_document <> '{}'::jsonb)
       OR COALESCE(v_target_report.class_notes, '') <> ''
       OR (v_target_report.class_notes_document IS NOT NULL AND v_target_report.class_notes_document <> '{}'::jsonb)
       OR COALESCE(v_target_report.external_link, '') <> ''
       OR v_target_report.source_origin IS NOT NULL
       OR v_target_report.source_admission_id IS NOT NULL
       OR v_target_report.source_report_id IS NOT NULL
       OR v_target_report.source_synced_at IS NOT NULL
       OR v_target_report.source_synced_version IS NOT NULL
       OR COALESCE(v_target_report.source_synced_fields, '{}'::jsonb) <> '{}'::jsonb
       OR EXISTS (
         SELECT 1 FROM public.report_versions AS version
         WHERE version.occurrence_report_id = v_target_report.id
       )
       OR EXISTS (
         SELECT 1 FROM public.report_collab_docs AS collab
         WHERE collab.occurrence_report_id = v_target_report.id
       ) THEN
      RAISE EXCEPTION 'REPORT_CORRECTION_TARGET_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    v_replaced_report_id := v_target_report.id;
    DELETE FROM public.occurrence_reports WHERE id = v_target_report.id;
  END IF;

  UPDATE public.occurrence_reports AS report
  SET enrollment_id = v_target_enrollment.id,
      class_occurrence_id = p_target_class_occurrence_id,
      version = report.version + 1,
      last_edited_by = auth.uid(),
      last_edited_at = now()
  WHERE report.id = p_report_id
  RETURNING report.* INTO v_moved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.recalculate_enrollment_lesson_number(v_current.enrollment_id);
  IF v_target_enrollment.id IS DISTINCT FROM v_current.enrollment_id THEN
    PERFORM public.recalculate_enrollment_lesson_number(v_target_enrollment.id);
  END IF;

  RETURN jsonb_build_object(
    'report', to_jsonb(v_moved),
    'source_enrollment_id', v_current.enrollment_id,
    'target_enrollment_id', v_target_enrollment.id,
    'source_class_occurrence_id', v_current.class_occurrence_id,
    'target_class_occurrence_id', p_target_class_occurrence_id,
    'source_class_session_id', v_source_session.id,
    'target_class_session_id', v_target_session.id,
    'source_teaching_id', v_source_session.teaching_id,
    'target_teaching_id', v_target_session.teaching_id,
    'replaced_report_id', v_replaced_report_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_occurrence_report(uuid, uuid, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_occurrence_report(uuid, uuid, integer, uuid) TO authenticated;

COMMENT ON FUNCTION public.correct_occurrence_report(uuid, uuid, integer, uuid) IS
  'Atomically move a report to an occurrence where the same student is on the effective roster, retaining the report ID and version history.';
