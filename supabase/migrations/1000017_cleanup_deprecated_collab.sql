-- Migration: Cleanup deprecated collaboration tables, functions, and columns
-- Date: 2026-05-21

BEGIN;

-- 1. Drop deprecated tables
DROP TABLE IF EXISTS public.report_locks CASCADE;
DROP TABLE IF EXISTS public.active_report_editors CASCADE;
DROP TABLE IF EXISTS public.report_sync_metadata CASCADE;
DROP TABLE IF EXISTS public.report_collab_ops CASCADE;
DROP TABLE IF EXISTS public.report_collab_awareness CASCADE;

-- 2. Drop deprecated functions
DROP FUNCTION IF EXISTS public.cleanup_expired_report_locks();
DROP FUNCTION IF EXISTS public.cleanup_inactive_report_editors();
DROP FUNCTION IF EXISTS public.acquire_report_lock(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.release_report_lock(uuid, uuid);
DROP FUNCTION IF EXISTS public.update_editor_heartbeat(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_active_editors(uuid);
DROP FUNCTION IF EXISTS public.record_report_sync(uuid, uuid, bigint, boolean, text, uuid[]);
DROP FUNCTION IF EXISTS public.report_collab_awareness_cleanup(integer);

-- 3. Drop deprecated columns on occurrence_reports
ALTER TABLE public.occurrence_reports
  DROP COLUMN IF EXISTS collaborative_metadata,
  DROP COLUMN IF EXISTS is_collaborative_enabled,
  DROP COLUMN IF EXISTS realtime_sync_status;

COMMIT;
