-- AI generations are recorded when they start, not only when they end.
--
-- A teacher whose connection drops must still find the result: the API keeps
-- generating, and the panel shows the `running` row until it finishes.
-- Running rows never charge quota (ai_generations_charge_only_on_success
-- still requires status = 'succeeded'). Rows left running by an API restart
-- are closed as failed (INTERRUPTED) by the API.

BEGIN;

ALTER TABLE public.ai_generations DROP CONSTRAINT IF EXISTS ai_generations_status_check;
ALTER TABLE public.ai_generations
  ADD CONSTRAINT ai_generations_status_check CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled'));

ALTER TABLE public.ai_generations ADD COLUMN IF NOT EXISTS completed_at timestamptz;
UPDATE public.ai_generations SET completed_at = created_at WHERE completed_at IS NULL AND status <> 'running';

-- completed_at follows the status: set when a generation finishes, cleared while running.
CREATE OR REPLACE FUNCTION public.set_ai_generation_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'running' THEN
    NEW.completed_at := NULL;
  ELSIF NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ai_generation_completed_at ON public.ai_generations;
CREATE TRIGGER set_ai_generation_completed_at BEFORE INSERT OR UPDATE OF status, completed_at ON public.ai_generations
  FOR EACH ROW EXECUTE FUNCTION public.set_ai_generation_completed_at();

CREATE INDEX IF NOT EXISTS ai_generations_running_idx
  ON public.ai_generations (created_at) WHERE status = 'running';

COMMENT ON COLUMN public.ai_generations.completed_at IS 'When the generation succeeded, failed or was cancelled; NULL while running.';

NOTIFY pgrst, 'reload schema';
COMMIT;
