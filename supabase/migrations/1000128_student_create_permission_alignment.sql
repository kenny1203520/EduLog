-- Students are global records: clear_legacy_owner_before_write clears user_id
-- before RLS runs. Authorize creation with the same platform permission as the
-- API rather than requiring an ownership value that the trigger removes.
BEGIN;

DROP POLICY IF EXISTS "Canonical students create" ON public.students;
CREATE POLICY "Canonical students create" ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (public.has_api_permission((select auth.uid()), 'teaching.students.create', NULL, NULL));

-- INSERT RETURNING also checks SELECT RLS. can_access_student is STABLE and
-- looks up the student row, so it cannot see that new row in the INSERT's
-- snapshot. Evaluate the existing platform read grant directly; scoped reads
-- still use the ownership graph, and create permission alone grants no read.
DROP POLICY IF EXISTS "Canonical students read" ON public.students;
CREATE POLICY "Canonical students read" ON public.students
  FOR SELECT TO authenticated
  USING (
    public.has_api_permission((select auth.uid()), 'teaching.students.read', NULL, NULL)
    OR public.can_access_student(id, 'teaching.students.read')
    OR user_id = (select auth.uid())
  );

COMMIT;
