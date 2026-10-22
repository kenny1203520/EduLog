-- Class transfers keep an audit trail and keep the report count.
--
-- * private.is_blank_occurrence_report also treats rich-text documents,
--   participation/behaviour scores, absence reasons and links as content. A
--   report the holiday tool only marked absent ('holiday') is still blank.
-- * private.local_today(session, enrollment) is "today" in the class time zone
--   (falling back to the enrollment's); dates stay plain UTC-free dates.
-- * private.is_closed_occurrence: a lesson that is not conducted or falls on a
--   closure holiday never takes a report slot.
-- * enrollment_class_transfers is an append-only log of every class transfer:
--   the classes, effective date, note, the history segments it replaced and
--   what happened to each report (moved / retained / created / deleted).
--   Earlier transfers are backfilled as source = 'migrated' with no details.
-- * transfer_enrollment_class(enrollment, target, effective_date, note):
--   - an effective date before an earlier transfer replaces that history;
--   - on/after the date, reports with content stay where they are and keep
--     their date; blank placeholders from every affected class move in date
--     order to free new-class lessons (one report per date, never onto a
--     closed lesson or a lesson the student transferred away from);
--   - the enrollment keeps the report count it had before the transfer
--     (sync_enrollment_reports fills any shortfall).
-- * sync_enrollment_reports skips closed lessons and dates that already hold
--   one of the enrollment's fixed reports.
-- * get_enrollment_class_timeline / get_class_session_roster_flags: read
--   models for the student timeline, report placement labels and the class
--   calendar badges.

BEGIN;

CREATE OR REPLACE FUNCTION private.is_empty_rich_document(p_document jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_document IS NULL
        OR NOT (
            jsonb_path_exists(p_document, 'lax $.** ? (@.type == "text" && @.text like_regex "[^[:space:]]")')
            OR jsonb_path_exists(p_document, 'lax $.** ? (exists(@.type) && @.type != "doc" && @.type != "paragraph" && @.type != "text" && @.type != "hardBreak")')
        );
$$;

REVOKE ALL ON FUNCTION private.is_empty_rich_document(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.is_blank_occurrence_report(
    p_report public.occurrence_reports
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT NULLIF(btrim(COALESCE(p_report.content, '')), '') IS NULL
       AND NULLIF(btrim(COALESCE(p_report.class_notes, '')), '') IS NULL
       AND NULLIF(btrim(COALESCE(p_report.contact_notes, '')), '') IS NULL
       AND NULLIF(btrim(COALESCE(p_report.progress_letter, '')), '') IS NULL
       AND NULLIF(btrim(COALESCE(p_report.external_link, '')), '') IS NULL
       AND private.is_empty_rich_document(p_report.content_document)
       AND private.is_empty_rich_document(p_report.class_notes_document)
       AND private.is_empty_rich_document(p_report.contact_notes_document)
       AND p_report.class_participation IS NULL
       AND p_report.classroom_behavior IS NULL
       AND p_report.lesson_id IS NULL
       AND p_report.is_completed IS NOT TRUE
       AND (
           (COALESCE(p_report.attendance_status, 'pending') = 'pending'
            AND NULLIF(btrim(COALESCE(p_report.absence_reason, '')), '') IS NULL
            AND COALESCE(p_report.version, 1) <= 1)
           -- Marked absent by the holiday tool only.
           OR (p_report.attendance_status = 'absent' AND p_report.absence_reason = 'holiday')
       );
$$;

REVOKE ALL ON FUNCTION private.is_blank_occurrence_report(public.occurrence_reports) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.local_today(
    p_class_session_id uuid,
    p_enrollment_id uuid DEFAULT NULL
) RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v_zone text;
BEGIN
    SELECT NULLIF(session.time_zone, '') INTO v_zone
    FROM public.class_sessions AS session WHERE session.id = p_class_session_id;
    IF v_zone IS NULL THEN
        SELECT NULLIF(enrollment.time_zone, '') INTO v_zone
        FROM public.enrollments AS enrollment WHERE enrollment.id = p_enrollment_id;
    END IF;
    BEGIN
        RETURN (now() AT TIME ZONE COALESCE(v_zone, 'Asia/Taipei'))::date;
    EXCEPTION WHEN invalid_parameter_value THEN
        RETURN (now() AT TIME ZONE 'Asia/Taipei')::date;
    END;
END;
$$;

REVOKE ALL ON FUNCTION private.local_today(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.is_closed_occurrence(p_occurrence_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.class_occurrences AS occurrence
        LEFT JOIN public.class_sessions AS session ON session.id = occurrence.class_session_id
        WHERE occurrence.id = p_occurrence_id
          AND (occurrence.is_conducted IS FALSE OR EXISTS (
              SELECT 1 FROM public.holidays AS holiday
              WHERE holiday.kind = 'closure'
                AND holiday.start_date <= occurrence.occurrence_date
                AND holiday.end_date >= occurrence.occurrence_date
                AND ((COALESCE(holiday.classroom_ids, '{}'::uuid[]) = '{}'::uuid[]
                      AND COALESCE(holiday.class_session_ids, '{}'::uuid[]) = '{}'::uuid[])
                     OR session.classroom_id = ANY(COALESCE(holiday.classroom_ids, '{}'::uuid[]))
                     OR occurrence.class_session_id = ANY(COALESCE(holiday.class_session_ids, '{}'::uuid[])))
          ))
    );
$$;

REVOKE ALL ON FUNCTION private.is_closed_occurrence(uuid) FROM PUBLIC;

-- "Today" for direct class changes and new enrollments follows the class time zone.
CREATE OR REPLACE FUNCTION private.sync_enrollment_class_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_from date;
    v_today date;
BEGIN
    v_today := private.local_today(NEW.class_session_id, NEW.id);
    IF TG_OP = 'INSERT' THEN
        IF NEW.class_session_id IS NOT NULL THEN
            INSERT INTO public.enrollment_class_history (enrollment_id, class_session_id, classroom_id, effective_from)
            VALUES (NEW.id, NEW.class_session_id, NEW.classroom_id, COALESCE(NEW.start_date, v_today));
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
            v_from := GREATEST(COALESCE(NEW.start_date, v_today), v_today);
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

-- Append-only transfer log.
CREATE TABLE IF NOT EXISTS public.enrollment_class_transfers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
    from_class_session_id uuid REFERENCES public.class_sessions(id) ON DELETE SET NULL,
    to_class_session_id uuid REFERENCES public.class_sessions(id) ON DELETE SET NULL,
    effective_date date NOT NULL,
    note text,
    source text NOT NULL DEFAULT 'transfer',
    replaced_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
    report_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT enrollment_class_transfers_source_check CHECK (source IN ('transfer', 'migrated')),
    CONSTRAINT enrollment_class_transfers_note_check CHECK (note IS NULL OR char_length(note) <= 200),
    CONSTRAINT enrollment_class_transfers_json_check CHECK (
        jsonb_typeof(replaced_segments) = 'array' AND jsonb_typeof(report_changes) = 'array'
    )
);

CREATE INDEX IF NOT EXISTS enrollment_class_transfers_enrollment_idx
    ON public.enrollment_class_transfers (enrollment_id, effective_date, created_at);
CREATE INDEX IF NOT EXISTS enrollment_class_transfers_to_session_idx
    ON public.enrollment_class_transfers (to_class_session_id, effective_date);

ALTER TABLE public.enrollment_class_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrollment_class_transfers FROM anon, authenticated;
GRANT SELECT, INSERT ON public.enrollment_class_transfers TO service_role;

CREATE OR REPLACE FUNCTION private.reject_enrollment_class_transfer_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- Deleting the enrollment cascades; anything else is an audit edit.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.enrollments WHERE id = OLD.enrollment_id) THEN
        RETURN OLD;
    END IF;
    -- A deleted class nulls its reference (ON DELETE SET NULL).
    IF TG_OP = 'UPDATE'
       AND (NEW.from_class_session_id IS NULL OR NEW.from_class_session_id = OLD.from_class_session_id)
       AND (NEW.to_class_session_id IS NULL OR NEW.to_class_session_id = OLD.to_class_session_id)
       AND (to_jsonb(NEW) - 'from_class_session_id' - 'to_class_session_id')
           = (to_jsonb(OLD) - 'from_class_session_id' - 'to_class_session_id') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ENROLLMENT_CLASS_TRANSFER_APPEND_ONLY';
END;
$$;

REVOKE ALL ON FUNCTION private.reject_enrollment_class_transfer_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS enrollment_class_transfers_append_only ON public.enrollment_class_transfers;
CREATE TRIGGER enrollment_class_transfers_append_only
    BEFORE UPDATE OR DELETE ON public.enrollment_class_transfers
    FOR EACH ROW EXECUTE FUNCTION private.reject_enrollment_class_transfer_change();

-- Backfill (rerunnable): one migrated event per later history segment.
INSERT INTO public.enrollment_class_transfers (
    enrollment_id, from_class_session_id, to_class_session_id, effective_date, source, created_by, created_at
)
SELECT segment.enrollment_id, previous.class_session_id, segment.class_session_id,
       segment.effective_from, 'migrated', segment.created_by, segment.created_at
FROM public.enrollment_class_history AS segment
JOIN LATERAL (
    SELECT earlier.class_session_id
    FROM public.enrollment_class_history AS earlier
    WHERE earlier.enrollment_id = segment.enrollment_id
      AND earlier.effective_from < segment.effective_from
    ORDER BY earlier.effective_from DESC
    LIMIT 1
) AS previous ON true
WHERE NOT EXISTS (
    SELECT 1 FROM public.enrollment_class_transfers AS existing
    WHERE existing.enrollment_id = segment.enrollment_id
      AND existing.effective_date = segment.effective_from
      AND existing.to_class_session_id IS NOT DISTINCT FROM segment.class_session_id
);

CREATE OR REPLACE FUNCTION public.sync_enrollment_reports(
    p_enrollment_id uuid,
    p_target_count integer DEFAULT NULL,
    p_start_date date DEFAULT NULL,
    p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enrollment public.enrollments%ROWTYPE;
    v_start date;
    v_first_segment uuid;
    v_target integer;
    v_fixed_count integer;
    v_blank_count integer;
    v_slots integer;
    v_created jsonb := '[]'::jsonb;
    v_removed jsonb := '[]'::jsonb;
    v_fixed_before_start jsonb := '[]'::jsonb;
    v_chosen_count integer;
    v_row record;
    v_attendance record;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;

    SELECT enrollment.* INTO v_enrollment
    FROM public.enrollments AS enrollment
    WHERE enrollment.id = p_enrollment_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;

    IF COALESCE(auth.role(), '') <> 'service_role'
       AND NOT public.can_access_enrollment(p_enrollment_id, 'teaching.enrollments.update')
       AND NOT public.can_access_enrollment(p_enrollment_id, 'teaching.enrollments.create') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    v_start := COALESCE(p_start_date, v_enrollment.start_date, private.local_today(v_enrollment.class_session_id, p_enrollment_id));
    IF p_target_count IS NOT NULL AND (p_target_count < 0 OR p_target_count > 200) THEN
        RAISE EXCEPTION 'INVALID_TARGET_REPORT_COUNT';
    END IF;

    SELECT history.id INTO v_first_segment
    FROM public.enrollment_class_history AS history
    WHERE history.enrollment_id = p_enrollment_id
    ORDER BY history.effective_from
    LIMIT 1;

    CREATE TEMP TABLE IF NOT EXISTS pg_temp.sync_enrollment_report_rows (
        report_id uuid,
        occurrence_id uuid,
        occurrence_date date,
        is_fixed boolean
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.sync_enrollment_report_rows;

    -- Classify the enrollment's existing reports. A blank placeholder on a
    -- closed lesson is movable even though the holiday marked it absent.
    INSERT INTO pg_temp.sync_enrollment_report_rows
    SELECT report.id, occurrence.id, occurrence.occurrence_date,
           NOT private.is_blank_occurrence_report(report)
           OR EXISTS (
               SELECT 1 FROM public.single_lesson_transfers AS transfer
               WHERE transfer.enrollment_id = p_enrollment_id
                 AND transfer.target_occurrence_id = occurrence.id
                 AND transfer.cancelled_at IS NULL
           )
           OR NOT EXISTS (
               SELECT 1 FROM public.enrollment_class_history AS history
               WHERE history.enrollment_id = p_enrollment_id
                 AND history.class_session_id = occurrence.class_session_id
                 AND (history.effective_from <= occurrence.occurrence_date OR history.id = v_first_segment)
                 AND (history.effective_to IS NULL OR history.effective_to >= occurrence.occurrence_date)
           )
    FROM public.occurrence_reports AS report
    JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
    WHERE report.enrollment_id = p_enrollment_id;

    SELECT count(*) FILTER (WHERE is_fixed), count(*) FILTER (WHERE NOT is_fixed)
    INTO v_fixed_count, v_blank_count
    FROM pg_temp.sync_enrollment_report_rows;

    v_target := COALESCE(p_target_count, v_fixed_count + v_blank_count);
    v_slots := GREATEST(v_target - v_fixed_count, 0);

    SELECT COALESCE(jsonb_agg(to_jsonb(row_value.occurrence_date) ORDER BY row_value.occurrence_date), '[]'::jsonb)
    INTO v_fixed_before_start
    FROM pg_temp.sync_enrollment_report_rows AS row_value
    WHERE row_value.is_fixed AND row_value.occurrence_date < v_start;

    -- The lessons the blank placeholders should sit on: one per date.
    CREATE TEMP TABLE IF NOT EXISTS pg_temp.sync_enrollment_chosen (
        occurrence_id uuid PRIMARY KEY,
        occurrence_date date
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.sync_enrollment_chosen;

    INSERT INTO pg_temp.sync_enrollment_chosen
    SELECT candidate.id, candidate.occurrence_date
    FROM (
        SELECT DISTINCT ON (occurrence.occurrence_date)
               occurrence.id, occurrence.occurrence_date, occurrence.original_start_time
        FROM public.class_occurrences AS occurrence
        JOIN public.enrollment_class_history AS history
          ON history.enrollment_id = p_enrollment_id
         AND history.class_session_id = occurrence.class_session_id
         AND (history.effective_from <= occurrence.occurrence_date OR history.id = v_first_segment)
         AND (history.effective_to IS NULL OR history.effective_to >= occurrence.occurrence_date)
        WHERE occurrence.occurrence_date >= v_start
          AND COALESCE(occurrence.status, 'scheduled') NOT IN ('cancelled', 'rescheduled')
          AND NOT private.is_closed_occurrence(occurrence.id)
          AND NOT EXISTS (
              SELECT 1 FROM public.single_lesson_transfers AS transfer
              WHERE transfer.enrollment_id = p_enrollment_id
                AND transfer.source_occurrence_id = occurrence.id
                AND transfer.cancelled_at IS NULL
          )
          AND NOT EXISTS (
              SELECT 1 FROM pg_temp.sync_enrollment_report_rows AS row_value
              WHERE row_value.is_fixed AND row_value.occurrence_date = occurrence.occurrence_date
          )
        ORDER BY occurrence.occurrence_date,
                 -- Keep an existing placeholder where it is.
                 (EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_report_rows AS row_value WHERE row_value.occurrence_id = occurrence.id)) DESC,
                 occurrence.original_start_time NULLS LAST, occurrence.id
    ) AS candidate
    ORDER BY candidate.occurrence_date, candidate.original_start_time NULLS LAST, candidate.id
    LIMIT v_slots;

    SELECT count(*) INTO v_chosen_count FROM pg_temp.sync_enrollment_chosen;

    SELECT COALESCE(jsonb_agg(to_jsonb(row_value.occurrence_date) ORDER BY row_value.occurrence_date), '[]'::jsonb)
    INTO v_removed
    FROM pg_temp.sync_enrollment_report_rows AS row_value
    WHERE NOT row_value.is_fixed
      AND NOT EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_chosen AS chosen WHERE chosen.occurrence_id = row_value.occurrence_id);

    SELECT COALESCE(jsonb_agg(to_jsonb(chosen.occurrence_date) ORDER BY chosen.occurrence_date), '[]'::jsonb)
    INTO v_created
    FROM pg_temp.sync_enrollment_chosen AS chosen
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_report_rows AS row_value WHERE row_value.occurrence_id = chosen.occurrence_id);

    IF NOT p_dry_run THEN
        DELETE FROM public.report_versions AS version_row
        USING pg_temp.sync_enrollment_report_rows AS row_value
        WHERE version_row.occurrence_report_id = row_value.report_id
          AND NOT row_value.is_fixed
          AND NOT EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_chosen AS chosen WHERE chosen.occurrence_id = row_value.occurrence_id);
        DELETE FROM public.occurrence_reports AS report
        USING pg_temp.sync_enrollment_report_rows AS row_value
        WHERE report.id = row_value.report_id
          AND NOT row_value.is_fixed
          AND NOT EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_chosen AS chosen WHERE chosen.occurrence_id = row_value.occurrence_id);

        FOR v_row IN
            SELECT chosen.occurrence_id FROM pg_temp.sync_enrollment_chosen AS chosen
            WHERE NOT EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_report_rows AS row_value WHERE row_value.occurrence_id = chosen.occurrence_id)
        LOOP
            SELECT * INTO v_attendance FROM public.get_effective_attendance(p_enrollment_id, v_row.occurrence_id);
            INSERT INTO public.occurrence_reports (
                enrollment_id, class_occurrence_id, content, version, is_completed, attendance_status, absence_reason
            ) VALUES (
                p_enrollment_id, v_row.occurrence_id, '', 1, false,
                COALESCE(v_attendance.attendance_status, 'pending'), v_attendance.absence_reason
            )
            ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'enrollment_id', p_enrollment_id,
        'start_date', v_start,
        'target_count', v_target,
        'fixed_count', v_fixed_count,
        'created_dates', v_created,
        'removed_dates', v_removed,
        'fixed_before_start_dates', v_fixed_before_start,
        'missing_count', GREATEST(v_slots - v_chosen_count, 0),
        'dry_run', p_dry_run
    );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_enrollment_reports(uuid, integer, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_enrollment_reports(uuid, integer, date, boolean) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.transfer_enrollment_class(uuid, uuid, date);

CREATE OR REPLACE FUNCTION public.transfer_enrollment_class(
    p_enrollment_id uuid,
    p_target_session_id uuid,
    p_effective_date date,
    p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enrollment public.enrollments%ROWTYPE;
    v_target public.class_sessions%ROWTYPE;
    v_effective date;
    v_open_from date;
    v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_total integer;
    v_replaced jsonb;
    v_changes jsonb := '[]'::jsonb;
    v_retained jsonb := '[]'::jsonb;
    v_used_dates date[] := '{}'::date[];
    v_report record;
    v_candidate record;
    v_attendance record;
    v_sync jsonb;
    v_moved integer := 0;
    v_deleted integer := 0;
    v_created integer := 0;
    v_transfer_id uuid;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;
    IF p_effective_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_TRANSFER_DATE';
    END IF;
    IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
        RAISE EXCEPTION 'TRANSFER_NOTE_TOO_LONG';
    END IF;

    SELECT enrollment.* INTO v_enrollment
    FROM public.enrollments AS enrollment
    WHERE enrollment.id = p_enrollment_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;
    IF v_enrollment.class_session_id IS NULL THEN RAISE EXCEPTION 'ENROLLMENT_HAS_NO_CLASS'; END IF;

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

    SELECT history.effective_from INTO v_open_from
    FROM public.enrollment_class_history AS history
    WHERE history.enrollment_id = p_enrollment_id AND history.effective_to IS NULL;
    -- Moving the current class's own start earlier is allowed (it replaces
    -- the earlier history); anything else into the current class is a no-op.
    IF v_enrollment.class_session_id = p_target_session_id
       AND (v_open_from IS NULL OR v_open_from <= v_effective) THEN
        RAISE EXCEPTION 'TARGET_SESSION_SAME_AS_CURRENT';
    END IF;

    SELECT count(*) INTO v_total
    FROM public.occurrence_reports AS report
    WHERE report.enrollment_id = p_enrollment_id;

    -- 1. History: everything from the effective date on belongs to the target.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'class_session_id', history.class_session_id,
               'classroom_id', history.classroom_id,
               'effective_from', history.effective_from,
               'effective_to', history.effective_to
           ) ORDER BY history.effective_from), '[]'::jsonb)
    INTO v_replaced
    FROM public.enrollment_class_history AS history
    WHERE history.enrollment_id = p_enrollment_id
      AND (history.effective_to IS NULL OR history.effective_to >= v_effective);

    DELETE FROM public.enrollment_class_history
    WHERE enrollment_id = p_enrollment_id AND effective_from >= v_effective;
    UPDATE public.enrollment_class_history
    SET effective_to = v_effective - 1
    WHERE enrollment_id = p_enrollment_id
      AND effective_from < v_effective
      AND (effective_to IS NULL OR effective_to >= v_effective);
    INSERT INTO public.enrollment_class_history (enrollment_id, class_session_id, classroom_id, effective_from)
    VALUES (p_enrollment_id, p_target_session_id, v_target.classroom_id, v_effective);

    UPDATE public.enrollments
    SET class_session_id = p_target_session_id,
        classroom_id = v_target.classroom_id
    WHERE id = p_enrollment_id;

    -- 2. Reports on/after the date outside the target class. Reports with
    -- content stay and keep their date; single-lesson transfer targets stay.
    CREATE TEMP TABLE IF NOT EXISTS pg_temp.transfer_moving_reports (
        report_id uuid PRIMARY KEY,
        occurrence_id uuid,
        occurrence_date date,
        position integer
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.transfer_moving_reports;

    FOR v_report IN
        SELECT report AS report_row, report.id, report.class_occurrence_id, occurrence.occurrence_date
        FROM public.occurrence_reports AS report
        JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
        WHERE report.enrollment_id = p_enrollment_id
          AND occurrence.class_session_id IS DISTINCT FROM p_target_session_id
          AND occurrence.occurrence_date >= v_effective
          AND NOT EXISTS (
              SELECT 1 FROM public.single_lesson_transfers AS transfer
              WHERE transfer.enrollment_id = p_enrollment_id
                AND transfer.target_occurrence_id = occurrence.id
                AND transfer.cancelled_at IS NULL
          )
        ORDER BY occurrence.occurrence_date, occurrence.original_start_time NULLS LAST, report.id
        FOR UPDATE OF report
    LOOP
        IF NOT private.is_blank_occurrence_report(v_report.report_row) THEN
            v_retained := v_retained || jsonb_build_object(
                'report_id', v_report.id,
                'occurrence_id', v_report.class_occurrence_id,
                'occurrence_date', v_report.occurrence_date
            );
            v_changes := v_changes || jsonb_build_object(
                'report_id', v_report.id, 'action', 'retained',
                'from_occurrence_id', v_report.class_occurrence_id, 'to_occurrence_id', v_report.class_occurrence_id,
                'from_date', v_report.occurrence_date, 'to_date', v_report.occurrence_date
            );
        ELSE
            INSERT INTO pg_temp.transfer_moving_reports
            VALUES (v_report.id, v_report.class_occurrence_id, v_report.occurrence_date,
                    (SELECT count(*) FROM pg_temp.transfer_moving_reports) + 1);
        END IF;
    END LOOP;

    -- Dates the student already holds a report on that is not moving.
    SELECT COALESCE(array_agg(DISTINCT occurrence.occurrence_date), '{}'::date[])
    INTO v_used_dates
    FROM public.occurrence_reports AS report
    JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
    WHERE report.enrollment_id = p_enrollment_id
      AND NOT EXISTS (SELECT 1 FROM pg_temp.transfer_moving_reports AS moving WHERE moving.report_id = report.id);

    -- 3. Pair the blank placeholders with free target lessons in date order.
    FOR v_report IN
        SELECT moving.* FROM pg_temp.transfer_moving_reports AS moving ORDER BY moving.position
    LOOP
        SELECT occurrence.id, occurrence.occurrence_date INTO v_candidate
        FROM public.class_occurrences AS occurrence
        WHERE occurrence.class_session_id = p_target_session_id
          AND occurrence.occurrence_date >= v_effective
          AND NOT (occurrence.occurrence_date = ANY(v_used_dates))
          AND COALESCE(occurrence.status, 'scheduled') NOT IN ('cancelled', 'rescheduled')
          AND NOT private.is_closed_occurrence(occurrence.id)
          AND NOT EXISTS (
              SELECT 1 FROM public.single_lesson_transfers AS transfer
              WHERE transfer.enrollment_id = p_enrollment_id
                AND transfer.source_occurrence_id = occurrence.id
                AND transfer.cancelled_at IS NULL
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.occurrence_reports AS existing
              WHERE existing.enrollment_id = p_enrollment_id
                AND existing.class_occurrence_id = occurrence.id
          )
        ORDER BY occurrence.occurrence_date, occurrence.original_start_time NULLS LAST, occurrence.id
        LIMIT 1;

        IF NOT FOUND THEN
            DELETE FROM public.report_versions WHERE occurrence_report_id = v_report.report_id;
            DELETE FROM public.occurrence_reports WHERE id = v_report.report_id;
            v_deleted := v_deleted + 1;
            v_changes := v_changes || jsonb_build_object(
                'report_id', v_report.report_id, 'action', 'deleted',
                'from_occurrence_id', v_report.occurrence_id, 'to_occurrence_id', NULL,
                'from_date', v_report.occurrence_date, 'to_date', NULL
            );
        ELSE
            SELECT * INTO v_attendance FROM public.get_effective_attendance(p_enrollment_id, v_candidate.id);
            UPDATE public.occurrence_reports
            SET class_occurrence_id = v_candidate.id,
                attendance_status = COALESCE(v_attendance.attendance_status, 'pending'),
                absence_reason = v_attendance.absence_reason
            WHERE id = v_report.report_id;
            v_used_dates := v_used_dates || v_candidate.occurrence_date;
            v_moved := v_moved + 1;
            v_changes := v_changes || jsonb_build_object(
                'report_id', v_report.report_id, 'action', 'moved',
                'from_occurrence_id', v_report.occurrence_id, 'to_occurrence_id', v_candidate.id,
                'from_date', v_report.occurrence_date, 'to_date', v_candidate.occurrence_date
            );
        END IF;
    END LOOP;

    -- 4. Keep the pre-transfer report count.
    CREATE TEMP TABLE IF NOT EXISTS pg_temp.transfer_report_snapshot (
        report_id uuid PRIMARY KEY,
        occurrence_id uuid,
        occurrence_date date
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.transfer_report_snapshot;
    INSERT INTO pg_temp.transfer_report_snapshot
    SELECT report.id, report.class_occurrence_id, occurrence.occurrence_date
    FROM public.occurrence_reports AS report
    JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
    WHERE report.enrollment_id = p_enrollment_id;

    v_sync := public.sync_enrollment_reports(p_enrollment_id, v_total, NULL, false);

    SELECT v_changes || COALESCE(jsonb_agg(jsonb_build_object(
               'report_id', snapshot.report_id, 'action', 'deleted',
               'from_occurrence_id', snapshot.occurrence_id, 'to_occurrence_id', NULL,
               'from_date', snapshot.occurrence_date, 'to_date', NULL
           ) ORDER BY snapshot.occurrence_date), '[]'::jsonb),
           v_deleted + count(*)
    INTO v_changes, v_deleted
    FROM pg_temp.transfer_report_snapshot AS snapshot
    WHERE NOT EXISTS (SELECT 1 FROM public.occurrence_reports AS report WHERE report.id = snapshot.report_id);

    SELECT v_changes || COALESCE(jsonb_agg(jsonb_build_object(
               'report_id', report.id, 'action', 'created',
               'from_occurrence_id', NULL, 'to_occurrence_id', report.class_occurrence_id,
               'from_date', NULL, 'to_date', occurrence.occurrence_date
           ) ORDER BY occurrence.occurrence_date), '[]'::jsonb),
           count(*)
    INTO v_changes, v_created
    FROM public.occurrence_reports AS report
    JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
    WHERE report.enrollment_id = p_enrollment_id
      AND NOT EXISTS (SELECT 1 FROM pg_temp.transfer_report_snapshot AS snapshot WHERE snapshot.report_id = report.id);

    -- 5. Audit trail.
    INSERT INTO public.enrollment_class_transfers (
        enrollment_id, from_class_session_id, to_class_session_id, effective_date, note,
        source, replaced_segments, report_changes, created_by
    ) VALUES (
        p_enrollment_id, v_enrollment.class_session_id, p_target_session_id, v_effective, v_note,
        'transfer', v_replaced, v_changes, auth.uid()
    ) RETURNING id INTO v_transfer_id;

    RETURN jsonb_build_object(
        'transfer_id', v_transfer_id,
        'enrollment_id', p_enrollment_id,
        'class_session_id', p_target_session_id,
        'classroom_id', v_target.classroom_id,
        'effective_date', v_effective,
        'moved_reports', v_moved,
        'created_reports', v_created,
        'removed_placeholders', v_deleted,
        'retained_reports', v_retained,
        'target_count', v_total,
        'missing_count', COALESCE((v_sync->>'missing_count')::integer, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_enrollment_class(uuid, uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_enrollment_class(uuid, uuid, date, text) TO authenticated, service_role;

-- Where a report sits relative to the student's class history.
CREATE OR REPLACE FUNCTION private.report_placement(
    p_enrollment_id uuid,
    p_occurrence_id uuid
) RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN EXISTS (
            SELECT 1 FROM public.single_lesson_transfers AS transfer
            WHERE transfer.enrollment_id = p_enrollment_id
              AND transfer.target_occurrence_id = p_occurrence_id
              AND transfer.cancelled_at IS NULL
        ) THEN 'makeup_in'
        WHEN EXISTS (
            SELECT 1 FROM public.enrollment_class_history AS history
            WHERE history.enrollment_id = p_enrollment_id
              AND history.class_session_id = occurrence.class_session_id
              AND history.effective_from <= occurrence.occurrence_date
              AND (history.effective_to IS NULL OR history.effective_to >= occurrence.occurrence_date)
        ) THEN 'regular'
        WHEN EXISTS (
            SELECT 1 FROM public.enrollment_class_history AS history
            WHERE history.enrollment_id = p_enrollment_id
              AND history.class_session_id = occurrence.class_session_id
              AND history.effective_to IS NOT NULL
              AND history.effective_to < occurrence.occurrence_date
        ) THEN 'retained_after_transfer'
        ELSE 'outside'
    END
    FROM public.class_occurrences AS occurrence
    WHERE occurrence.id = p_occurrence_id;
$$;

REVOKE ALL ON FUNCTION private.report_placement(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_enrollment_class_timeline(
    p_enrollment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND NOT public.can_access_enrollment(p_enrollment_id, 'teaching.enrollments.read') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    RETURN jsonb_build_object(
        'enrollment_id', p_enrollment_id,
        'segments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'class_session_id', history.class_session_id,
                'class_session_name', session.name,
                'classroom_id', history.classroom_id,
                'effective_from', history.effective_from,
                'effective_to', history.effective_to
            ) ORDER BY history.effective_from)
            FROM public.enrollment_class_history AS history
            LEFT JOIN public.class_sessions AS session ON session.id = history.class_session_id
            WHERE history.enrollment_id = p_enrollment_id
        ), '[]'::jsonb),
        'transfers', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', transfer.id,
                'from_class_session_id', transfer.from_class_session_id,
                'from_class_session_name', from_session.name,
                'to_class_session_id', transfer.to_class_session_id,
                'to_class_session_name', to_session.name,
                'effective_date', transfer.effective_date,
                'note', transfer.note,
                'source', transfer.source,
                'report_changes', transfer.report_changes,
                'created_by', transfer.created_by,
                'created_at', transfer.created_at
            ) ORDER BY transfer.created_at)
            FROM public.enrollment_class_transfers AS transfer
            LEFT JOIN public.class_sessions AS from_session ON from_session.id = transfer.from_class_session_id
            LEFT JOIN public.class_sessions AS to_session ON to_session.id = transfer.to_class_session_id
            WHERE transfer.enrollment_id = p_enrollment_id AND transfer.revoked_at IS NULL
        ), '[]'::jsonb),
        'lesson_transfers', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', transfer.id,
                'source_occurrence_id', transfer.source_occurrence_id,
                'source_date', source_occurrence.occurrence_date,
                'source_class_session_id', source_occurrence.class_session_id,
                'target_occurrence_id', transfer.target_occurrence_id,
                'target_date', target_occurrence.occurrence_date,
                'target_class_session_id', target_occurrence.class_session_id,
                'target_class_session_name', target_session.name,
                'created_at', transfer.created_at
            ) ORDER BY target_occurrence.occurrence_date)
            FROM public.single_lesson_transfers AS transfer
            JOIN public.class_occurrences AS source_occurrence ON source_occurrence.id = transfer.source_occurrence_id
            JOIN public.class_occurrences AS target_occurrence ON target_occurrence.id = transfer.target_occurrence_id
            LEFT JOIN public.class_sessions AS target_session ON target_session.id = target_occurrence.class_session_id
            WHERE transfer.enrollment_id = p_enrollment_id AND transfer.cancelled_at IS NULL
        ), '[]'::jsonb),
        'reports', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', report.id,
                'occurrence_id', occurrence.id,
                'occurrence_date', occurrence.occurrence_date,
                'class_session_id', occurrence.class_session_id,
                'class_session_name', session.name,
                'is_completed', report.is_completed,
                'is_blank', private.is_blank_occurrence_report(report),
                'placement', private.report_placement(p_enrollment_id, occurrence.id)
            ) ORDER BY occurrence.occurrence_date, occurrence.original_start_time NULLS LAST)
            FROM public.occurrence_reports AS report
            JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
            LEFT JOIN public.class_sessions AS session ON session.id = occurrence.class_session_id
            WHERE report.enrollment_id = p_enrollment_id
        ), '[]'::jsonb)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_enrollment_class_timeline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_enrollment_class_timeline(uuid) TO authenticated, service_role;

-- Students who joined a class lesson by a single-lesson transfer, left it by
-- one, or transferred into the class on that date.
CREATE OR REPLACE FUNCTION public.get_class_session_roster_flags(
    p_session_id uuid,
    p_start date,
    p_end date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;
    IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 120 THEN
        RAISE EXCEPTION 'INVALID_DATE_RANGE';
    END IF;
    IF COALESCE(auth.role(), '') <> 'service_role' AND NOT (
        public.can_access_class_session(p_session_id, 'teaching.class_sessions.read')
        OR public.can_access_class_session(p_session_id, 'teaching.class_sessions.list')
    ) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'date', flag.flag_date,
            'enrollment_id', flag.enrollment_id,
            'student_id', enrollment.student_id,
            'student_name', student.name,
            'flag', flag.flag
        ) ORDER BY flag.flag_date, student.name, flag.flag)
        FROM (
            SELECT occurrence.occurrence_date AS flag_date, transfer.enrollment_id, 'makeup_in' AS flag
            FROM public.single_lesson_transfers AS transfer
            JOIN public.class_occurrences AS occurrence ON occurrence.id = transfer.target_occurrence_id
            WHERE occurrence.class_session_id = p_session_id
              AND occurrence.occurrence_date BETWEEN p_start AND p_end
              AND transfer.cancelled_at IS NULL
            UNION
            SELECT occurrence.occurrence_date, transfer.enrollment_id, 'makeup_out'
            FROM public.single_lesson_transfers AS transfer
            JOIN public.class_occurrences AS occurrence ON occurrence.id = transfer.source_occurrence_id
            WHERE occurrence.class_session_id = p_session_id
              AND occurrence.occurrence_date BETWEEN p_start AND p_end
              AND transfer.cancelled_at IS NULL
            UNION
            SELECT history.effective_from, history.enrollment_id, 'transfer_in'
            FROM public.enrollment_class_history AS history
            WHERE history.class_session_id = p_session_id
              AND history.effective_from BETWEEN p_start AND p_end
              AND EXISTS (
                  SELECT 1 FROM public.enrollment_class_history AS earlier
                  WHERE earlier.enrollment_id = history.enrollment_id
                    AND earlier.effective_from < history.effective_from
              )
        ) AS flag
        JOIN public.enrollments AS enrollment ON enrollment.id = flag.enrollment_id
        LEFT JOIN public.students AS student ON student.id = enrollment.student_id
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_class_session_roster_flags(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_class_session_roster_flags(uuid, date, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
