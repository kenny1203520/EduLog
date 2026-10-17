-- Compatibility prerequisites for the historical 1000013 grant migration.
-- These RPCs were referenced by 1000013 but never created in the repository;
-- 1000017 removes them after the legacy collaboration cleanup. Keep the
-- shims fail-closed and do not expose any data during the compatibility gap.

DO $$
BEGIN
  IF to_regprocedure('public.update_editor_heartbeat(uuid,uuid)') IS NULL THEN
    CREATE FUNCTION public.update_editor_heartbeat(p_report_id uuid, p_user_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $function$
    BEGIN
      IF COALESCE(auth.role(), '') <> 'service_role'
         AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id) THEN
        RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
      END IF;
      -- Legacy heartbeat storage was removed by 1000017. This is
      -- intentionally a no-op so old grants do not create a write surface.
      PERFORM p_report_id;
    END;
    $function$;
  END IF;

  IF to_regprocedure('public.get_active_editors(uuid)') IS NULL THEN
    CREATE FUNCTION public.get_active_editors(p_report_id uuid)
    RETURNS TABLE(user_id uuid, last_seen_at timestamptz)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $function$
      SELECT NULL::uuid, NULL::timestamptz
      WHERE false AND p_report_id IS NOT NULL;
    $function$;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_editor_heartbeat(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_editors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_editor_heartbeat(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_editors(uuid) TO authenticated, service_role;
