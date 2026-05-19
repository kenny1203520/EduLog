-- ==========================================
-- Report Realtime Collaboration Schema
-- ==========================================
-- Enables concurrent editing with locks, presence tracking, and sync metadata
-- Date: 2026-05-19
-- Dependencies: 1000001_core_schema.sql, 1000002_academics.sql, 1000003_operations.sql

-- 1. Report Locks Table
-- Tracks exclusive editing rights with automatic timeout
CREATE TABLE IF NOT EXISTS public.report_locks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    occurrence_report_id uuid NOT NULL,
    locked_by uuid NOT NULL,
    acquired_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT report_locks_pkey PRIMARY KEY (id),
    CONSTRAINT report_locks_occurrence_report_id_fkey FOREIGN KEY (occurrence_report_id) REFERENCES public.occurrence_reports(id) ON DELETE CASCADE,
    CONSTRAINT report_locks_locked_by_fkey FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT report_locks_unique_active_lock UNIQUE (occurrence_report_id) WHERE expires_at > timezone('utc'::text, now())
);

-- RLS for report_locks
ALTER TABLE public.report_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.report_locks FOR ALL USING (
    (select auth.role()) = 'authenticated'
) WITH CHECK (
    (select auth.role()) = 'authenticated'
);

-- Trigger for locks updated_at
CREATE TRIGGER update_report_locks_updated_at BEFORE UPDATE ON public.report_locks FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- 2. Active Report Editors Table
-- Real-time presence tracking with heartbeat
CREATE TABLE IF NOT EXISTS public.active_report_editors (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    occurrence_report_id uuid NOT NULL,
    editor_id uuid NOT NULL,
    last_heartbeat timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    heartbeat_expires_at timestamp with time zone NOT NULL,
    editing_start_time timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT active_report_editors_pkey PRIMARY KEY (id),
    CONSTRAINT active_report_editors_occurrence_report_id_fkey FOREIGN KEY (occurrence_report_id) REFERENCES public.occurrence_reports(id) ON DELETE CASCADE,
    CONSTRAINT active_report_editors_editor_id_fkey FOREIGN KEY (editor_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT active_report_editors_unique_active UNIQUE (occurrence_report_id, editor_id)
);

-- RLS for active_report_editors
ALTER TABLE public.active_report_editors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.active_report_editors FOR ALL USING (
    (select auth.role()) = 'authenticated'
) WITH CHECK (
    (select auth.role()) = 'authenticated'
);

-- Trigger for active_report_editors updated_at
CREATE TRIGGER update_active_report_editors_updated_at BEFORE UPDATE ON public.active_report_editors FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- 3. Sync Metadata Table
-- Tracks last successful sync, conflicts, and sync history
CREATE TABLE IF NOT EXISTS public.report_sync_metadata (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    occurrence_report_id uuid NOT NULL,
    last_synced_at timestamp with time zone,
    last_synced_by uuid,
    last_synced_version bigint DEFAULT 1,
    conflict_detected boolean DEFAULT false,
    conflict_resolution_strategy text, -- 'last-write-wins' | 'manual' | 'merge'
    conflicting_editors uuid[],
    sync_notes text,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT report_sync_metadata_pkey PRIMARY KEY (id),
    CONSTRAINT report_sync_metadata_occurrence_report_id_fkey FOREIGN KEY (occurrence_report_id) REFERENCES public.occurrence_reports(id) ON DELETE CASCADE,
    CONSTRAINT report_sync_metadata_last_synced_by_fkey FOREIGN KEY (last_synced_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT report_sync_metadata_unique_report UNIQUE (occurrence_report_id)
);

-- RLS for report_sync_metadata
ALTER TABLE public.report_sync_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.report_sync_metadata FOR ALL USING (
    (select auth.role()) = 'authenticated'
) WITH CHECK (
    (select auth.role()) = 'authenticated'
);

-- Trigger for sync_metadata updated_at
CREATE TRIGGER update_report_sync_metadata_updated_at BEFORE UPDATE ON public.report_sync_metadata FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- 4. Function to clean expired locks
CREATE OR REPLACE FUNCTION public.cleanup_expired_report_locks() RETURNS void
SET search_path = public AS $$
BEGIN
    DELETE FROM public.report_locks WHERE expires_at < timezone('utc'::text, now());
END;
$$ LANGUAGE plpgsql;

-- 5. Function to clean expired active editors
CREATE OR REPLACE FUNCTION public.cleanup_inactive_report_editors() RETURNS void
SET search_path = public AS $$
BEGIN
    DELETE FROM public.active_report_editors WHERE heartbeat_expires_at < timezone('utc'::text, now());
END;
$$ LANGUAGE plpgsql;

-- 6. Function to acquire report lock
CREATE OR REPLACE FUNCTION public.acquire_report_lock(
    p_report_id uuid,
    p_user_id uuid,
    p_duration_minutes integer DEFAULT 10
) RETURNS SETOF public.report_locks
SET search_path = public AS $$
BEGIN
    -- Clean up expired locks first
    PERFORM public.cleanup_expired_report_locks();
    
    -- Try to insert a new lock
    RETURN QUERY INSERT INTO public.report_locks (
        occurrence_report_id,
        locked_by,
        expires_at
    ) VALUES (
        p_report_id,
        p_user_id,
        timezone('utc'::text, now()) + make_interval(mins => p_duration_minutes)
    ) ON CONFLICT DO NOTHING
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- 7. Function to release report lock
CREATE OR REPLACE FUNCTION public.release_report_lock(
    p_report_id uuid,
    p_user_id uuid
) RETURNS void
SET search_path = public AS $$
BEGIN
    DELETE FROM public.report_locks
    WHERE occurrence_report_id = p_report_id
    AND locked_by = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 8. Function to update editor heartbeat
CREATE OR REPLACE FUNCTION public.update_editor_heartbeat(
    p_report_id uuid,
    p_user_id uuid
) RETURNS SETOF public.active_report_editors
SET search_path = public AS $$
BEGIN
    -- Clean up inactive editors first
    PERFORM public.cleanup_inactive_report_editors();
    
    -- Update heartbeat or insert new record
    RETURN QUERY INSERT INTO public.active_report_editors (
        occurrence_report_id,
        editor_id,
        heartbeat_expires_at
    ) VALUES (
        p_report_id,
        p_user_id,
        timezone('utc'::text, now()) + INTERVAL '30 seconds'
    ) ON CONFLICT (occurrence_report_id, editor_id) DO UPDATE SET
        last_heartbeat = timezone('utc'::text, now()),
        heartbeat_expires_at = timezone('utc'::text, now()) + INTERVAL '30 seconds',
        updated_at = timezone('utc'::text, now())
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- 9. Function to get active editors for a report
CREATE OR REPLACE FUNCTION public.get_active_editors(p_report_id uuid)
RETURNS TABLE(
    editor_id uuid,
    editing_start_time timestamp with time zone,
    last_heartbeat timestamp with time zone
)
SET search_path = public AS $$
BEGIN
    PERFORM public.cleanup_inactive_report_editors();
    
    RETURN QUERY SELECT
        eare.editor_id,
        eare.editing_start_time,
        eare.last_heartbeat
    FROM public.active_report_editors eare
    WHERE eare.occurrence_report_id = p_report_id;
END;
$$ LANGUAGE plpgsql;

-- 10. Function to record sync metadata
CREATE OR REPLACE FUNCTION public.record_report_sync(
    p_report_id uuid,
    p_synced_by uuid,
    p_version bigint,
    p_conflict_detected boolean DEFAULT false,
    p_strategy text DEFAULT 'last-write-wins',
    p_conflicting_editors uuid[] DEFAULT NULL
) RETURNS SETOF public.report_sync_metadata
SET search_path = public AS $$
BEGIN
    RETURN QUERY INSERT INTO public.report_sync_metadata (
        occurrence_report_id,
        last_synced_at,
        last_synced_by,
        last_synced_version,
        conflict_detected,
        conflict_resolution_strategy,
        conflicting_editors
    ) VALUES (
        p_report_id,
        timezone('utc'::text, now()),
        p_synced_by,
        p_version,
        p_conflict_detected,
        p_strategy,
        p_conflicting_editors
    ) ON CONFLICT (occurrence_report_id) DO UPDATE SET
        last_synced_at = timezone('utc'::text, now()),
        last_synced_by = p_synced_by,
        last_synced_version = p_version,
        conflict_detected = p_conflict_detected,
        conflict_resolution_strategy = p_strategy,
        conflicting_editors = p_conflicting_editors,
        updated_at = timezone('utc'::text, now())
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- 11. Add realtime synchronization fields to occurrence_reports if needed
ALTER TABLE public.occurrence_reports
ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES auth.users(id);

ALTER TABLE public.occurrence_reports
ADD COLUMN IF NOT EXISTS collaborative_metadata JSONB DEFAULT '{}'::jsonb;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_report_locks_occurrence_report_id ON public.report_locks(occurrence_report_id);
CREATE INDEX IF NOT EXISTS idx_report_locks_expires_at ON public.report_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_active_report_editors_occurrence_report_id ON public.active_report_editors(occurrence_report_id);
CREATE INDEX IF NOT EXISTS idx_active_report_editors_heartbeat_expires_at ON public.active_report_editors(heartbeat_expires_at);
CREATE INDEX IF NOT EXISTS idx_report_sync_metadata_occurrence_report_id ON public.report_sync_metadata(occurrence_report_id);
