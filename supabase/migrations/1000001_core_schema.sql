-- ==========================================
-- Core Schema: Foundation & Student Management
-- ==========================================
-- Consolidates: Students, Contacts, Schools, Credentials
-- Date: 2026-02-05
-- Dependencies: None (must run first)
-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- 2. Helper Functions
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER
SET search_path = public AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
-- 3. Users/Auth References (Implicit in Supabase, but useful to keep in mind)
-- linking logic relies on auth.users which is in the auth schema, not public.
-- ==========================================
-- 4. Students Table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.students (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    name text NOT NULL,
    notes text,
    user_id uuid DEFAULT auth.uid(),
    gov_id text,
    email text,
    phone text,
    residence_address text,
    mailing_address text,
    birthday date,
    external_link text,
    CONSTRAINT students_pkey PRIMARY KEY (id),
    CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
-- RLS
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.students FOR ALL USING (
    (
        select auth.role()
    ) = 'authenticated'
) WITH CHECK (
    (
        select auth.role()
    ) = 'authenticated'
);
-- Trigger
CREATE TRIGGER update_students_updated_at BEFORE
UPDATE ON public.students FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
-- ==========================================
-- 5. Student Contacts
-- ==========================================
CREATE TABLE IF NOT EXISTS public.student_contacts (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL,
    name text NOT NULL,
    relation text,
    phone text,
    user_id uuid NOT NULL DEFAULT auth.uid(),
    email text,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT student_contacts_pkey PRIMARY KEY (id),
    CONSTRAINT student_contacts_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
    CONSTRAINT student_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
-- RLS
ALTER TABLE public.student_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.student_contacts FOR ALL USING (
    (
        select auth.role()
    ) = 'authenticated'
) WITH CHECK (
    (
        select auth.role()
    ) = 'authenticated'
);
-- Trigger
CREATE TRIGGER update_student_contacts_updated_at BEFORE
UPDATE ON public.student_contacts FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
-- ==========================================
-- 6. Student Schools
-- ==========================================
CREATE TABLE IF NOT EXISTS public.student_schools (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL,
    name text NOT NULL,
    status text,
    user_id uuid NOT NULL DEFAULT auth.uid(),
    grade text,
    school_student_id text,
    start_date text,
    end_date text,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    class text,
    CONSTRAINT student_schools_pkey PRIMARY KEY (id),
    CONSTRAINT student_schools_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
    CONSTRAINT student_schools_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
-- RLS
ALTER TABLE public.student_schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.student_schools FOR ALL USING (
    (
        select auth.role()
    ) = 'authenticated'
) WITH CHECK (
    (
        select auth.role()
    ) = 'authenticated'
);
-- Trigger
CREATE TRIGGER update_student_schools_updated_at BEFORE
UPDATE ON public.student_schools FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
-- ==========================================
-- 7. Student Credentials
-- ==========================================
CREATE TABLE IF NOT EXISTS public.student_credentials (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL,
    platform text NOT NULL,
    username text,
    password text,
    url text,
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT student_credentials_pkey PRIMARY KEY (id),
    CONSTRAINT student_credentials_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
    CONSTRAINT student_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
-- RLS
ALTER TABLE public.student_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.student_credentials FOR ALL USING (
    (
        select auth.role()
    ) = 'authenticated'
) WITH CHECK (
    (
        select auth.role()
    ) = 'authenticated'
);
-- Trigger
CREATE TRIGGER update_student_credentials_updated_at BEFORE
UPDATE ON public.student_credentials FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();