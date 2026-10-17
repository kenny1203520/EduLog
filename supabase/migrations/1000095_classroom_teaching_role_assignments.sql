-- Allow classroom-scoped teaching-role assignments while keeping writes behind
-- permission-checked RPCs and preventing overlapping duplicate assignments.

CREATE OR REPLACE FUNCTION public.prevent_classroom_role_assignment_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.scope_type <> 'classroom' THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(NEW.scope_id::text),
    hashtext(NEW.user_id::text || ':' || NEW.role_id::text)
  );

  IF EXISTS (
    SELECT 1
    FROM public.user_role_assignments existing
    WHERE existing.scope_type = 'classroom'
      AND existing.scope_id = NEW.scope_id
      AND existing.user_id = NEW.user_id
      AND existing.role_id = NEW.role_id
      AND existing.id IS DISTINCT FROM NEW.id
      AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
      AND COALESCE(existing.effective_to, 'infinity'::date) >= NEW.effective_from
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CLASSROOM_ROLE_ASSIGNMENT_OVERLAP';
  END IF;

  RETURN NEW;
END;
$$;

-- Fold pre-existing overlapping rows into one interval per exact user/role/room
-- tuple before enabling the forward guard. Keeping the union preserves access.
DO $$
DECLARE
  v_keep_id uuid;
  v_remove_id uuid;
BEGIN
  LOOP
    SELECT a.id, b.id INTO v_keep_id, v_remove_id
    FROM public.user_role_assignments a
    JOIN public.user_role_assignments b
      ON a.id < b.id
     AND a.scope_type = 'classroom' AND b.scope_type = 'classroom'
     AND a.scope_id = b.scope_id
     AND a.user_id = b.user_id AND a.role_id = b.role_id
     AND a.effective_from <= COALESCE(b.effective_to, 'infinity'::date)
     AND b.effective_from <= COALESCE(a.effective_to, 'infinity'::date)
    ORDER BY a.scope_id, a.user_id, a.role_id, a.effective_from, b.effective_from
    LIMIT 1;
    EXIT WHEN v_keep_id IS NULL;

    UPDATE public.user_role_assignments keep_assignment
    SET effective_from = LEAST(keep_assignment.effective_from, remove_assignment.effective_from),
        effective_to = CASE
          WHEN keep_assignment.effective_to IS NULL OR remove_assignment.effective_to IS NULL THEN NULL
          ELSE GREATEST(keep_assignment.effective_to, remove_assignment.effective_to)
        END
    FROM public.user_role_assignments remove_assignment
    WHERE keep_assignment.id = v_keep_id AND remove_assignment.id = v_remove_id;
    DELETE FROM public.user_role_assignments WHERE id = v_remove_id;
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS classroom_role_assignment_no_overlap ON public.user_role_assignments;
CREATE TRIGGER classroom_role_assignment_no_overlap
BEFORE INSERT OR UPDATE OF user_id, role_id, scope_type, scope_id, effective_from, effective_to
ON public.user_role_assignments
FOR EACH ROW EXECUTE FUNCTION public.prevent_classroom_role_assignment_overlap();

CREATE OR REPLACE FUNCTION public.rbac_upsert_classroom_assignment(
  p_assignment_id uuid,
  p_user_id uuid,
  p_role_id uuid,
  p_classroom_id uuid,
  p_effective_from date,
  p_effective_to date,
  p_expected_epoch bigint
) RETURNS public.user_role_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_assignment public.user_role_assignments;
  v_role public.roles;
  v_teaching_id uuid;
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);

  IF NOT public.has_api_permission(auth.uid(), 'teaching.roles.manage', p_classroom_id, NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  IF NOT public.has_api_permission(auth.uid(), 'system.users.list', NULL, NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'USER_DIRECTORY_ACCESS_REQUIRED';
  END IF;

  SELECT classroom.teaching_id INTO v_teaching_id
  FROM public.classrooms classroom
  WHERE classroom.id = p_classroom_id;
  IF v_teaching_id IS NULL THEN RAISE EXCEPTION 'CLASSROOM_NOT_FOUND'; END IF;

  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id;
  IF v_role.id IS NULL OR v_role.domain <> 'teaching'
     OR (NOT v_role.is_builtin AND v_role.teaching_id IS DISTINCT FROM v_teaching_id) THEN
    RAISE EXCEPTION 'RBAC_ASSIGNMENT_DOMAIN_MISMATCH';
  END IF;
  IF p_effective_to IS NOT NULL AND p_effective_to < p_effective_from THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE';
  END IF;

  IF p_assignment_id IS NULL THEN
    INSERT INTO public.user_role_assignments(
      user_id, role_id, scope_type, scope_id, effective_from, effective_to
    ) VALUES (
      p_user_id, p_role_id, 'classroom', p_classroom_id, p_effective_from, p_effective_to
    ) RETURNING * INTO v_assignment;
  ELSE
    UPDATE public.user_role_assignments
    SET user_id = p_user_id,
        role_id = p_role_id,
        effective_from = p_effective_from,
        effective_to = p_effective_to
    WHERE id = p_assignment_id
      AND scope_type = 'classroom'
      AND scope_id = p_classroom_id
    RETURNING * INTO v_assignment;
    IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  END IF;

  RETURN v_assignment;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_delete_classroom_assignment(
  p_assignment_id uuid,
  p_classroom_id uuid,
  p_expected_epoch bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_assignment public.user_role_assignments;
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);

  IF NOT public.has_api_permission(auth.uid(), 'teaching.roles.manage', p_classroom_id, NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;

  SELECT * INTO v_assignment
  FROM public.user_role_assignments assignment
  WHERE assignment.id = p_assignment_id
    AND assignment.scope_type = 'classroom'
    AND assignment.scope_id = p_classroom_id
  FOR UPDATE;
  IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;

  DELETE FROM public.user_role_assignments WHERE id = p_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_classroom_role_assignment_overlap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rbac_upsert_classroom_assignment(uuid,uuid,uuid,uuid,date,date,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rbac_delete_classroom_assignment(uuid,uuid,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rbac_upsert_classroom_assignment(uuid,uuid,uuid,uuid,date,date,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_delete_classroom_assignment(uuid,uuid,bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
