-- Student PII is shared global data. Platform-sensitive grants do not require
-- an enrollment; local grants still need an actual student enrollment path.
-- Reuse the current student resolver so scoped roles, inheritance and denies
-- follow the same rules without restoring legacy user_id ownership grants.
BEGIN;

CREATE OR REPLACE FUNCTION public.can_access_sensitive_student(
  p_student_id uuid,
  p_permission_key text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(p_permission_key IN (
    'teaching.students.read_sensitive',
    'teaching.students.update_sensitive'
  ), false)
    AND public.can_access_student(p_student_id, p_permission_key);
$$;

REVOKE ALL ON FUNCTION public.can_access_sensitive_student(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_sensitive_student(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_access_sensitive_student(uuid, text)
  IS 'Checks explicit student sensitive permissions through platform grants or authorized enrollment paths; legacy ownership is not an access grant.';

COMMIT;
