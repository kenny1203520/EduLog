-- Add columns to teachers table
ALTER TABLE public.teachers
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS bio text;

-- Set NOT NULL constraints
ALTER TABLE public.teachers
ALTER COLUMN name SET NOT NULL,
ALTER COLUMN email SET NOT NULL;

-- Create class_session_teachers junction table
CREATE TABLE IF NOT EXISTS public.class_session_teachers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    class_session_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT class_session_teachers_pkey PRIMARY KEY (id),
    CONSTRAINT class_session_teachers_class_session_id_fkey FOREIGN KEY (class_session_id) REFERENCES public.class_sessions(id) ON DELETE CASCADE,
    CONSTRAINT class_session_teachers_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE,
    CONSTRAINT class_session_teachers_unique_session_teacher UNIQUE (class_session_id, teacher_id, effective_from)
);

-- Enable RLS
ALTER TABLE public.class_session_teachers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Enable all access for authenticated users" ON public.class_session_teachers 
    FOR ALL USING ((select auth.role()) = 'authenticated')
    WITH CHECK ((select auth.role()) = 'authenticated');

-- Trigger
CREATE TRIGGER update_class_session_teachers_updated_at BEFORE UPDATE ON public.class_session_teachers 
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_class_session_teachers_class_session_id ON public.class_session_teachers(class_session_id);
CREATE INDEX IF NOT EXISTS idx_class_session_teachers_teacher_id ON public.class_session_teachers(teacher_id);
