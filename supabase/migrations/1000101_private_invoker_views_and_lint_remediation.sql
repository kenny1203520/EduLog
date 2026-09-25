-- 1000101: limit sensitive compatibility views to the trusted API role,
-- optimize the flagged policy expressions, and remove duplicate indexes.

-- These views are API implementation details. The backend uses service_role
-- only after its existing route-level RBAC checks; authenticated clients must
-- not query projections over auth.users or person profiles directly.
CREATE OR REPLACE VIEW public.user_accounts
WITH (security_invoker = true, security_barrier = true) AS
SELECT profile.auth_user_id AS id,
       account.email,
       COALESCE(NULLIF(btrim(profile.nickname), ''), profile.full_name) AS display_name,
       profile.full_name,
       profile.nickname,
       profile.avatar_url,
       profile.account_status,
       profile.disabled_at,
       profile.disabled_by,
       profile.disabled_reason,
       profile.created_at,
       profile.updated_at
FROM public.profiles profile
JOIN auth.users account ON account.id = profile.auth_user_id
WHERE profile.auth_user_id IS NOT NULL
  AND (auth.role() = 'service_role'
    OR profile.auth_user_id = auth.uid()
    OR public.has_api_permission(auth.uid(), 'system.users.list', NULL::uuid, NULL::uuid)
    OR public.has_api_permission(auth.uid(), 'system.users.read', NULL::uuid, NULL::uuid));

REVOKE ALL ON public.user_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_accounts TO service_role;
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT (id, email) ON auth.users TO service_role;

CREATE OR REPLACE VIEW public.teachers
WITH (security_invoker = true, security_barrier = true) AS
SELECT teacher.id,
       teacher.profile_id,
       profile.auth_user_id AS user_id,
       profile.full_name AS name,
       profile.bio,
       profile.bio_document,
       teacher.created_at,
       teacher.updated_at
FROM public.teacher_records teacher
JOIN public.profiles profile ON profile.id = teacher.profile_id
WHERE auth.role() = 'service_role'
   OR public.can_access_teacher(teacher.id, 'teaching.teachers.read');

REVOKE ALL ON public.teachers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.teachers TO service_role;
GRANT SELECT (id, profile_id, created_at, updated_at) ON public.teacher_records TO service_role;

-- Keep the current scoped holiday policy semantics and hoist the stable JWT
-- identity lookup so PostgreSQL evaluates it once per statement.
DROP POLICY IF EXISTS "Canonical holidays read" ON public.holidays;
CREATE POLICY "Canonical holidays read" ON public.holidays
FOR SELECT TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND (
      public.has_api_permission((SELECT auth.uid()), 'teaching.holidays.read', NULL, NULL)
      OR public.has_api_permission((SELECT auth.uid()), 'teaching.holidays.list', NULL, NULL)
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

DROP POLICY IF EXISTS "Canonical holidays create" ON public.holidays;
CREATE POLICY "Canonical holidays create" ON public.holidays
FOR INSERT TO authenticated
WITH CHECK (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission((SELECT auth.uid()), 'teaching.holidays.create', NULL, NULL)
  )
  OR (
    (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
      WHERE NOT public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.create')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
      WHERE NOT public.can_access_class_session(scoped_session_id, 'teaching.holidays.create')
    )
  )
);

DROP POLICY IF EXISTS "Canonical holidays update" ON public.holidays;
CREATE POLICY "Canonical holidays update" ON public.holidays
FOR UPDATE TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission((SELECT auth.uid()), 'teaching.holidays.update', NULL, NULL)
  )
  OR (
    (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
      WHERE NOT public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.update')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
      WHERE NOT public.can_access_class_session(scoped_session_id, 'teaching.holidays.update')
    )
  )
)
WITH CHECK (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission((SELECT auth.uid()), 'teaching.holidays.update', NULL, NULL)
  )
  OR (
    (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
      WHERE NOT public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.update')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
      WHERE NOT public.can_access_class_session(scoped_session_id, 'teaching.holidays.update')
    )
  )
);

DROP POLICY IF EXISTS "Canonical holidays delete" ON public.holidays;
CREATE POLICY "Canonical holidays delete" ON public.holidays
FOR DELETE TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission((SELECT auth.uid()), 'teaching.holidays.delete', NULL, NULL)
  )
  OR (
    (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
      WHERE NOT public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.delete')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
      WHERE NOT public.can_access_class_session(scoped_session_id, 'teaching.holidays.delete')
    )
  )
);

DROP POLICY IF EXISTS "Canonical reports create" ON public.occurrence_reports;
CREATE POLICY "Canonical reports create" ON public.occurrence_reports
FOR INSERT TO authenticated
WITH CHECK (
  public.can_create_occurrence_report(enrollment_id, class_occurrence_id)
  OR EXISTS (
    SELECT 1
    FROM public.class_occurrences AS occurrence
    JOIN public.class_sessions AS session
      ON session.id = occurrence.class_session_id
    JOIN public.enrollments AS enrollment
      ON enrollment.id = occurrence_reports.enrollment_id
    WHERE occurrence.id = occurrence_reports.class_occurrence_id
      AND enrollment.status = 'regular'
      AND enrollment.start_date <= occurrence.occurrence_date
      AND (
        public.has_api_permission((SELECT auth.uid()), 'teaching.reports.create', NULL, session.id)
        OR public.has_api_permission((SELECT auth.uid()), 'teaching.enrollments.create', NULL, session.id)
        OR public.has_api_permission((SELECT auth.uid()), 'teaching.enrollments.update', NULL, session.id)
      )
  )
);

-- Keep the older, descriptive indexes that already support current queries.
-- The redundant pair reported for the first date-only index may exist only on
-- deployed databases, so its removal is intentionally conditional.
DROP INDEX IF EXISTS public.idx_class_occurrences_date;
DROP INDEX IF EXISTS public.class_occurrences_date_session_id_idx;
DROP INDEX IF EXISTS public.class_sessions_teaching_id_idx;
DROP INDEX IF EXISTS public.occurrence_reports_occurrence_attendance_idx;

NOTIFY pgrst, 'reload schema';
