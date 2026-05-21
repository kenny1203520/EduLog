-- Migration: Add origin_session_id to collab tables and update RLS policies
BEGIN;

ALTER TABLE public.report_collab_ops
  ADD COLUMN IF NOT EXISTS origin_session_id text;

ALTER TABLE public.report_collab_awareness
  ADD COLUMN IF NOT EXISTS origin_session_id text;

-- Unique index so each session has one awareness row per report
CREATE UNIQUE INDEX IF NOT EXISTS idx_awareness_report_session ON public.report_collab_awareness(occurrence_report_id, origin_session_id);

-- Enable RLS if not already
ALTER TABLE public.report_collab_awareness ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_collab_ops ENABLE ROW LEVEL SECURITY;

-- Example policies: allow authenticated users to insert/select their own rows
-- Note: adjust these policies to match your auth schema and security needs.

-- Awareness: allow anyone to SELECT (clients showing presence)
DROP POLICY IF EXISTS allow_select_awareness ON public.report_collab_awareness;
CREATE POLICY allow_select_awareness ON public.report_collab_awareness FOR SELECT USING (true);

-- Awareness: allow authenticated user to INSERT/UPDATE/DELETE their own awareness rows
DROP POLICY IF EXISTS allow_manage_own_awareness ON public.report_collab_awareness;
CREATE POLICY allow_manage_own_awareness ON public.report_collab_awareness
  FOR ALL
  USING (origin_user_id = auth.uid())
  WITH CHECK (origin_user_id = auth.uid());

-- Ops: allow SELECT for report consumers
DROP POLICY IF EXISTS allow_select_ops ON public.report_collab_ops;
CREATE POLICY allow_select_ops ON public.report_collab_ops FOR SELECT USING (occurrence_report_id IS NOT NULL);

-- Ops: allow authenticated users to INSERT ops with their user id
DROP POLICY IF EXISTS allow_insert_ops ON public.report_collab_ops;
CREATE POLICY allow_insert_ops ON public.report_collab_ops
  FOR INSERT
  WITH CHECK (origin_user_id = auth.uid());

COMMIT;

-- Note for deployers:
-- 1) Run this migration with a DB role that can ALTER tables (e.g., the Supabase SQL editor or migration runner).
-- 2) Ensure client inserts include both origin_user_id (auth.uid()) and origin_session_id (per-tab token).
-- 3) Adjust policies if you need broader/stricter access (e.g., allow certain service roles to read/write).
