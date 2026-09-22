-- Forward-only authorization preflight for transfer cancellation.
-- The mutating cancellation RPC remains the final authority; this helper
-- prevents an idempotency replay from being reserved before authorization.

DO $$
BEGIN
  IF to_regclass('public.single_lesson_transfers') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.class_occurrences') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000052 prerequisites missing; apply migrations through 1000051 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_single_lesson_transfer(
  p_transfer_id uuid,
  p_permission_key text DEFAULT 'teaching.enrollments.update'
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN true
    WHEN auth.uid() IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.single_lesson_transfers transfer
      JOIN public.enrollments enrollment ON enrollment.id = transfer.enrollment_id
      JOIN public.class_occurrences source_occurrence ON source_occurrence.id = transfer.source_occurrence_id
      JOIN public.class_occurrences target_occurrence ON target_occurrence.id = transfer.target_occurrence_id
      WHERE transfer.id = p_transfer_id
        AND transfer.cancelled_at IS NULL
        AND (
          enrollment.user_id = auth.uid()
          OR (
            public.has_api_permission(auth.uid(), p_permission_key, NULL, source_occurrence.class_session_id)
            AND public.has_api_permission(auth.uid(), p_permission_key, NULL, target_occurrence.class_session_id)
          )
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.can_access_single_lesson_transfer(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_single_lesson_transfer(uuid, text) TO authenticated, service_role;
