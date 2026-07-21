-- ==========================================
-- Recurring and Camp Class Sessions
-- ==========================================
-- Adds normalized weekly, monthly, and specific-date schedules while keeping
-- the legacy single-day columns as a compatibility projection.
-- Date: 2026-07-21
-- Dependencies: 1000002_academics.sql, 1000003_operations.sql
-- ==========================================

ALTER TABLE public.class_sessions
ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'regular',
ADD COLUMN IF NOT EXISTS schedule_mode text NOT NULL DEFAULT 'weekly';

ALTER TABLE public.class_sessions
ALTER COLUMN start_date DROP NOT NULL,
ALTER COLUMN start_time DROP NOT NULL,
ALTER COLUMN end_time DROP NOT NULL;

ALTER TABLE public.class_sessions
DROP CONSTRAINT IF EXISTS class_sessions_session_type_check;

ALTER TABLE public.class_sessions
ADD CONSTRAINT class_sessions_session_type_check
CHECK (session_type IN ('regular', 'camp'));

ALTER TABLE public.class_sessions
DROP CONSTRAINT IF EXISTS class_sessions_schedule_mode_check;

ALTER TABLE public.class_sessions
ADD CONSTRAINT class_sessions_schedule_mode_check
CHECK (schedule_mode IN ('weekly', 'monthly', 'specific_dates'));

ALTER TABLE public.class_sessions
DROP CONSTRAINT IF EXISTS class_sessions_type_schedule_check;

ALTER TABLE public.class_sessions
ADD CONSTRAINT class_sessions_type_schedule_check
CHECK (
    (session_type = 'regular' AND schedule_mode IN ('weekly', 'monthly'))
    OR (session_type = 'camp' AND schedule_mode = 'specific_dates')
);

ALTER TABLE public.class_sessions
DROP CONSTRAINT IF EXISTS class_sessions_date_range_check;

ALTER TABLE public.class_sessions
ADD CONSTRAINT class_sessions_date_range_check
CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date);

CREATE TABLE IF NOT EXISTS public.class_session_schedule_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_session_id uuid NOT NULL REFERENCES public.class_sessions(id) ON DELETE CASCADE,
    schedule_kind text NOT NULL CHECK (schedule_kind IN ('weekly', 'monthly', 'specific_dates')),
    day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6),
    day_of_month integer CHECK (day_of_month BETWEEN 1 AND 31),
    occurrence_date date,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT class_session_schedule_rules_time_check CHECK (start_time < end_time),
    CONSTRAINT class_session_schedule_rules_selector_check CHECK (
        (schedule_kind = 'weekly' AND day_of_week IS NOT NULL AND day_of_month IS NULL AND occurrence_date IS NULL)
        OR (schedule_kind = 'monthly' AND day_of_week IS NULL AND day_of_month IS NOT NULL AND occurrence_date IS NULL)
        OR (schedule_kind = 'specific_dates' AND day_of_week IS NULL AND day_of_month IS NULL AND occurrence_date IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS class_session_schedule_rules_weekly_unique
ON public.class_session_schedule_rules(class_session_id, day_of_week)
WHERE schedule_kind = 'weekly';

CREATE UNIQUE INDEX IF NOT EXISTS class_session_schedule_rules_monthly_unique
ON public.class_session_schedule_rules(class_session_id, day_of_month)
WHERE schedule_kind = 'monthly';

CREATE UNIQUE INDEX IF NOT EXISTS class_session_schedule_rules_date_unique
ON public.class_session_schedule_rules(class_session_id, occurrence_date)
WHERE schedule_kind = 'specific_dates';

CREATE INDEX IF NOT EXISTS idx_class_session_schedule_rules_session
ON public.class_session_schedule_rules(class_session_id);

ALTER TABLE public.class_session_schedule_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for authenticated users"
ON public.class_session_schedule_rules
FOR ALL
USING ((SELECT auth.role()) = 'authenticated')
WITH CHECK ((SELECT auth.role()) = 'authenticated');

CREATE TRIGGER update_class_session_schedule_rules_updated_at
BEFORE UPDATE ON public.class_session_schedule_rules
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

INSERT INTO public.class_session_schedule_rules (
    class_session_id,
    schedule_kind,
    day_of_week,
    start_time,
    end_time
)
SELECT id, 'weekly', day_of_week, start_time, end_time
FROM public.class_sessions
WHERE day_of_week IS NOT NULL
  AND start_time IS NOT NULL
  AND end_time IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_class_session_with_schedule(
    p_session jsonb,
    p_rules jsonb,
    p_session_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_session_id uuid;
    v_session_type text := COALESCE(NULLIF(p_session->>'session_type', ''), 'regular');
    v_schedule_mode text := COALESCE(NULLIF(p_session->>'schedule_mode', ''), 'weekly');
    v_start_date date := NULLIF(p_session->>'start_date', '')::date;
    v_end_date date := NULLIF(p_session->>'end_date', '')::date;
    v_first_rule record;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF jsonb_typeof(COALESCE(p_rules, '[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'Schedule rules must be a JSON array';
    END IF;

    IF v_session_type NOT IN ('regular', 'camp')
       OR v_schedule_mode NOT IN ('weekly', 'monthly', 'specific_dates')
       OR (v_session_type = 'camp' AND v_schedule_mode <> 'specific_dates')
       OR (v_session_type = 'regular' AND v_schedule_mode = 'specific_dates') THEN
        RAISE EXCEPTION 'Invalid session type and schedule mode combination';
    END IF;

    IF v_session_type = 'regular' AND v_start_date IS NULL THEN
        RAISE EXCEPTION 'Regular sessions require a start date';
    END IF;

    IF v_session_type = 'regular' AND jsonb_array_length(COALESCE(p_rules, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Regular sessions require at least one schedule rule';
    END IF;

    IF v_start_date IS NOT NULL AND v_end_date IS NOT NULL AND v_start_date > v_end_date THEN
        RAISE EXCEPTION 'Start date must not be after end date';
    END IF;

    IF p_session_id IS NULL THEN
        INSERT INTO public.class_sessions (
            name, classroom_id, course_ids, capacity, lesson_number,
            external_link, start_date, end_date, time_zone,
            session_type, schedule_mode, user_id
        ) VALUES (
            p_session->>'name',
            NULLIF(p_session->>'classroom_id', '')::uuid,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_session->'course_ids', '[]'::jsonb)))::uuid[],
            COALESCE(NULLIF(p_session->>'capacity', '')::integer, 10),
            NULLIF(p_session->>'lesson_number', '')::integer,
            NULLIF(p_session->>'external_link', ''),
            v_start_date,
            v_end_date,
            COALESCE(NULLIF(p_session->>'time_zone', ''), 'Asia/Taipei'),
            v_session_type,
            v_schedule_mode,
            auth.uid()
        ) RETURNING id INTO v_session_id;
    ELSE
        UPDATE public.class_sessions SET
            name = p_session->>'name',
            classroom_id = NULLIF(p_session->>'classroom_id', '')::uuid,
            course_ids = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_session->'course_ids', '[]'::jsonb)))::uuid[],
            capacity = COALESCE(NULLIF(p_session->>'capacity', '')::integer, 10),
            lesson_number = NULLIF(p_session->>'lesson_number', '')::integer,
            external_link = NULLIF(p_session->>'external_link', ''),
            start_date = v_start_date,
            end_date = v_end_date,
            time_zone = COALESCE(NULLIF(p_session->>'time_zone', ''), 'Asia/Taipei'),
            session_type = v_session_type,
            schedule_mode = v_schedule_mode
        WHERE id = p_session_id
        RETURNING id INTO v_session_id;

        IF v_session_id IS NULL THEN
            RAISE EXCEPTION 'Class session not found';
        END IF;
    END IF;

    DELETE FROM public.class_session_schedule_rules
    WHERE class_session_id = v_session_id;

    INSERT INTO public.class_session_schedule_rules (
        class_session_id, schedule_kind, day_of_week, day_of_month,
        occurrence_date, start_time, end_time
    )
    SELECT
        v_session_id,
        rule.schedule_kind,
        rule.day_of_week,
        rule.day_of_month,
        rule.occurrence_date,
        rule.start_time,
        rule.end_time
    FROM jsonb_to_recordset(COALESCE(p_rules, '[]'::jsonb)) AS rule(
        schedule_kind text,
        day_of_week integer,
        day_of_month integer,
        occurrence_date date,
        start_time time,
        end_time time
    );

    IF EXISTS (
        SELECT 1 FROM public.class_session_schedule_rules
        WHERE class_session_id = v_session_id
          AND schedule_kind <> v_schedule_mode
    ) THEN
        RAISE EXCEPTION 'Schedule rule kind must match session schedule mode';
    END IF;

    IF v_session_type = 'camp' AND v_start_date IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.class_session_schedule_rules
        WHERE class_session_id = v_session_id AND occurrence_date < v_start_date
    ) THEN
        RAISE EXCEPTION 'Camp schedule date is before the start date';
    END IF;

    IF v_session_type = 'camp' AND v_end_date IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.class_session_schedule_rules
        WHERE class_session_id = v_session_id AND occurrence_date > v_end_date
    ) THEN
        RAISE EXCEPTION 'Camp schedule date is after the end date';
    END IF;

    SELECT * INTO v_first_rule
    FROM public.class_session_schedule_rules
    WHERE class_session_id = v_session_id
    ORDER BY COALESCE(day_of_week, day_of_month, EXTRACT(DOY FROM occurrence_date)::integer), start_time
    LIMIT 1;

    UPDATE public.class_sessions SET
        day_of_week = CASE
            WHEN v_first_rule.schedule_kind = 'weekly' THEN v_first_rule.day_of_week
            WHEN v_first_rule.schedule_kind = 'specific_dates' THEN EXTRACT(DOW FROM v_first_rule.occurrence_date)::integer
            ELSE NULL
        END,
        start_time = v_first_rule.start_time,
        end_time = v_first_rule.end_time
    WHERE id = v_session_id;

    RETURN v_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_class_session_with_schedule(jsonb, jsonb, uuid) TO authenticated;
