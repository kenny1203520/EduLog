-- ==========================================
-- Report Realtime Collaboration Schema
-- ==========================================
-- Enables concurrent editing with locks, presence tracking, and sync metadata
-- With enhanced security, input validation, and RLS policies
-- Date: 2026-05-19
-- Dependencies: 1000001_core_schema.sql, 1000002_academics.sql, 1000003_operations.sql

-- ==========================================
-- 1. Report Locks Table
-- ==========================================
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
    CONSTRAINT report_locks_expires_must_be_future CHECK (expires_at > acquired_at)
);

-- RLS for report_locks
ALTER TABLE public.report_locks ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view locks on reports they have access to
DROP POLICY IF EXISTS "Users can view locks on accessible reports" ON public.report_locks;
CREATE POLICY "Users can view locks on accessible reports" ON public.report_locks FOR SELECT 
USING (
    locked_by = (SELECT auth.uid()) OR
    occurrence_report_id IN (
        SELECT orpt.id FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE t.user_id = (SELECT auth.uid())
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    )
);

-- Policy: Users can only create/modify locks for their own user_id
DROP POLICY IF EXISTS "Users can create locks only for themselves" ON public.report_locks;
CREATE POLICY "Users can create locks only for themselves" ON public.report_locks FOR INSERT 
WITH CHECK (locked_by = (SELECT auth.uid()));

-- Policy: Users can only delete their own locks
DROP POLICY IF EXISTS "Users can delete only their own locks" ON public.report_locks;
CREATE POLICY "Users can delete only their own locks" ON public.report_locks FOR DELETE 
USING (locked_by = (SELECT auth.uid()));

-- Trigger for locks updated_at
DROP TRIGGER IF EXISTS update_report_locks_updated_at ON public.report_locks;
CREATE TRIGGER update_report_locks_updated_at BEFORE UPDATE ON public.report_locks FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- Index for efficient lookups
-- Note: UNIQUE index on occurrence_report_id ensures at most one lock per report
-- Cleanup is handled by cleanup_expired_report_locks() called before new lock acquisition
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_locks_unique_active_lock ON public.report_locks(occurrence_report_id);
CREATE INDEX IF NOT EXISTS idx_report_locks_expires_at ON public.report_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_report_locks_locked_by ON public.report_locks(locked_by);

-- ==========================================
-- 2. Active Report Editors Table
-- ==========================================
-- Real-time presence tracking with heartbeat
CREATE TABLE IF NOT EXISTS public.active_report_editors (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    occurrence_report_id uuid NOT NULL,
    editor_id uuid NOT NULL,
    last_heartbeat timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    heartbeat_expires_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()) + INTERVAL '30 seconds',
    editing_start_time timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT active_report_editors_pkey PRIMARY KEY (id),
    CONSTRAINT active_report_editors_occurrence_report_id_fkey FOREIGN KEY (occurrence_report_id) REFERENCES public.occurrence_reports(id) ON DELETE CASCADE,
    CONSTRAINT active_report_editors_editor_id_fkey FOREIGN KEY (editor_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT active_report_editors_unique_active UNIQUE (occurrence_report_id, editor_id),
    CONSTRAINT active_report_editors_heartbeat_must_be_future CHECK (heartbeat_expires_at > last_heartbeat)
);

-- RLS for active_report_editors
ALTER TABLE public.active_report_editors ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view active editors for reports they have access to
DROP POLICY IF EXISTS "Users can view active editors for accessible reports" ON public.active_report_editors;
CREATE POLICY "Users can view active editors for accessible reports" ON public.active_report_editors FOR SELECT 
USING (
    editor_id = (SELECT auth.uid()) OR
    occurrence_report_id IN (
        SELECT orpt.id FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE t.user_id = (SELECT auth.uid())
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    )
);

-- Policy: Users can only create/update their own heartbeat
DROP POLICY IF EXISTS "Users can create editor records only for themselves" ON public.active_report_editors;
CREATE POLICY "Users can create editor records only for themselves" ON public.active_report_editors FOR INSERT 
WITH CHECK (editor_id = (SELECT auth.uid()));

-- Policy: Users can only update their own heartbeat records
DROP POLICY IF EXISTS "Users can update only their own heartbeat records" ON public.active_report_editors;
CREATE POLICY "Users can update only their own heartbeat records" ON public.active_report_editors FOR UPDATE 
USING (editor_id = (SELECT auth.uid()))
WITH CHECK (editor_id = (SELECT auth.uid()));

-- Policy: Users can only delete their own records
DROP POLICY IF EXISTS "Users can delete only their own editor records" ON public.active_report_editors;
CREATE POLICY "Users can delete only their own editor records" ON public.active_report_editors FOR DELETE 
USING (editor_id = (SELECT auth.uid()));

-- Trigger for active_report_editors updated_at
DROP TRIGGER IF EXISTS update_active_report_editors_updated_at ON public.active_report_editors;
CREATE TRIGGER update_active_report_editors_updated_at BEFORE UPDATE ON public.active_report_editors FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_active_report_editors_occurrence_report_id ON public.active_report_editors(occurrence_report_id);
CREATE INDEX IF NOT EXISTS idx_active_report_editors_editor_id ON public.active_report_editors(editor_id);
CREATE INDEX IF NOT EXISTS idx_active_report_editors_heartbeat_expires_at ON public.active_report_editors(heartbeat_expires_at);

-- ==========================================
-- 3. Sync Metadata Table
-- ==========================================
-- Tracks last successful sync, conflicts, and sync history
CREATE TABLE IF NOT EXISTS public.report_sync_metadata (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    occurrence_report_id uuid NOT NULL,
    last_synced_at timestamp with time zone,
    last_synced_by uuid,
    last_synced_version bigint DEFAULT 1,
    conflict_detected boolean DEFAULT false,
    conflict_resolution_strategy text DEFAULT 'last-write-wins',
    conflicting_editors uuid[],
    sync_notes text,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT report_sync_metadata_pkey PRIMARY KEY (id),
    CONSTRAINT report_sync_metadata_occurrence_report_id_fkey FOREIGN KEY (occurrence_report_id) REFERENCES public.occurrence_reports(id) ON DELETE CASCADE,
    CONSTRAINT report_sync_metadata_last_synced_by_fkey FOREIGN KEY (last_synced_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT report_sync_metadata_unique_report UNIQUE (occurrence_report_id),
    CONSTRAINT check_conflict_resolution_strategy CHECK (conflict_resolution_strategy IN ('last-write-wins', 'manual', 'merge')),
    CONSTRAINT check_sync_notes_length CHECK (length(sync_notes) <= 5000),
    CONSTRAINT check_conflicting_editors_array CHECK (conflicting_editors IS NULL OR array_length(conflicting_editors, 1) IS NULL OR array_length(conflicting_editors, 1) > 0)
);

-- RLS for report_sync_metadata
ALTER TABLE public.report_sync_metadata ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view sync metadata for reports they have access to
DROP POLICY IF EXISTS "Users can view sync metadata for accessible reports" ON public.report_sync_metadata;
CREATE POLICY "Users can view sync metadata for accessible reports" ON public.report_sync_metadata FOR SELECT 
USING (
    occurrence_report_id IN (
        SELECT orpt.id FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE t.user_id = (SELECT auth.uid())
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    )
);

-- Policy: Authenticated users can create/update sync metadata (checked in function)
DROP POLICY IF EXISTS "Allow sync metadata inserts via functions" ON public.report_sync_metadata;
CREATE POLICY "Allow sync metadata inserts via functions" ON public.report_sync_metadata FOR INSERT 
WITH CHECK (
    occurrence_report_id IN (
        SELECT orpt.id FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE t.user_id = (SELECT auth.uid())
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    )
);

DROP POLICY IF EXISTS "Allow sync metadata updates via functions" ON public.report_sync_metadata;
CREATE POLICY "Allow sync metadata updates via functions" ON public.report_sync_metadata FOR UPDATE 
USING (
    occurrence_report_id IN (
        SELECT orpt.id FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE t.user_id = (SELECT auth.uid())
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    )
)
WITH CHECK (
    occurrence_report_id IN (
        SELECT orpt.id FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE t.user_id = (SELECT auth.uid())
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    )
);

-- Trigger for sync_metadata updated_at
DROP TRIGGER IF EXISTS update_report_sync_metadata_updated_at ON public.report_sync_metadata;
CREATE TRIGGER update_report_sync_metadata_updated_at BEFORE UPDATE ON public.report_sync_metadata FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_report_sync_metadata_occurrence_report_id ON public.report_sync_metadata(occurrence_report_id);
CREATE INDEX IF NOT EXISTS idx_report_sync_metadata_last_synced_by ON public.report_sync_metadata(last_synced_by);

-- ==========================================
-- 4. Utility Functions
-- ==========================================

-- Function to clean expired locks
CREATE OR REPLACE FUNCTION public.cleanup_expired_report_locks() RETURNS void
SET search_path = public AS $$
BEGIN
    DELETE FROM public.report_locks WHERE expires_at < timezone('utc'::text, now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean expired active editors
CREATE OR REPLACE FUNCTION public.cleanup_inactive_report_editors() RETURNS void
SET search_path = public AS $$
BEGIN
    DELETE FROM public.active_report_editors WHERE heartbeat_expires_at < timezone('utc'::text, now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 5. Report Lock Management
-- ==========================================

-- Function to acquire report lock with validation
CREATE OR REPLACE FUNCTION public.acquire_report_lock(
    p_report_id uuid,
    p_user_id uuid,
    p_duration_minutes integer DEFAULT 10
) RETURNS SETOF public.report_locks
SET search_path = public AS $$
DECLARE
    v_lock record;
BEGIN
    -- Input validation
    IF p_report_id IS NULL THEN
        RAISE EXCEPTION 'Report ID cannot be null';
    END IF;
    
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID cannot be null';
    END IF;
    
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'Cannot acquire lock for other users';
    END IF;
    
    IF p_duration_minutes < 1 OR p_duration_minutes > 1440 THEN
        RAISE EXCEPTION 'Duration must be between 1 and 1440 minutes';
    END IF;
    
    -- Verify report exists
    IF NOT EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = p_report_id) THEN
        RAISE EXCEPTION 'Report not found';
    END IF;
    
    -- Authorization: check if user has access to this report
    IF NOT EXISTS (
        SELECT 1 FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE orpt.id = p_report_id
        AND t.user_id = auth.uid()
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    ) THEN
        RAISE EXCEPTION 'Access denied to report';
    END IF;
    
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Function to release report lock with validation
CREATE OR REPLACE FUNCTION public.release_report_lock(
    p_report_id uuid,
    p_user_id uuid
) RETURNS void
SET search_path = public AS $$
BEGIN
    -- Input validation
    IF p_report_id IS NULL THEN
        RAISE EXCEPTION 'Report ID cannot be null';
    END IF;
    
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID cannot be null';
    END IF;
    
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'Cannot release lock for other users';
    END IF;
    
    DELETE FROM public.report_locks
    WHERE occurrence_report_id = p_report_id
    AND locked_by = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- ==========================================
-- 6. Editor Presence Management
-- ==========================================

-- Function to update editor heartbeat with validation
CREATE OR REPLACE FUNCTION public.update_editor_heartbeat(
    p_report_id uuid,
    p_user_id uuid
) RETURNS SETOF public.active_report_editors
SET search_path = public AS $$
BEGIN
    -- Input validation
    IF p_report_id IS NULL THEN
        RAISE EXCEPTION 'Report ID cannot be null';
    END IF;
    
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID cannot be null';
    END IF;
    
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'Cannot update heartbeat for other users';
    END IF;
    
    -- Verify report exists
    IF NOT EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = p_report_id) THEN
        RAISE EXCEPTION 'Report not found';
    END IF;
    
    -- Authorization: check if user has access to this report
    IF NOT EXISTS (
        SELECT 1 FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE orpt.id = p_report_id
        AND t.user_id = auth.uid()
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    ) THEN
        RAISE EXCEPTION 'Access denied to report';
    END IF;
    
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Function to get active editors for a report (with authorization check)
CREATE OR REPLACE FUNCTION public.get_active_editors(p_report_id uuid)
RETURNS TABLE(
    editor_id uuid,
    editing_start_time timestamp with time zone,
    last_heartbeat timestamp with time zone
)
SET search_path = public AS $$
BEGIN
    -- Input validation
    IF p_report_id IS NULL THEN
        RAISE EXCEPTION 'Report ID cannot be null';
    END IF;
    
    -- Authorization: check if user has access to this report
    IF NOT EXISTS (
        SELECT 1 FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE orpt.id = p_report_id
        AND t.user_id = auth.uid()
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    ) THEN
        RAISE EXCEPTION 'Access denied to report';
    END IF;
    
    PERFORM public.cleanup_inactive_report_editors();
    
    RETURN QUERY SELECT
        eare.editor_id,
        eare.editing_start_time,
        eare.last_heartbeat
    FROM public.active_report_editors eare
    WHERE eare.occurrence_report_id = p_report_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- ==========================================
-- 7. Sync Metadata Management
-- ==========================================

-- Function to record sync metadata with validation
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
    -- Input validation
    IF p_report_id IS NULL THEN
        RAISE EXCEPTION 'Report ID cannot be null';
    END IF;
    
    IF p_synced_by IS NULL THEN
        RAISE EXCEPTION 'Synced by user ID cannot be null';
    END IF;
    
    IF p_version < 1 THEN
        RAISE EXCEPTION 'Version must be greater than or equal to 1';
    END IF;
    
    IF p_strategy NOT IN ('last-write-wins', 'manual', 'merge') THEN
        RAISE EXCEPTION 'Invalid conflict resolution strategy. Must be one of: last-write-wins, manual, merge';
    END IF;
    
    -- Verify report exists
    IF NOT EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = p_report_id) THEN
        RAISE EXCEPTION 'Report not found';
    END IF;
    
    -- Authorization: check if user has access to this report
    IF NOT EXISTS (
        SELECT 1 FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE orpt.id = p_report_id
        AND t.user_id = auth.uid()
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    ) THEN
        RAISE EXCEPTION 'Access denied to report';
    END IF;
    
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- ==========================================
-- 8. Columns on Existing Tables
-- ==========================================

-- Add realtime synchronization fields to occurrence_reports if needed
ALTER TABLE public.occurrence_reports
ADD COLUMN IF NOT EXISTS collaborative_metadata JSONB DEFAULT '{}'::jsonb;

-- Note: last_edited_by already exists in 1000003_operations.sql
-- Ensure it's properly set up as a foreign key
DO $$
BEGIN
    -- Clean up any orphaned references that would violate the occurrence_reports foreign key constraint
    UPDATE public.occurrence_reports
    SET last_edited_by = NULL
    WHERE last_edited_by IS NOT NULL
      AND last_edited_by NOT IN (SELECT id FROM auth.users);

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'occurrence_reports_last_edited_by_fkey'
        AND table_name = 'occurrence_reports'
    ) THEN
        ALTER TABLE public.occurrence_reports
        ADD CONSTRAINT occurrence_reports_last_edited_by_fkey 
        FOREIGN KEY (last_edited_by) REFERENCES auth.users(id);
    END IF;
END $$;

-- Also ensure report_versions.edited_by is properly set up as a foreign key if missing
DO $$
BEGIN
    -- Clean up any orphaned references in report_versions
    UPDATE public.report_versions
    SET edited_by = NULL
    WHERE edited_by IS NOT NULL
      AND edited_by NOT IN (SELECT id FROM auth.users);

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'report_versions_edited_by_fkey'
        AND table_name = 'report_versions'
    ) THEN
        ALTER TABLE public.report_versions
        ADD CONSTRAINT report_versions_edited_by_fkey 
        FOREIGN KEY (edited_by) REFERENCES auth.users(id);
    END IF;
END $$;

-- Add collaborative feature flags
ALTER TABLE public.occurrence_reports
ADD COLUMN IF NOT EXISTS is_collaborative_enabled boolean DEFAULT true;

ALTER TABLE public.occurrence_reports
ADD COLUMN IF NOT EXISTS realtime_sync_status text DEFAULT 'idle' CHECK (
    realtime_sync_status IN ('idle', 'syncing', 'conflict', 'offline')
);

-- Create index for realtime query performance
CREATE INDEX IF NOT EXISTS idx_occurrence_reports_is_collaborative_enabled 
ON public.occurrence_reports(is_collaborative_enabled) 
WHERE is_collaborative_enabled = true;

-- ==========================================
-- 9. Grant Function Permissions
-- ==========================================


-- Grant execute permissions to appropriate roles
GRANT EXECUTE ON FUNCTION public.acquire_report_lock(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_report_lock(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_editor_heartbeat(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_editors(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_report_sync(uuid, uuid, bigint, boolean, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_report_locks() TO postgres;
GRANT EXECUTE ON FUNCTION public.cleanup_inactive_report_editors() TO postgres;

-- Revoke execution permissions on the auto RLS event trigger function from PUBLIC, anon, and authenticated
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
