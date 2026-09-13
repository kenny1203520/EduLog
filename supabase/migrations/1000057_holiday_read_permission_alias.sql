-- Forward-only holiday read compatibility. Mutations remain system-only for
-- empty-scope global holidays; scoped rows use either read or list authority.

DO $$
BEGIN
  IF to_regclass('public.holidays') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('public.can_access_classroom(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_class_session(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000057 prerequisites missing; apply migrations through 1000056 first';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Canonical holidays read" ON public.holidays;
CREATE POLICY "Canonical holidays read" ON public.holidays
FOR SELECT TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND (
      public.has_api_permission((select auth.uid()), 'teaching.holidays.read', NULL, NULL)
      OR public.has_api_permission((select auth.uid()), 'teaching.holidays.list', NULL, NULL)
    )
  )
  OR (
    (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
      WHERE NOT (
        public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.read')
        OR public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.list')
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
      WHERE NOT (
        public.can_access_class_session(scoped_session_id, 'teaching.holidays.read')
        OR public.can_access_class_session(scoped_session_id, 'teaching.holidays.list')
      )
    )
  )
);
