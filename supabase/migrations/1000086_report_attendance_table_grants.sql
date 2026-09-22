-- 1000086: grant invoker-safe attendance reads to authenticated callers.
--
-- 1000084 deliberately keeps get_effective_attendance SECURITY INVOKER so
-- RLS remains the data boundary.  Invoker functions still require ordinary
-- table privileges, which were missing from some deployed/clean schemas.
-- These grants do not bypass RLS: the existing canonical SELECT policies on
-- student_suspensions and holidays continue to decide which rows are visible.

DO $$
BEGIN
  IF to_regclass('public.student_suspensions') IS NULL
     OR to_regclass('public.holidays') IS NULL THEN
    RAISE EXCEPTION '1000086 prerequisites missing; apply migrations through 1000084 first';
  END IF;
END;
$$;

GRANT SELECT ON TABLE public.student_suspensions, public.holidays TO authenticated;

NOTIFY pgrst, 'reload schema';
