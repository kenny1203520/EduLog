-- Add start_date and end_date to class_sessions
ALTER TABLE public.class_sessions
ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS end_date date;
