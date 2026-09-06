\set ON_ERROR_STOP on

DO $$
DECLARE legacy_teaching uuid;
BEGIN
  SELECT teaching_id INTO legacy_teaching
  FROM public.classrooms
  WHERE id = '30000000-0000-0000-0000-0000000000aa';

  IF legacy_teaching IS NULL THEN
    RAISE EXCEPTION 'owner-based classroom teaching backfill failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_members
    WHERE teaching_id = legacy_teaching
      AND user_id = '00000000-0000-0000-0000-0000000000aa'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'owner membership backfill failed';
  END IF;
END;
$$;
