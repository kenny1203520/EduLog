-- The audit UI pages newest-first and filters by created_at date ranges.
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
  ON public.audit_events (created_at DESC);
