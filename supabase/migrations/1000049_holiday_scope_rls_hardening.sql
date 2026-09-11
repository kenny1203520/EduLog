-- EduLog forward-only holiday scope hardening.
-- 1000001-1000048 are immutable history. This migration removes the legacy
-- authenticated-wide holiday policy and requires every holiday to reference
-- at least one classroom/session visible to the acting user. Empty-scope
-- global holidays use a canonical global teaching.holidays.* permission.

DO $$
BEGIN
  IF to_regclass('public.holidays') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.can_access_classroom(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_class_session(uuid,text)') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'holidays'
         AND column_name = 'classroom_ids'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'holidays'
         AND column_name = 'class_session_ids'
     ) THEN
    RAISE EXCEPTION '1000049 prerequisites missing; apply migrations through 1000048 first';
  END IF;
END;
$$;

-- Reconcile the legacy API permission wrapper before using it in RLS. A
-- scoped request must resolve its classroom/session to one teaching before
-- evaluating the permission. The previous implementation evaluated the
-- supplied scope against every teaching, which could authorize a resource
-- from a different teaching when a user had a similarly named permission.
CREATE OR REPLACE FUNCTION public.has_system_permission(
  p_user_id uuid,
  p_permission_key text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH RECURSIVE assigned_roles(role_id) AS (
  SELECT assignment.role_id
  FROM public.user_role_assignments assignment
  WHERE assignment.user_id = p_user_id
    AND assignment.scope_type = 'system'
    AND assignment.effective_from <= CURRENT_DATE
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
), role_tree(role_id) AS (
  SELECT role_id FROM assigned_roles
  UNION
  SELECT inheritance.parent_role_id
  FROM public.role_inheritance inheritance
  JOIN role_tree child ON child.role_id = inheritance.role_id
), matched(effect) AS (
  SELECT policy.effect
  FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  WHERE policy.role_id IN (SELECT role_id FROM role_tree)
    AND policy.scope_type = 'system'
    AND permission.key = p_permission_key
)
SELECT auth.role() = 'service_role'
  OR (
    auth.uid() = p_user_id
    AND COALESCE(bool_or(matched.effect = 'allow'), false)
    AND NOT COALESCE(bool_or(matched.effect = 'deny'), false)
  )
FROM matched;
$$;

CREATE OR REPLACE FUNCTION public.has_api_permission(
  p_user_id uuid,
  p_permission_key text,
  p_classroom_id uuid DEFAULT NULL,
  p_class_session_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN true
    WHEN auth.uid() IS NULL OR auth.uid() <> p_user_id THEN false
    WHEN p_classroom_id IS NOT NULL AND p_class_session_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.classrooms classroom
      JOIN public.class_sessions session
        ON session.id = p_class_session_id
       AND session.teaching_id = classroom.teaching_id
      WHERE classroom.id = p_classroom_id
        AND public.has_teaching_permission(
          p_user_id, p_permission_key, classroom.teaching_id,
          p_classroom_id, p_class_session_id
        )
    )
    WHEN p_classroom_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.classrooms classroom
      WHERE classroom.id = p_classroom_id
        AND public.has_teaching_permission(
          p_user_id, p_permission_key, classroom.teaching_id,
          p_classroom_id, NULL
        )
    )
    WHEN p_class_session_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.class_sessions session
      WHERE session.id = p_class_session_id
        AND public.has_teaching_permission(
          p_user_id, p_permission_key, session.teaching_id,
          NULL, p_class_session_id
        )
    )
    WHEN p_permission_key IN (
      'teaching.holidays.create',
      'teaching.holidays.update',
      'teaching.holidays.delete'
    ) THEN public.has_system_permission(p_user_id, p_permission_key)
    ELSE EXISTS (
      SELECT 1
      FROM public.teaching_members member
      WHERE member.user_id = p_user_id
        AND member.status = 'active'
        AND member.effective_from <= CURRENT_DATE
        AND (member.effective_to IS NULL OR member.effective_to >= CURRENT_DATE)
        AND public.has_teaching_permission(
          p_user_id, p_permission_key, member.teaching_id, NULL, NULL
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.has_system_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_system_permission(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.holidays;
DROP POLICY IF EXISTS "Allow all authenticated users" ON public.holidays;
DROP POLICY IF EXISTS "Authenticated users can access all rows" ON public.holidays;
DROP POLICY IF EXISTS "Canonical holidays read" ON public.holidays;
DROP POLICY IF EXISTS "Canonical holidays create" ON public.holidays;
DROP POLICY IF EXISTS "Canonical holidays update" ON public.holidays;
DROP POLICY IF EXISTS "Canonical holidays delete" ON public.holidays;

CREATE POLICY "Canonical holidays read" ON public.holidays
FOR SELECT TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission(auth.uid(), 'teaching.holidays.read', NULL, NULL)
  )
  OR (
  (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
    WHERE NOT public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.read')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
    WHERE NOT public.can_access_class_session(scoped_session_id, 'teaching.holidays.read')
  )
  )
);

CREATE POLICY "Canonical holidays create" ON public.holidays
FOR INSERT TO authenticated
WITH CHECK (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission(auth.uid(), 'teaching.holidays.create', NULL, NULL)
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

CREATE POLICY "Canonical holidays update" ON public.holidays
FOR UPDATE TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission(auth.uid(), 'teaching.holidays.update', NULL, NULL)
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
    AND public.has_api_permission(auth.uid(), 'teaching.holidays.update', NULL, NULL)
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

CREATE POLICY "Canonical holidays delete" ON public.holidays
FOR DELETE TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission(auth.uid(), 'teaching.holidays.delete', NULL, NULL)
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

DO $$
DECLARE
  wide_policy_count integer;
BEGIN
  SELECT count(*)
  INTO wide_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'holidays'
    AND cmd = 'ALL'
    AND roles @> ARRAY['authenticated'::name];
  IF wide_policy_count <> 0 THEN
    RAISE EXCEPTION '1000049 authenticated-wide holiday policy remains: %', wide_policy_count;
  END IF;
END;
$$;
