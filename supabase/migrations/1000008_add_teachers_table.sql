-- ==========================================
-- Teachers Table
-- ==========================================
-- Purpose: Public table for querying available teachers
-- Links to auth.users via user_id, allows authenticated users to view teacher list

CREATE TABLE IF NOT EXISTS public.teachers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    name text NOT NULL,
    user_id uuid UNIQUE,
    gov_id text,
    email text NOT NULL,
    phone text,
    address text,
    birthday date,
    bio text,
    CONSTRAINT teachers_pkey PRIMARY KEY (id),
    CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_gov_id_unique
ON public.teachers (gov_id)
WHERE gov_id IS NOT NULL;

-- RLS: Allow all authenticated users to view teachers
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON public.teachers 
    FOR SELECT USING (
        (select auth.role()) = 'authenticated'
    );

CREATE POLICY "Enable insert/update for authenticated users" ON public.teachers 
    FOR ALL USING (
        (select auth.role()) = 'authenticated'
    ) WITH CHECK (
        (select auth.role()) = 'authenticated'
    );

-- Trigger for updated_at
CREATE TRIGGER update_teachers_updated_at BEFORE
UPDATE ON public.teachers FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Optional: Add teacher trigger to auto-create teacher record on user signup
-- This would require a function and trigger in the auth schema (more complex)
-- For now, teachers must be manually created or created via application logic

-- Create class_session_teachers junction table
CREATE TABLE IF NOT EXISTS public.class_session_teachers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    class_session_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    effective_to date,
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
