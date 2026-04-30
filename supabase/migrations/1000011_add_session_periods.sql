-- Add start_date and end_date to class_sessions
ALTER TABLE public.class_sessions
ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS end_date date;

-- Add effective_to to class_session_teachers
ALTER TABLE public.class_session_teachers
ADD COLUMN IF NOT EXISTS effective_to date;

-- Note: We do not add NOT NULL to end_date or effective_to since they are optional.
