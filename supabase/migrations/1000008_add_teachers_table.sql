-- ==========================================
-- Teachers Table
-- ==========================================
-- Purpose: Public table for querying available teachers
-- Links to auth.users via user_id, allows authenticated users to view teacher list

CREATE TABLE IF NOT EXISTS public.teachers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE,
    name text,
    email text,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT teachers_pkey PRIMARY KEY (id),
    CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

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
