-- 1000015_awareness_cleanup.sql
-- Adds a helper function to cleanup stale awareness rows from report_collab_awareness
-- Usage: SELECT report_collab_awareness_cleanup(30); -- deletes entries older than 30 seconds

CREATE OR REPLACE FUNCTION public.report_collab_awareness_cleanup(threshold_seconds integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    cutoff timestamptz := now() - (threshold_seconds || ' seconds')::interval;
    deleted_count integer := 0;
BEGIN
    DELETE FROM public.report_collab_awareness WHERE last_heartbeat < cutoff RETURNING 1 INTO deleted_count;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.report_collab_awareness_cleanup(integer) IS 'Delete awareness rows older than threshold seconds; returns number of deleted rows.';

-- Note: Schedule this function with your platform's job scheduler (pg_cron or external) to run periodically.
-- Example (pg_cron):
-- SELECT cron.schedule('cleanup_awareness_every_minute', '*/1 * * * *', $$SELECT public.report_collab_awareness_cleanup(30);$$);
