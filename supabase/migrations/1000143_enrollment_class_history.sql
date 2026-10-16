-- Date-effective class membership for enrollments.
--
-- enrollments.class_session_id stays the *current* class. The new
-- enrollment_class_history table records which class the enrollment belonged
-- to over time, so a class transfer with an effective date keeps the student
-- on the old class's roster before that date and on the new class from it.
--
-- * A trigger keeps the history in step with enrollment inserts, start-date
--   edits and direct class_session_id updates (which switch from today).
-- * Backfill: one segment per enrollment for its current class. A previous
--   class is inferred only when the enrollment holds at least two reports
--   there (not single-lesson transfer targets) that all predate its first
--   report in the current class; lone make-up reports stay report-backed.
-- * The occurrence roster, the class session workspace and the single-lesson
--   transfer source check read the history. The transfer source check also
--   accepts an occurrence that holds the student's report.
-- * transfer_enrollment_class moves an enrollment to another class from an
--   effective date (inclusive): blank placeholder reports on/after the date
--   move to the new class's lessons in date order; reports with content stay
--   in the old class and are returned as retained_reports.

BEGIN;

CREATE TABLE IF NOT EXISTS public.enrollment_class_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
    class_session_id uuid NOT NULL REFERENCES public.class_sessions(id) ON DELETE CASCADE,
    classroom_id uuid,
    effective_from date NOT NULL,
    effective_to date,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid DEFAULT auth.uid(),
    CONSTRAINT enrollment_class_history_range_check
        CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS enrollment_class_history_open_unique
    ON public.enrollment_class_history (enrollment_id)
    WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS enrollment_class_history_enrollment_idx
    ON public.enrollment_class_history (enrollment_id, effective_from);
CREATE INDEX IF NOT EXISTS enrollment_class_history_session_idx
    ON public.enrollment_class_history (class_session_id, effective_from);

ALTER TABLE public.enrollment_class_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrollment_class_history FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enrollment_class_history TO service_role;

-- Backfill (rerunnable: only enrollments without history).
DO $$
DECLARE
    v_enrollment record;
    v_previous record;
    v_current_from date;
    v_previous_from date;
    v_segments jsonb;
    v_index integer;
    v_count integer;
BEGIN
    FOR v_enrollment IN
        SELECT enrollment.id, enrollment.class_session_id, enrollment.classroom_id,
               COALESCE(enrollment.start_date, enrollment.created_at::date) AS start_date
        FROM public.enrollments AS enrollment
        WHERE enrollment.class_session_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.enrollment_class_history AS history
              WHERE history.enrollment_id = enrollment.id
          )
    LOOP
        WITH report_sessions AS (
            SELECT occurrence.class_session_id,
                   min(occurrence.occurrence_date) AS first_date,
                   max(occurrence.occurrence_date) AS last_date,
                   count(*) AS report_count
            FROM public.occurrence_reports AS report
            JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
            WHERE report.enrollment_id = v_enrollment.id
              AND NOT EXISTS (
                  SELECT 1 FROM public.single_lesson_transfers AS transfer
                  WHERE transfer.enrollment_id = v_enrollment.id
                    AND transfer.target_occurrence_id = occurrence.id
              )
            GROUP BY occurrence.class_session_id
        ), current_session AS (
            SELECT first_date FROM report_sessions
            WHERE class_session_id = v_enrollment.class_session_id
        )
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'class_session_id', previous.class_session_id,
                   'classroom_id', session.classroom_id,
                   'first_date', previous.first_date,
                   'last_date', previous.last_date
               ) ORDER BY previous.first_date), '[]'::jsonb)
        INTO v_segments
        FROM report_sessions AS previous
        JOIN public.class_sessions AS session ON session.id = previous.class_session_id
        WHERE previous.class_session_id <> v_enrollment.class_session_id
          AND previous.report_count >= 2
          AND previous.last_date < COALESCE((SELECT first_date FROM current_session), 'infinity'::date);

        v_count := jsonb_array_length(v_segments);
        IF v_count = 0 THEN
            INSERT INTO public.enrollment_class_history (enrollment_id, class_session_id, classroom_id, effective_from, created_by)
            VALUES (v_enrollment.id, v_enrollment.class_session_id, v_enrollment.classroom_id, v_enrollment.start_date, NULL);
            CONTINUE;
        END IF;

        -- The current class starts the day after the last previous-class report.
        v_current_from := (v_segments->(v_count - 1)->>'last_date')::date + 1;
        FOR v_index IN 0..v_count - 1 LOOP
            v_previous_from := CASE WHEN v_index = 0
                THEN LEAST(v_enrollment.start_date, (v_segments->0->>'first_date')::date)
                ELSE (v_segments->v_index->>'first_date')::date END;
            INSERT INTO public.enrollment_class_history (enrollment_id, class_session_id, classroom_id, effective_from, effective_to, created_by)
            SELECT v_enrollment.id,
                   (v_segments->v_index->>'class_session_id')::uuid,
                   NULLIF(v_segments->v_index->>'classroom_id', '')::uuid,
                   v_previous_from,
                   CASE WHEN v_index = v_count - 1 THEN v_current_from - 1
                        ELSE (v_segments->(v_index + 1)->>'first_date')::date - 1 END,
                   NULL
            WHERE v_previous_from <= CASE WHEN v_index = v_count - 1 THEN v_current_from - 1
                        ELSE (v_segments->(v_index + 1)->>'first_date')::date - 1 END;
        END LOOP;
        INSERT INTO public.enrollment_class_history (enrollment_id, class_session_id, classroom_id, effective_from, created_by)
        VALUES (v_enrollment.id, v_enrollment.class_session_id, v_enrollment.classroom_id, v_current_from, NULL);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_enrollment_class_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_from date;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.class_session_id IS NOT NULL THEN
            INSERT INTO public.enrollment_class_history (enrollment_id, class_session_id, classroom_id, effective_from)
            VALUES (NEW.id, NEW.class_session_id, NEW.classroom_id, COALESCE(NEW.start_date, CURRENT_DATE));
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.class_session_id IS DISTINCT FROM OLD.class_session_id THEN
        -- transfer_enrollment_class writes the history itself before updating
        -- the enrollment; any other class change switches from today.
        IF NEW.class_session_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.enrollment_class_history AS history
            WHERE history.enrollment_id = NEW.id
              AND history.class_session_id = NEW.class_session_id
              AND history.effective_to IS NULL
        ) THEN
            v_from := GREATEST(COALESCE(NEW.start_date, CURRENT_DATE), CURRENT_DATE);
            UPDATE public.enrollment_class_history
            SET effective_to = v_from - 1
            WHERE enrollment_id = NEW.id AND effective_to IS NULL AND effective_from <= v_from - 1;
            DELETE FROM public.enrollment_class_history
            WHERE enrollment_id = NEW.id AND effective_to IS NULL;
            IF NEW.class_session_id IS NOT NULL THEN
                INSERT INTO public.enrollment_class_history (enrollment_id, class_session_id, classroom_id, effective_from)
                VALUES (NEW.id, NEW.class_session_id, NEW.classroom_id, v_from);
            END IF;
        END IF;
    END IF;

    IF NEW.start_date IS DISTINCT FROM OLD.start_date AND NEW.start_date IS NOT NULL THEN
        UPDATE public.enrollment_class_history AS history
        SET effective_from = NEW.start_date
        WHERE history.id = (
            SELECT first_segment.id FROM public.enrollment_class_history AS first_segment
            WHERE first_segment.enrollment_id = NEW.id
            ORDER BY first_segment.effective_from
            LIMIT 1
        )
          AND (history.effective_to IS NULL OR history.effective_to >= NEW.start_date);
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_enrollment_class_history() FROM PUBLIC;

DROP TRIGGER IF EXISTS enrollment_class_history_sync ON public.enrollments;
CREATE TRIGGER enrollment_class_history_sync
    AFTER INSERT OR UPDATE OF class_session_id, start_date ON public.enrollments
    FOR EACH ROW EXECUTE FUNCTION private.sync_enrollment_class_history();

CREATE OR REPLACE FUNCTION public.get_effective_occurrence_enrollment_ids(
  p_occurrence_id uuid
) RETURNS TABLE (enrollment_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  RETURN QUERY
  WITH occurrence_context AS MATERIALIZED (
    SELECT occurrence.class_session_id, occurrence.occurrence_date
    FROM public.class_occurrences AS occurrence
    WHERE occurrence.id = p_occurrence_id
  ), same_session_enrollments AS MATERIALIZED (
    SELECT enrollment.*
    FROM public.enrollment_class_history AS history
    JOIN occurrence_context AS occurrence
      ON occurrence.class_session_id = history.class_session_id
     AND history.effective_from <= occurrence.occurrence_date
     AND (history.effective_to IS NULL OR history.effective_to >= occurrence.occurrence_date)
    JOIN public.enrollments AS enrollment ON enrollment.id = history.enrollment_id
    WHERE enrollment.status IN ('regular', 'completed')
      AND enrollment.start_date <= occurrence.occurrence_date
  ), transferred_out AS MATERIALIZED (
    SELECT transfer.enrollment_id
    FROM public.single_lesson_transfers AS transfer
    WHERE transfer.source_occurrence_id = p_occurrence_id
      AND transfer.cancelled_at IS NULL
  ), transferred_in AS MATERIALIZED (
    SELECT enrollment.*
    FROM public.single_lesson_transfers AS transfer
    JOIN public.enrollments AS enrollment ON enrollment.id = transfer.enrollment_id
    JOIN occurrence_context AS occurrence ON true
    WHERE transfer.target_occurrence_id = p_occurrence_id
      AND transfer.cancelled_at IS NULL
      AND enrollment.status = 'regular'
      AND enrollment.start_date <= occurrence.occurrence_date
      AND NOT EXISTS (
        SELECT 1
        FROM public.single_lesson_transfers AS onward
        WHERE onward.enrollment_id = transfer.enrollment_id
          AND onward.source_occurrence_id = p_occurrence_id
          AND onward.cancelled_at IS NULL
      )
  ), report_backed_enrollments AS MATERIALIZED (
    SELECT DISTINCT enrollment.*
    FROM public.occurrence_reports AS report
    JOIN public.enrollments AS enrollment ON enrollment.id = report.enrollment_id
    WHERE report.class_occurrence_id = p_occurrence_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.single_lesson_transfers AS transfer
        WHERE transfer.enrollment_id = enrollment.id
          AND transfer.source_occurrence_id = p_occurrence_id
          AND transfer.cancelled_at IS NULL
      )
  ), roster_candidates AS MATERIALIZED (
    SELECT enrollment.*
    FROM same_session_enrollments AS enrollment
    WHERE enrollment.status = 'completed'
       OR NOT EXISTS (
         SELECT 1 FROM transferred_out AS outgoing
         WHERE outgoing.enrollment_id = enrollment.id
       )
    UNION
    SELECT enrollment.* FROM transferred_in AS enrollment
    UNION
    SELECT enrollment.* FROM report_backed_enrollments AS enrollment
  ), completion_dates AS MATERIALIZED (
    SELECT enrollment.id AS enrollment_id,
           max(occurrence.occurrence_date) AS completed_on
    FROM roster_candidates AS enrollment
    JOIN public.occurrence_reports AS report
      ON report.enrollment_id = enrollment.id
     AND report.attendance_status = 'present'
     AND report.is_completed IS TRUE
     AND report.lesson_id IS NOT NULL
    JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.lessons AS current_lesson
      ON current_lesson.id = report.lesson_id
     AND current_lesson.course_id = enrollment.course_id
    WHERE enrollment.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM public.lessons AS later_lesson
        WHERE later_lesson.course_id = enrollment.course_id
          AND later_lesson.sequence > current_lesson.sequence
      )
    GROUP BY enrollment.id
  )
  SELECT candidate.id
  FROM roster_candidates AS candidate
  JOIN occurrence_context AS occurrence ON true
  LEFT JOIN completion_dates AS completion ON completion.enrollment_id = candidate.id
  WHERE NOT EXISTS (
          SELECT 1 FROM transferred_out AS outgoing
          WHERE outgoing.enrollment_id = candidate.id
        )
    AND (EXISTS (
          SELECT 1 FROM report_backed_enrollments AS reported
          WHERE reported.id = candidate.id
        )
     OR candidate.status = 'regular'
     OR (candidate.status = 'completed'
         AND completion.completed_on IS NOT NULL
         AND occurrence.occurrence_date <= completion.completed_on));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_class_session_workspace(
  p_session_id uuid,
  p_occurrence_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_occurrence_date date := COALESCE(p_occurrence_date, CURRENT_DATE);
  v_occurrence_id uuid;
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

  SELECT occurrence.id INTO v_occurrence_id
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.class_session_id = p_session_id
    AND occurrence.occurrence_date = v_occurrence_date;

  WITH effective_ids AS MATERIALIZED (
    SELECT effective.enrollment_id
    FROM public.get_effective_occurrence_enrollment_ids(v_occurrence_id) AS effective
  ), session_enrollments AS MATERIALIZED (
    SELECT enrollment.*
    FROM public.enrollment_class_history AS history
    JOIN public.enrollments AS enrollment ON enrollment.id = history.enrollment_id
    WHERE history.class_session_id = p_session_id
      AND history.effective_from <= v_occurrence_date
      AND (history.effective_to IS NULL OR history.effective_to >= v_occurrence_date)
      AND enrollment.start_date <= v_occurrence_date
      AND enrollment.status IN ('regular', 'completed')
    UNION
    SELECT enrollment.*
    FROM effective_ids AS effective
    JOIN public.enrollments AS enrollment ON enrollment.id = effective.enrollment_id
  ), completion_dates AS MATERIALIZED (
    SELECT enrollment.id AS enrollment_id,
           max(occurrence.occurrence_date) AS completed_on
    FROM session_enrollments AS enrollment
    JOIN public.occurrence_reports AS report
      ON report.enrollment_id = enrollment.id
     AND report.attendance_status = 'present'
     AND report.is_completed IS TRUE
     AND report.lesson_id IS NOT NULL
    JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.lessons AS current_lesson
      ON current_lesson.id = report.lesson_id
     AND current_lesson.course_id = enrollment.course_id
    WHERE enrollment.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM public.lessons AS later_lesson
        WHERE later_lesson.course_id = enrollment.course_id
          AND later_lesson.sequence > current_lesson.sequence
      )
    GROUP BY enrollment.id
  ), eligible_enrollments AS MATERIALIZED (
    SELECT enrollment.*
    FROM session_enrollments AS enrollment
    LEFT JOIN completion_dates AS completion ON completion.enrollment_id = enrollment.id
    WHERE NOT EXISTS (
            SELECT 1 FROM public.single_lesson_transfers AS transfer
            WHERE transfer.enrollment_id = enrollment.id
              AND transfer.source_occurrence_id = v_occurrence_id
              AND transfer.cancelled_at IS NULL
          )
      AND (EXISTS (
            SELECT 1 FROM effective_ids AS effective
            WHERE effective.enrollment_id = enrollment.id
          )
       OR (enrollment.status = 'regular' AND v_occurrence_id IS NULL)
       OR (enrollment.status = 'completed'
           AND completion.completed_on IS NOT NULL
           AND v_occurrence_date <= completion.completed_on))
  )
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
        'roster_date', v_occurrence_date,
        'classrooms', (
          SELECT CASE WHEN classroom.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', classroom.id, 'name', classroom.name, 'color', classroom.color,
            'external_link', classroom.external_link
          ) END
          FROM public.classrooms AS classroom WHERE classroom.id = session.classroom_id
        ),
        'schedule_rules', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', rule.id, 'schedule_kind', rule.schedule_kind, 'day_of_week', rule.day_of_week,
            'day_of_month', rule.day_of_month, 'occurrence_date', rule.occurrence_date,
            'start_time', rule.start_time, 'end_time', rule.end_time
          ) ORDER BY rule.occurrence_date NULLS LAST, rule.day_of_week NULLS LAST, rule.start_time, rule.id)
          FROM public.class_session_schedule_rules AS rule WHERE rule.class_session_id = session.id
        ), '[]'::jsonb)
      )
      FROM public.class_sessions AS session WHERE session.id = p_session_id
    ),
    'enrollments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', enrollment.id, 'student_id', enrollment.student_id, 'course_id', enrollment.course_id,
        'classroom_id', CASE WHEN enrollment.class_session_id = p_session_id
          THEN enrollment.classroom_id ELSE (SELECT target.classroom_id FROM public.class_sessions AS target WHERE target.id = p_session_id) END,
        'class_session_id', p_session_id,
        'status', enrollment.status, 'start_date', enrollment.start_date,
        'lesson_number', enrollment.lesson_number, 'external_link', enrollment.external_link,
        'time_zone', enrollment.time_zone, 'koding_admission_id', enrollment.koding_admission_id,
        'created_at', enrollment.created_at, 'updated_at', enrollment.updated_at,
        'courses', (SELECT jsonb_build_object('subject', course.subject, 'stage', course.stage, 'display_name', course.display_name)
                    FROM public.courses AS course WHERE course.id = enrollment.course_id),
        'classrooms', (SELECT jsonb_build_object('name', classroom.name)
                       FROM public.classrooms AS classroom
                       WHERE classroom.id = CASE WHEN enrollment.class_session_id = p_session_id
                         THEN enrollment.classroom_id ELSE (SELECT target.classroom_id FROM public.class_sessions AS target WHERE target.id = p_session_id) END),
        'students', (SELECT jsonb_build_object('name', student.name)
                     FROM public.students AS student WHERE student.id = enrollment.student_id)
      ) ORDER BY enrollment.created_at, enrollment.id)
      FROM eligible_enrollments AS enrollment
    ), '[]'::jsonb),
    'teachers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', teacher.id, 'user_id', teacher.user_id, 'name', teacher.name)
                       ORDER BY teacher.name, teacher.id)
      FROM public.class_session_teachers AS assignment
      JOIN public.teachers AS teacher ON teacher.id = assignment.teacher_id
      WHERE assignment.class_session_id = p_session_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_repeatable_single_lesson_transfer(
    p_enrollment_id uuid,
    p_source_occurrence_id uuid,
    p_target_occurrence_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enrollment_owner uuid;
    v_enrollment_session_id uuid;
    v_enrollment_course_id uuid;
    v_source_session_id uuid;
    v_source_date date;
    v_target_session_id uuid;
    v_target_date date;
    v_can_manage_source boolean;
    v_can_manage_target boolean;
    v_target_is_ancestor boolean;
    v_transfer_id uuid;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;
    IF p_source_occurrence_id = p_target_occurrence_id THEN
        RAISE EXCEPTION 'SOURCE_AND_TARGET_OCCURRENCES_MATCH';
    END IF;

    SELECT user_id, class_session_id, course_id
    INTO v_enrollment_owner, v_enrollment_session_id, v_enrollment_course_id
    FROM public.enrollments WHERE id = p_enrollment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;

    SELECT class_session_id, occurrence_date INTO v_source_session_id, v_source_date
    FROM public.class_occurrences WHERE id = p_source_occurrence_id;
    SELECT class_session_id, occurrence_date INTO v_target_session_id, v_target_date
    FROM public.class_occurrences WHERE id = p_target_occurrence_id;
    IF v_source_session_id IS NULL OR v_target_session_id IS NULL THEN
        RAISE EXCEPTION 'TRANSFER_OCCURRENCE_NOT_FOUND';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.class_sessions AS session
        WHERE session.id = v_target_session_id
          AND v_enrollment_course_id = ANY(COALESCE(session.course_ids, '{}'::uuid[]))
    ) THEN RAISE EXCEPTION 'TARGET_SESSION_COURSE_MISMATCH'; END IF;

    -- A manually recreated source report is authoritative.  It means an older
    -- active transfer chain no longer reflects where the report is actually
    -- held, so close that stale suffix before evaluating the new transfer.
    IF EXISTS (
        SELECT 1 FROM public.occurrence_reports AS report
        WHERE report.enrollment_id = p_enrollment_id
          AND report.class_occurrence_id = p_source_occurrence_id
    ) THEN
        WITH RECURSIVE stale_path AS (
            SELECT id, source_occurrence_id, target_occurrence_id
            FROM public.single_lesson_transfers
            WHERE enrollment_id = p_enrollment_id AND source_occurrence_id = p_source_occurrence_id
              AND cancelled_at IS NULL
            UNION ALL
            SELECT transfer.id, transfer.source_occurrence_id, transfer.target_occurrence_id
            FROM public.single_lesson_transfers AS transfer
            JOIN stale_path ON transfer.source_occurrence_id = stale_path.target_occurrence_id
            WHERE transfer.enrollment_id = p_enrollment_id AND transfer.cancelled_at IS NULL
        )
        UPDATE public.single_lesson_transfers
        SET cancelled_at = now()
        WHERE id IN (SELECT id FROM stale_path);
    END IF;

    -- The source must be the leaf of the student's effective transfer path, an
    -- occurrence of the class the student belonged to on that date, or an
    -- occurrence that holds the student's report.
    IF EXISTS (
        SELECT 1 FROM public.single_lesson_transfers
        WHERE enrollment_id = p_enrollment_id AND source_occurrence_id = p_source_occurrence_id
          AND cancelled_at IS NULL
    ) OR NOT (
        EXISTS (
            SELECT 1 FROM public.single_lesson_transfers
            WHERE enrollment_id = p_enrollment_id AND target_occurrence_id = p_source_occurrence_id
              AND cancelled_at IS NULL
        ) OR EXISTS (
            -- The class the student belonged to on that date (class history),
            -- not only their current class.
            SELECT 1 FROM public.enrollment_class_history AS history
            WHERE history.enrollment_id = p_enrollment_id
              AND history.class_session_id = v_source_session_id
              AND history.effective_from <= v_source_date
              AND (history.effective_to IS NULL OR history.effective_to >= v_source_date)
        ) OR EXISTS (
            -- A report held on the occurrence puts the student on its roster.
            SELECT 1 FROM public.occurrence_reports AS report
            WHERE report.enrollment_id = p_enrollment_id
              AND report.class_occurrence_id = p_source_occurrence_id
        )
    ) THEN
        RAISE EXCEPTION 'SOURCE_OCCURRENCE_NOT_EFFECTIVE';
    END IF;

    IF COALESCE(auth.role(), '') <> 'service_role' AND v_enrollment_owner <> auth.uid() THEN
        SELECT EXISTS (
            SELECT 1 FROM public.class_session_teachers AS assignment
            JOIN public.teachers AS teacher ON teacher.id = assignment.teacher_id
            WHERE teacher.user_id = auth.uid() AND assignment.class_session_id = v_source_session_id
              AND assignment.effective_from <= v_source_date
              AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_source_date)
        ) INTO v_can_manage_source;
        SELECT EXISTS (
            SELECT 1 FROM public.class_session_teachers AS assignment
            JOIN public.teachers AS teacher ON teacher.id = assignment.teacher_id
            WHERE teacher.user_id = auth.uid() AND assignment.class_session_id = v_target_session_id
              AND assignment.effective_from <= v_target_date
              AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_target_date)
        ) INTO v_can_manage_target;
        IF NOT v_can_manage_source OR NOT v_can_manage_target THEN
            RAISE EXCEPTION 'SINGLE_LESSON_TRANSFER_FORBIDDEN';
        END IF;
    END IF;

    WITH RECURSIVE path AS (
        SELECT id, source_occurrence_id, target_occurrence_id
        FROM public.single_lesson_transfers
        WHERE enrollment_id = p_enrollment_id AND source_occurrence_id = p_target_occurrence_id
          AND cancelled_at IS NULL
        UNION ALL
        SELECT transfer.id, transfer.source_occurrence_id, transfer.target_occurrence_id
        FROM public.single_lesson_transfers AS transfer
        JOIN path ON transfer.source_occurrence_id = path.target_occurrence_id
        WHERE transfer.enrollment_id = p_enrollment_id AND transfer.cancelled_at IS NULL
    )
    SELECT EXISTS (SELECT 1 FROM path WHERE target_occurrence_id = p_source_occurrence_id)
    INTO v_target_is_ancestor;

    IF EXISTS (
        SELECT 1 FROM public.single_lesson_transfers
        WHERE enrollment_id = p_enrollment_id AND target_occurrence_id = p_target_occurrence_id
          AND cancelled_at IS NULL
    ) AND NOT v_target_is_ancestor THEN
        RAISE EXCEPTION 'TARGET_OCCURRENCE_ALREADY_EFFECTIVE';
    END IF;

    IF v_target_is_ancestor THEN
        WITH RECURSIVE path AS (
            SELECT id, source_occurrence_id, target_occurrence_id
            FROM public.single_lesson_transfers
            WHERE enrollment_id = p_enrollment_id AND source_occurrence_id = p_target_occurrence_id
              AND cancelled_at IS NULL
            UNION ALL
            SELECT transfer.id, transfer.source_occurrence_id, transfer.target_occurrence_id
            FROM public.single_lesson_transfers AS transfer
            JOIN path ON transfer.source_occurrence_id = path.target_occurrence_id
            WHERE transfer.enrollment_id = p_enrollment_id AND transfer.cancelled_at IS NULL
        )
        UPDATE public.single_lesson_transfers
        SET cancelled_at = now()
        WHERE id IN (SELECT id FROM path);
        -- Keep the return itself auditable without making the original-class
        -- occurrence an active transfer target.
        INSERT INTO public.single_lesson_transfers (
            enrollment_id, source_occurrence_id, target_occurrence_id, created_by, cancelled_at
        ) VALUES (
            p_enrollment_id, p_source_occurrence_id, p_target_occurrence_id, auth.uid(), now()
        ) RETURNING id INTO v_transfer_id;
        RETURN v_transfer_id;
    END IF;

    INSERT INTO public.single_lesson_transfers (
        enrollment_id, source_occurrence_id, target_occurrence_id, created_by
    ) VALUES (p_enrollment_id, p_source_occurrence_id, p_target_occurrence_id, auth.uid())
    RETURNING id INTO v_transfer_id;
    RETURN v_transfer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_enrollment_class(
    p_enrollment_id uuid,
    p_target_session_id uuid,
    p_effective_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enrollment public.enrollments%ROWTYPE;
    v_target public.class_sessions%ROWTYPE;
    v_effective date;
    v_report record;
    v_target_occurrence_id uuid;
    v_target_occurrences uuid[];
    v_pair_index integer := 0;
    v_moved integer := 0;
    v_removed integer := 0;
    v_retained jsonb := '[]'::jsonb;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;
    IF p_effective_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_TRANSFER_DATE';
    END IF;

    SELECT enrollment.* INTO v_enrollment
    FROM public.enrollments AS enrollment
    WHERE enrollment.id = p_enrollment_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;
    IF v_enrollment.class_session_id IS NULL THEN RAISE EXCEPTION 'ENROLLMENT_HAS_NO_CLASS'; END IF;
    IF v_enrollment.class_session_id = p_target_session_id THEN RAISE EXCEPTION 'TARGET_SESSION_SAME_AS_CURRENT'; END IF;

    SELECT session.* INTO v_target FROM public.class_sessions AS session WHERE session.id = p_target_session_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_OCCURRENCE_NOT_FOUND'; END IF;
    IF NOT (v_enrollment.course_id = ANY(COALESCE(v_target.course_ids, '{}'::uuid[]))) THEN
        RAISE EXCEPTION 'TARGET_SESSION_COURSE_MISMATCH';
    END IF;

    IF COALESCE(auth.role(), '') <> 'service_role' AND NOT (
        public.has_api_permission(auth.uid(), 'teaching.enrollments.update', NULL, v_enrollment.class_session_id)
        AND public.has_api_permission(auth.uid(), 'teaching.enrollments.update', NULL, p_target_session_id)
    ) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    -- A transfer effective on or before the start date moves the whole enrollment.
    v_effective := GREATEST(p_effective_date, COALESCE(v_enrollment.start_date, p_effective_date));

    UPDATE public.enrollment_class_history
    SET effective_to = v_effective - 1
    WHERE enrollment_id = p_enrollment_id AND effective_to IS NULL AND effective_from <= v_effective - 1;
    DELETE FROM public.enrollment_class_history
    WHERE enrollment_id = p_enrollment_id
      AND (effective_to IS NULL OR effective_from >= v_effective);
    INSERT INTO public.enrollment_class_history (enrollment_id, class_session_id, classroom_id, effective_from)
    VALUES (p_enrollment_id, p_target_session_id, v_target.classroom_id, v_effective);

    UPDATE public.enrollments
    SET class_session_id = p_target_session_id,
        classroom_id = v_target.classroom_id
    WHERE id = p_enrollment_id;

    SELECT COALESCE(array_agg(occurrence.id ORDER BY occurrence.occurrence_date, occurrence.original_start_time NULLS LAST), '{}'::uuid[])
    INTO v_target_occurrences
    FROM public.class_occurrences AS occurrence
    WHERE occurrence.class_session_id = p_target_session_id
      AND occurrence.occurrence_date >= v_effective
      AND COALESCE(occurrence.status, 'scheduled') NOT IN ('cancelled', 'rescheduled');

    FOR v_report IN
        SELECT report AS report_row, report.id, report.class_occurrence_id, occurrence.occurrence_date
        FROM public.occurrence_reports AS report
        JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
        WHERE report.enrollment_id = p_enrollment_id
          AND occurrence.class_session_id = v_enrollment.class_session_id
          AND occurrence.occurrence_date >= v_effective
          -- Reports a single-lesson transfer brought here stay where they are.
          AND NOT EXISTS (
              SELECT 1 FROM public.single_lesson_transfers AS transfer
              WHERE transfer.enrollment_id = p_enrollment_id
                AND transfer.target_occurrence_id = occurrence.id
                AND transfer.cancelled_at IS NULL
          )
        ORDER BY occurrence.occurrence_date
        FOR UPDATE OF report
    LOOP
        IF NOT private.is_blank_occurrence_report(v_report.report_row) THEN
            v_retained := v_retained || jsonb_build_object(
                'report_id', v_report.id,
                'occurrence_id', v_report.class_occurrence_id,
                'occurrence_date', v_report.occurrence_date
            );
            CONTINUE;
        END IF;

        v_target_occurrence_id := NULL;
        WHILE v_pair_index < cardinality(v_target_occurrences) LOOP
            v_pair_index := v_pair_index + 1;
            IF NOT EXISTS (
                SELECT 1 FROM public.occurrence_reports AS existing
                WHERE existing.enrollment_id = p_enrollment_id
                  AND existing.class_occurrence_id = v_target_occurrences[v_pair_index]
            ) THEN
                v_target_occurrence_id := v_target_occurrences[v_pair_index];
                EXIT;
            END IF;
        END LOOP;

        IF v_target_occurrence_id IS NULL THEN
            -- No free lesson yet in the new class; provisioning recreates it later.
            DELETE FROM public.report_versions WHERE occurrence_report_id = v_report.id;
            DELETE FROM public.occurrence_reports WHERE id = v_report.id;
            v_removed := v_removed + 1;
        ELSE
            UPDATE public.occurrence_reports
            SET class_occurrence_id = v_target_occurrence_id
            WHERE id = v_report.id;
            v_moved := v_moved + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'enrollment_id', p_enrollment_id,
        'class_session_id', p_target_session_id,
        'classroom_id', v_target.classroom_id,
        'effective_date', v_effective,
        'moved_reports', v_moved,
        'removed_placeholders', v_removed,
        'retained_reports', v_retained
    );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_enrollment_class(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_enrollment_class(uuid, uuid, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
