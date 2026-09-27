BEGIN;

-- Date-scoped hints let a viewer refresh only when the selected occurrence is
-- affected. A pair of NULL bounds deliberately means every date in the session.
CREATE OR REPLACE FUNCTION public.broadcast_class_session_invalidation_for_dates(
  p_class_session_id uuid,
  p_change_kind text,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_class_session_id IS NULL THEN RETURN; END IF;
  PERFORM realtime.send(
    jsonb_strip_nulls(jsonb_build_object(
      'resource', 'class_session',
      'change', p_change_kind,
      'date_from', p_date_from,
      'date_to', p_date_to
    )),
    'class_session_invalidated',
    'class-session:' || p_class_session_id::text,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_class_session_workspace_date_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
  v_session_id uuid;
  v_occurrence_id uuid;
  v_classroom_id uuid;
  v_date_from date;
  v_date_to date;
  v_session_end date;
  v_target record;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  IF TG_TABLE_NAME = 'class_session_teachers' THEN
    IF v_old IS NOT NULL THEN
      PERFORM public.broadcast_class_session_invalidation_for_dates(
        (v_old->>'class_session_id')::uuid, 'teacher_assignment',
        (v_old->>'effective_from')::date, (v_old->>'effective_to')::date
      );
    END IF;
    IF v_new IS NOT NULL THEN
      PERFORM public.broadcast_class_session_invalidation_for_dates(
        (v_new->>'class_session_id')::uuid, 'teacher_assignment',
        (v_new->>'effective_from')::date, (v_new->>'effective_to')::date
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'enrollments' THEN
    IF v_old IS NOT NULL AND (v_old->>'class_session_id') IS NOT NULL THEN
      v_session_id := (v_old->>'class_session_id')::uuid;
      SELECT session.end_date INTO v_session_end FROM public.class_sessions AS session WHERE session.id = v_session_id;
      PERFORM public.broadcast_class_session_invalidation_for_dates(
        v_session_id, 'enrollment', (v_old->>'start_date')::date, v_session_end
      );
    END IF;
    IF v_new IS NOT NULL AND (v_new->>'class_session_id') IS NOT NULL THEN
      v_session_id := (v_new->>'class_session_id')::uuid;
      SELECT session.end_date INTO v_session_end FROM public.class_sessions AS session WHERE session.id = v_session_id;
      PERFORM public.broadcast_class_session_invalidation_for_dates(
        v_session_id, 'enrollment', (v_new->>'start_date')::date, v_session_end
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'class_occurrences' THEN
    IF v_old IS NOT NULL THEN
      PERFORM public.broadcast_class_session_invalidation_for_dates(
        (v_old->>'class_session_id')::uuid, 'occurrence',
        (v_old->>'occurrence_date')::date, (v_old->>'occurrence_date')::date
      );
    END IF;
    IF v_new IS NOT NULL THEN
      PERFORM public.broadcast_class_session_invalidation_for_dates(
        (v_new->>'class_session_id')::uuid, 'occurrence',
        (v_new->>'occurrence_date')::date, (v_new->>'occurrence_date')::date
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'occurrence_reports' THEN
    IF v_old IS NOT NULL THEN
      SELECT occurrence.class_session_id, occurrence.occurrence_date
        INTO v_session_id, v_date_from
      FROM public.class_occurrences AS occurrence
      WHERE occurrence.id = (v_old->>'class_occurrence_id')::uuid;
      PERFORM public.broadcast_class_session_invalidation_for_dates(v_session_id, 'report', v_date_from, v_date_from);
    END IF;
    IF v_new IS NOT NULL THEN
      SELECT occurrence.class_session_id, occurrence.occurrence_date
        INTO v_session_id, v_date_from
      FROM public.class_occurrences AS occurrence
      WHERE occurrence.id = (v_new->>'class_occurrence_id')::uuid;
      PERFORM public.broadcast_class_session_invalidation_for_dates(v_session_id, 'report', v_date_from, v_date_from);
    END IF;
  ELSIF TG_TABLE_NAME = 'single_lesson_transfers' THEN
    FOR v_occurrence_id IN
      SELECT DISTINCT ids.occurrence_id
      FROM (VALUES
        (CASE WHEN v_old IS NOT NULL THEN (v_old->>'source_occurrence_id')::uuid END),
        (CASE WHEN v_old IS NOT NULL THEN (v_old->>'target_occurrence_id')::uuid END),
        (CASE WHEN v_new IS NOT NULL THEN (v_new->>'source_occurrence_id')::uuid END),
        (CASE WHEN v_new IS NOT NULL THEN (v_new->>'target_occurrence_id')::uuid END)
      ) AS ids(occurrence_id)
      WHERE ids.occurrence_id IS NOT NULL
    LOOP
      SELECT occurrence.class_session_id, occurrence.occurrence_date
        INTO v_session_id, v_date_from
      FROM public.class_occurrences AS occurrence WHERE occurrence.id = v_occurrence_id;
      PERFORM public.broadcast_class_session_invalidation_for_dates(v_session_id, 'transfer', v_date_from, v_date_from);
    END LOOP;
  ELSIF TG_TABLE_NAME = 'student_suspensions' THEN
    IF v_old IS NOT NULL THEN
      SELECT enrollment.class_session_id INTO v_session_id
      FROM public.enrollments AS enrollment WHERE enrollment.id = (v_old->>'enrollment_id')::uuid;
      PERFORM public.broadcast_class_session_invalidation_for_dates(
        v_session_id, 'suspension', (v_old->>'start_date')::date, (v_old->>'end_date')::date
      );
    END IF;
    IF v_new IS NOT NULL THEN
      SELECT enrollment.class_session_id INTO v_session_id
      FROM public.enrollments AS enrollment WHERE enrollment.id = (v_new->>'enrollment_id')::uuid;
      PERFORM public.broadcast_class_session_invalidation_for_dates(
        v_session_id, 'suspension', (v_new->>'start_date')::date, (v_new->>'end_date')::date
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'holidays' THEN
    FOR v_target IN
      SELECT DISTINCT targets.class_session_id, targets.date_from, targets.date_to
      FROM (
        SELECT (session_id.value)::uuid AS class_session_id,
               (holiday.value->>'start_date')::date AS date_from,
               (holiday.value->>'end_date')::date AS date_to
        FROM (VALUES (v_old), (v_new)) AS holiday(value)
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(holiday.value->'class_session_ids') = 'array'
            THEN holiday.value->'class_session_ids' ELSE '[]'::jsonb END
        ) AS session_id(value)
        WHERE holiday.value IS NOT NULL
        UNION ALL
        SELECT session.id, (holiday.value->>'start_date')::date, (holiday.value->>'end_date')::date
        FROM (VALUES (v_old), (v_new)) AS holiday(value)
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(holiday.value->'classroom_ids') = 'array'
            THEN holiday.value->'classroom_ids' ELSE '[]'::jsonb END
        ) AS classroom_id(value)
        JOIN public.class_sessions AS session ON session.classroom_id = classroom_id.value::uuid
        WHERE holiday.value IS NOT NULL
        UNION ALL
        SELECT session.id, (holiday.value->>'start_date')::date, (holiday.value->>'end_date')::date
        FROM (VALUES (v_old), (v_new)) AS holiday(value)
        JOIN public.class_sessions AS session ON true
        WHERE holiday.value IS NOT NULL
          AND jsonb_array_length(CASE WHEN jsonb_typeof(holiday.value->'class_session_ids') = 'array'
            THEN holiday.value->'class_session_ids' ELSE '[]'::jsonb END) = 0
          AND jsonb_array_length(CASE WHEN jsonb_typeof(holiday.value->'classroom_ids') = 'array'
            THEN holiday.value->'classroom_ids' ELSE '[]'::jsonb END) = 0
      ) AS targets
    LOOP
      PERFORM public.broadcast_class_session_invalidation_for_dates(
        v_target.class_session_id, 'holiday', v_target.date_from, v_target.date_to
      );
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

-- Replace the session-wide triggers only for records with a reliable date scope.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'class_session_teachers', 'enrollments', 'class_occurrences',
    'occurrence_reports', 'single_lesson_transfers', 'student_suspensions', 'holidays'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS class_session_workspace_invalidation ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER class_session_workspace_invalidation AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.notify_class_session_workspace_date_changed()', table_name);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_class_session_invalidation_for_dates(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_class_session_workspace_date_changed() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
