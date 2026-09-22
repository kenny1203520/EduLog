-- Compatibility prerequisite for the historical 1000042 API RBAC grants.
-- 1000044 replaces this fail-closed shim with the canonical evaluator.

DO $$
BEGIN
  IF to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL THEN
    CREATE FUNCTION public.has_api_permission(
      p_user_id uuid,
      p_permission_key text,
      p_classroom_id uuid,
      p_class_session_id uuid
    )
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $function$
      SELECT false;
    $function$;
  END IF;
END;
$$;
