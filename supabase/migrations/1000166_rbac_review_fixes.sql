-- Fixes from the alpha.6 authorization review that fit no larger change.
--
-- * list_account_approver_emails asked has_system_permission, which answers
--   "yes" for every account when the service role calls it. The notice about
--   a pending account, with its email address, went to every active account.
--   It now asks private.account_has_system_permission, which resolves the
--   named account whoever calls.
-- * Last-owner guards counted assignments without looking at the account or
--   the assignment status, and set_system_user_status asked
--   rbac_is_system_owner about another account, which is always "no": the
--   last owner could be disabled, or removed while the other owner was
--   disabled. The guards now count private.active_system_owner_ids().
--   Changing an owner's account status, and removing any protected system
--   role, needs an owner. bootstrap_system_owner can run again when no
--   active owner is left.
-- * Linking an account to a teacher hands that account the roles of the
--   teacher's class jobs. The link now follows the same ceiling as assigning
--   those roles (1000164).
-- * get_student_profile_page listed every enrollment of the student once the
--   caller could read the student through any classroom. It now lists the
--   enrollments in classrooms or classes where the caller may read students.
--
-- Rerunnable.

DO $$
BEGIN
  IF to_regprocedure('private.active_system_owner_ids()') IS NULL
     OR to_regprocedure('private.account_is_active(uuid)') IS NULL THEN
    RAISE EXCEPTION '1000166 prerequisites missing; apply migrations through 1000165 first';
  END IF;
END;
$$;

BEGIN;

-- Does the named account hold a system permission? Unlike
-- has_system_permission this does not depend on who asks.
CREATE OR REPLACE FUNCTION private.account_has_system_permission(p_user_id uuid, p_permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
WITH RECURSIVE assigned_roles(role_id) AS (
  SELECT assignment.role_id FROM public.user_role_assignments assignment
  JOIN public.roles assigned_role ON assigned_role.id = assignment.role_id AND assigned_role.domain = 'system'
  WHERE assignment.user_id = p_user_id AND assignment.scope_type = 'system'
    AND assignment.status = 'active' AND assignment.effective_from <= CURRENT_DATE
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
), role_tree(role_id) AS (
  SELECT role_id FROM assigned_roles
  UNION
  SELECT inheritance.parent_role_id FROM public.role_inheritance inheritance
  JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  WHERE policy.role_id IN (SELECT role_id FROM role_tree)
    AND policy.scope_type = 'system' AND permission.key = p_permission_key
)
SELECT private.account_is_active(p_user_id)
  AND COALESCE((SELECT bool_or(effect = 'allow') FROM matched), false)
  AND NOT COALESCE((SELECT bool_or(effect = 'deny') FROM matched), false);
$$;
REVOKE ALL ON FUNCTION private.account_has_system_permission(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_account_approver_emails()
RETURNS TABLE(email text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT DISTINCT account.email::text
  FROM public.profiles profile
  JOIN auth.users account ON account.id = profile.auth_user_id
  WHERE profile.account_status = 'active' AND account.email IS NOT NULL
    AND private.account_has_system_permission(account.id, 'system.users.manage');
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_delete_system_assignment(p_assignment_id uuid, p_expected_epoch bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_assignment public.user_role_assignments; v_role public.roles;
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 3);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF NOT private.rbac_caller_assigns('system', 'system', NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  SELECT assignment.* INTO v_assignment
  FROM public.user_role_assignments assignment
  WHERE assignment.id=p_assignment_id AND assignment.scope_type='system' FOR UPDATE;
  IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_role FROM public.roles WHERE id = v_assignment.role_id;
  IF v_role.is_protected AND NOT private.rbac_caller_owns_domain('system') THEN RAISE EXCEPTION 'OWNER_ROLE_REQUIRED'; END IF;
  IF v_role.code = 'system_owner' AND NOT EXISTS (
    SELECT 1 FROM private.active_system_owner_ids() owner_id WHERE owner_id <> v_assignment.user_id
  ) THEN RAISE EXCEPTION 'LAST_SYSTEM_OWNER'; END IF;
  DELETE FROM public.user_role_assignments WHERE id=p_assignment_id;
END;
$$;

-- 1000097's body. An owner's status is changed by an owner, and the last
-- active owner cannot be disabled.
CREATE OR REPLACE FUNCTION public.set_system_user_status(p_user_id uuid, p_status text, p_reason text, p_expected_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_previous text; v_reason text := NULLIF(btrim(p_reason), ''); v_target_is_owner boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(10083, 0);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF NOT public.has_system_permission(auth.uid(), 'system.users.manage') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SYSTEM_USERS_MANAGE_REQUIRED';
  END IF;
  IF p_status NOT IN ('active','disabled') THEN RAISE EXCEPTION 'INVALID_ACCOUNT_STATUS'; END IF;
  IF p_status = 'disabled' AND (v_reason IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500) THEN
    RAISE EXCEPTION 'DISABLE_REASON_REQUIRED';
  END IF;
  SELECT account_status INTO v_previous FROM public.profiles WHERE auth_user_id = p_user_id FOR UPDATE;
  IF v_previous IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  v_target_is_owner := EXISTS (
    SELECT 1 FROM public.user_role_assignments assignment
    JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'system' AND role.is_protected
    WHERE assignment.user_id = p_user_id AND assignment.scope_type = 'system' AND assignment.status = 'active'
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
  );
  IF v_target_is_owner AND v_previous IS DISTINCT FROM p_status AND NOT private.rbac_caller_owns_domain('system') THEN
    RAISE EXCEPTION 'OWNER_ROLE_REQUIRED';
  END IF;
  IF p_status = 'disabled' AND p_user_id IN (SELECT private.active_system_owner_ids())
     AND NOT EXISTS (SELECT 1 FROM private.active_system_owner_ids() owner_id WHERE owner_id <> p_user_id) THEN
    RAISE EXCEPTION 'LAST_SYSTEM_OWNER';
  END IF;
  UPDATE public.profiles SET account_status = p_status,
    disabled_at = CASE WHEN p_status = 'disabled' THEN timezone('utc'::text, now()) ELSE NULL END,
    disabled_by = CASE WHEN p_status = 'disabled' THEN auth.uid() ELSE NULL END,
    disabled_reason = CASE WHEN p_status = 'disabled' THEN v_reason ELSE NULL END
  WHERE auth_user_id = p_user_id;
  IF v_previous IS DISTINCT FROM p_status THEN
    INSERT INTO public.user_status_events(target_user_id, actor_user_id, previous_status, new_status, reason)
    VALUES (p_user_id, auth.uid(), v_previous, p_status, v_reason);
  END IF;
  RETURN jsonb_build_object('id', p_user_id, 'account_status', p_status,
    'disabled_at', CASE WHEN p_status = 'disabled' THEN timezone('utc'::text, now()) ELSE NULL END);
END;
$function$;

-- 1000163's body; "an owner exists" now means an active one.
CREATE OR REPLACE FUNCTION public.bootstrap_system_owner(p_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role_id uuid; v_assignment_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='SERVICE_ROLE_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM private.active_system_owner_ids()) THEN RAISE EXCEPTION 'SYSTEM_OWNER_ALREADY_EXISTS'; END IF;
  UPDATE public.profiles SET account_status='active', approved_at=timezone('utc'::text, now())
  WHERE auth_user_id=p_user_id AND account_status='pending';
  SELECT id INTO v_role_id FROM public.roles WHERE domain='system' AND code='system_owner';
  INSERT INTO public.user_role_assignments(user_id,role_id,scope_type,scope_id,effective_from)
  VALUES (p_user_id,v_role_id,'system',NULL,CURRENT_DATE) RETURNING id INTO v_assignment_id;
  RETURN v_assignment_id;
END;
$$;

-- Linking an account to a teacher gives the account the role of each class
-- job the teacher holds (sync_teacher_account_role_grants and
-- sync_profile_teacher_role_grants). The caller must be able to assign each
-- of those roles in its class. Writes without a signed-in caller are not checked.
CREATE OR REPLACE FUNCTION private.assert_caller_can_hand_class_roles(p_teacher_ids uuid[])
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_job record;
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN RETURN; END IF;
  FOR v_job IN
    SELECT DISTINCT assignment.role_id, assignment.class_session_id
    FROM public.class_session_teachers assignment
    WHERE assignment.teacher_id = ANY(p_teacher_ids) AND assignment.role_id IS NOT NULL
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
  LOOP
    IF NOT private.rbac_caller_assigns('teaching', 'class_session', v_job.class_session_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
    END IF;
    PERFORM private.rbac_assert_can_grant_role(v_job.role_id, 'class_session', v_job.class_session_id);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_caller_can_hand_class_roles(uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.guard_teacher_account_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'teacher_records' THEN
    IF NEW.profile_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles WHERE id = NEW.profile_id AND auth_user_id IS NOT NULL
    ) THEN
      PERFORM private.assert_caller_can_hand_class_roles(ARRAY[NEW.id]);
    END IF;
  ELSIF NEW.auth_user_id IS NOT NULL THEN
    PERFORM private.assert_caller_can_hand_class_roles(
      ARRAY(SELECT id FROM public.teacher_records WHERE profile_id = NEW.id));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_teacher_account_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_teacher_account_link ON public.teacher_records;
CREATE TRIGGER guard_teacher_account_link BEFORE UPDATE OF profile_id ON public.teacher_records
FOR EACH ROW WHEN (OLD.profile_id IS DISTINCT FROM NEW.profile_id)
EXECUTE FUNCTION private.guard_teacher_account_link();
DROP TRIGGER IF EXISTS guard_profile_account_link ON public.profiles;
CREATE TRIGGER guard_profile_account_link BEFORE UPDATE OF auth_user_id ON public.profiles
FOR EACH ROW WHEN (OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id)
EXECUTE FUNCTION private.guard_teacher_account_link();

-- 1000162's body with the enrollment filter.
CREATE OR REPLACE FUNCTION public.get_student_profile_page(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_student_id IS NULL OR NOT public.can_access_student(p_student_id, 'teaching.students.read') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'STUDENT_ACCESS_DENIED';
  END IF;

  SELECT jsonb_build_object(
    'id', student.id,
    'name', student.name,
    'notes', student.notes,
    'notes_document', student.notes_document,
    'external_link', student.external_link,
    'created_at', student.created_at,
    'updated_at', student.updated_at,
    'current_school', private.student_current_school_summary(student.id, capability.schools_read),
    'enrollments', COALESCE(enrollments.items, '[]'::jsonb),
    'capabilities', jsonb_build_object(
      'schools', jsonb_build_object('read', capability.schools_read, 'update', capability.schools_update),
      'personal', jsonb_build_object('read', capability.personal_read, 'update', capability.personal_update),
      'contacts', jsonb_build_object('read', capability.contacts_read, 'update', capability.contacts_update),
      'credentials', jsonb_build_object('read', capability.credentials_read, 'update', capability.credentials_update)
    )
  ) INTO v_profile
  FROM public.students student
  CROSS JOIN LATERAL (
    SELECT
      public.can_access_sensitive_student(student.id, 'teaching.student_schools.read') AS schools_read,
      public.can_access_sensitive_student(student.id, 'teaching.student_schools.update') AS schools_update,
      public.can_access_sensitive_student(student.id, 'teaching.student_personal.read') AS personal_read,
      public.can_access_sensitive_student(student.id, 'teaching.student_personal.update') AS personal_update,
      public.can_access_sensitive_student(student.id, 'teaching.student_contacts.read') AS contacts_read,
      public.can_access_sensitive_student(student.id, 'teaching.student_contacts.update') AS contacts_update,
      public.can_access_sensitive_student(student.id, 'teaching.student_credentials.read') AS credentials_read,
      public.can_access_sensitive_student(student.id, 'teaching.student_credentials.update') AS credentials_update
  ) capability
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', enrollment.id,
      'student_id', enrollment.student_id,
      'course_id', enrollment.course_id,
      'classroom_id', enrollment.classroom_id,
      'class_session_id', enrollment.class_session_id,
      'status', enrollment.status,
      'start_date', enrollment.start_date,
      'lesson_number', enrollment.lesson_number,
      'external_link', enrollment.external_link,
      'time_zone', enrollment.time_zone,
      'koding_admission_id', enrollment.koding_admission_id,
      'created_at', enrollment.created_at,
      'updated_at', enrollment.updated_at,
      'courses', CASE WHEN course.id IS NULL THEN NULL ELSE jsonb_build_object('subject', course.subject, 'stage', course.stage, 'display_name', course.display_name) END,
      'classrooms', CASE WHEN classroom.id IS NULL THEN NULL ELSE jsonb_build_object('name', classroom.name) END,
      'class_sessions', CASE WHEN session.id IS NULL THEN NULL ELSE jsonb_build_object(
        'name', session.name,
        'day_of_week', session.day_of_week,
        'start_time', session.start_time,
        'end_time', session.end_time,
        'time_zone', session.time_zone,
        'session_type', session.session_type,
        'schedule_mode', session.schedule_mode,
        'class_session_schedule_rules', COALESCE(schedule_rules.items, '[]'::jsonb)
      ) END
    ) ORDER BY enrollment.created_at, enrollment.id) AS items
    FROM public.enrollments enrollment
    LEFT JOIN public.courses course ON course.id = enrollment.course_id
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'id', rule.id,
        'schedule_kind', rule.schedule_kind,
        'day_of_week', rule.day_of_week,
        'day_of_month', rule.day_of_month,
        'occurrence_date', rule.occurrence_date,
        'start_time', rule.start_time,
        'end_time', rule.end_time
      ) ORDER BY rule.occurrence_date NULLS LAST, rule.day_of_week NULLS LAST, rule.day_of_month NULLS LAST, rule.id) AS items
      FROM public.class_session_schedule_rules rule
      WHERE rule.class_session_id = session.id
    ) schedule_rules ON TRUE
    WHERE enrollment.student_id = student.id
      -- Only enrollments in a classroom or class where the caller may read students.
      AND public.has_api_permission((SELECT auth.uid()), 'teaching.students.read', enrollment.classroom_id, enrollment.class_session_id)
  ) enrollments ON TRUE
  WHERE student.id = p_student_id;

  RETURN v_profile;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
