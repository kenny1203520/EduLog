-- Add indexes recommended by Supabase Query Performance for report creation
-- ordering, lesson sequence-only access, and student birthday lookups.
-- lessons(course_id) is already covered by lessons_course_id_sequence_idx.

CREATE INDEX IF NOT EXISTS occurrence_reports_created_at_idx
  ON public.occurrence_reports USING btree (created_at);

CREATE INDEX IF NOT EXISTS lessons_sequence_idx
  ON public.lessons USING btree (sequence);

CREATE INDEX IF NOT EXISTS students_birthday_idx
  ON public.students USING btree (birthday);

