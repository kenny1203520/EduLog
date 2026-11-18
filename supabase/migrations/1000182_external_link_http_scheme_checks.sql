-- External links are rendered as clickable anchors. Only absolute http(s)
-- URLs may be stored, so a `javascript:` or `data:` value can never reach an
-- href. Matches occurrence_reports_external_link_security_check (1000037).
--
-- Existing values that are not http(s) URLs are cleared first so each check
-- can be validated, not just enforced for new writes. Only external_link is
-- updated, so the tables' updated_at triggers are the only ones that react.

DO $$
DECLARE
    target text;
    cleared bigint;
BEGIN
    FOREACH target IN ARRAY ARRAY['students', 'classrooms', 'class_sessions', 'enrollments', 'enrollment_history_reports']
    LOOP
        EXECUTE format(
            'UPDATE public.%I SET external_link = NULL
              WHERE external_link IS NOT NULL AND external_link <> ''''
                AND NOT (length(external_link) <= 4096 AND external_link ~* ''^https?://[^[:space:]]+$'')',
            target);
        GET DIAGNOSTICS cleared = ROW_COUNT;
        IF cleared > 0 THEN
            RAISE NOTICE 'Cleared % non-http(s) external_link value(s) in public.%', cleared, target;
        END IF;

        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', target, target || '_external_link_http_check');
        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
                external_link IS NULL OR external_link = ''''
                OR (length(external_link) <= 4096 AND external_link ~* ''^https?://[^[:space:]]+$'')
            )',
            target, target || '_external_link_http_check');
    END LOOP;
END;
$$;
