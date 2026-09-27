-- The course_id prefix is already supported by the composite index added in
-- 1000078. Remove the later standalone duplicate without rewriting history.
DO $$
BEGIN
  IF to_regclass('public.lessons_course_id_sequence_idx') IS NULL THEN
    RAISE EXCEPTION '1000109 prerequisite missing: lessons_course_id_sequence_idx';
  END IF;
END;
$$;

DROP INDEX IF EXISTS public.lessons_course_id_idx;
