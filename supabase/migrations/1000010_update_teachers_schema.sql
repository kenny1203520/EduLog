-- ==========================================
-- Teachers schema enhancements
-- ==========================================
-- Purpose: Make user_id optional and add teacher profile fields used by the redesigned management UI.

ALTER TABLE public.teachers
ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.teachers
ADD COLUMN IF NOT EXISTS birthday date,
ADD COLUMN IF NOT EXISTS gov_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_gov_id_unique
ON public.teachers (gov_id)
WHERE gov_id IS NOT NULL;
