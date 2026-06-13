-- ==========================================
-- Koding.school code check support
-- ==========================================

ALTER TABLE public.enrollments
ADD COLUMN IF NOT EXISTS koding_admission_id text;

CREATE TABLE IF NOT EXISTS public.teacher_credentials (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    teacher_id uuid NOT NULL,
    platform text NOT NULL,
    username text,
    password text,
    url text,
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT teacher_credentials_pkey PRIMARY KEY (id),
    CONSTRAINT teacher_credentials_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE,
    CONSTRAINT teacher_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

ALTER TABLE public.teacher_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.teacher_credentials FOR ALL USING (
    (
        select auth.role()
    ) = 'authenticated'
) WITH CHECK (
    (
        select auth.role()
    ) = 'authenticated'
);

CREATE TRIGGER update_teacher_credentials_updated_at BEFORE
UPDATE ON public.teacher_credentials FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
