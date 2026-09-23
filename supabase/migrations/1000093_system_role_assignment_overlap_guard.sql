-- Preserve the union of overlapping historical intervals before enforcing the
-- one-effective-assignment-per-user-and-system-role rule.
DO $$
DECLARE
  v_keep_id uuid;
  v_remove_id uuid;
  v_user_id uuid;
  v_role_id uuid;
BEGIN
  LOOP
    SELECT a.id, b.id, a.user_id, a.role_id
      INTO v_keep_id, v_remove_id, v_user_id, v_role_id
    FROM public.user_role_assignments a
    JOIN public.user_role_assignments b
      ON a.id < b.id
     AND a.scope_type = 'system' AND b.scope_type = 'system'
     AND a.user_id = b.user_id AND a.role_id = b.role_id
     AND a.effective_from <= COALESCE(b.effective_to, 'infinity'::date)
     AND b.effective_from <= COALESCE(a.effective_to, 'infinity'::date)
    ORDER BY a.user_id, a.role_id, a.effective_from, b.effective_from
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

CREATE OR REPLACE FUNCTION public.prevent_system_role_assignment_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.scope_type <> 'system' THEN RETURN NEW; END IF;

  -- Serialize competing writes for this exact user-role pair. The check below
  -- then runs under the same transaction lock as the assignment mutation.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text), hashtext(NEW.role_id::text));

  IF EXISTS (
    SELECT 1
    FROM public.user_role_assignments existing
    WHERE existing.scope_type = 'system'
      AND existing.user_id = NEW.user_id
      AND existing.role_id = NEW.role_id
      AND existing.id IS DISTINCT FROM NEW.id
      AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
      AND COALESCE(existing.effective_to, 'infinity'::date) >= NEW.effective_from
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SYSTEM_ROLE_ASSIGNMENT_OVERLAP';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS system_role_assignment_no_overlap ON public.user_role_assignments;
CREATE TRIGGER system_role_assignment_no_overlap
BEFORE INSERT OR UPDATE OF user_id, role_id, scope_type, effective_from, effective_to
ON public.user_role_assignments
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_role_assignment_overlap();

REVOKE ALL ON FUNCTION public.prevent_system_role_assignment_overlap() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
