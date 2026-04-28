-- Add teacher columns to class_occurrences
ALTER TABLE public.class_occurrences
ADD COLUMN IF NOT EXISTS teacher_ids uuid[] DEFAULT ARRAY[]::uuid[];

ALTER TABLE public.class_occurrences
ADD COLUMN IF NOT EXISTS teacher_attendance jsonb DEFAULT '{}'::jsonb;

-- Optional: ensure proper permissions/rls will apply from existing table policies
