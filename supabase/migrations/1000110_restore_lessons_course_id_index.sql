-- Keep the dedicated course_id lookup index until target query plans confirm
-- whether it outperforms the composite lessons(course_id, sequence, id) index.
CREATE INDEX IF NOT EXISTS lessons_course_id_idx
  ON public.lessons USING btree (course_id);

COMMENT ON INDEX public.lessons_course_id_idx IS
  'Dedicated course_id lookup path; retain pending target query-plan validation against lessons_course_id_sequence_idx.';
