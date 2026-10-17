-- Restore the standalone course lookup index. Keep this as a forward migration
-- because 1000105 has already shipped and must remain immutable.
CREATE INDEX IF NOT EXISTS lessons_course_id_idx
  ON public.lessons USING btree (course_id);
