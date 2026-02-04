-- ==========================================
-- Academics Schema: Courses & Scheduling
-- ==========================================
-- Consolidates: Courses, Lessons, Classrooms, Classroom Schedules, Class Sessions, Holidays
-- Date: 2026-02-05
-- Dependencies: 20240101000001_core_schema.sql

-- ==========================================
-- 1. Courses
-- ==========================================

CREATE TABLE IF NOT EXISTS public.courses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  subject text NOT NULL,
  stage text NOT NULL,
  description text,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  display_name text,
  CONSTRAINT courses_pkey PRIMARY KEY (id),
  CONSTRAINT courses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.courses FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Trigger
CREATE TRIGGER update_courses_updated_at 
  BEFORE UPDATE ON public.courses 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 2. Lessons
-- ==========================================

CREATE TABLE IF NOT EXISTS public.lessons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  course_id uuid NOT NULL,
  title text NOT NULL,
  sequence integer NOT NULL DEFAULT 1,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  CONSTRAINT lessons_pkey PRIMARY KEY (id),
  CONSTRAINT lessons_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id),
  CONSTRAINT lessons_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.lessons FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Trigger
CREATE TRIGGER update_lessons_updated_at 
  BEFORE UPDATE ON public.lessons 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 3. Classrooms
-- ==========================================

CREATE TABLE IF NOT EXISTS public.classrooms (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  name text NOT NULL,
  color text DEFAULT '#10b981'::text,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  address text,
  phone text,
  CONSTRAINT classrooms_pkey PRIMARY KEY (id),
  CONSTRAINT classrooms_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.classrooms FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Trigger
CREATE TRIGGER update_classrooms_updated_at 
  BEFORE UPDATE ON public.classrooms 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 4. Classroom Schedules
-- ==========================================

CREATE TABLE IF NOT EXISTS public.classroom_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT classroom_schedules_pkey PRIMARY KEY (id),
  CONSTRAINT classroom_schedules_classroom_id_fkey FOREIGN KEY (classroom_id) REFERENCES public.classrooms(id),
  CONSTRAINT classroom_schedules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.classroom_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.classroom_schedules FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Trigger
CREATE TRIGGER update_classroom_schedules_updated_at 
  BEFORE UPDATE ON public.classroom_schedules 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 5. Class Sessions
-- ==========================================

CREATE TABLE IF NOT EXISTS public.class_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  name text NOT NULL,
  classroom_id uuid,
  course_ids ARRAY DEFAULT '{}'::uuid[],
  day_of_week integer CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  capacity integer DEFAULT 10,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  lesson_number integer,
  CONSTRAINT class_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT class_sessions_classroom_id_fkey FOREIGN KEY (classroom_id) REFERENCES public.classrooms(id),
  CONSTRAINT class_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.class_sessions FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Trigger
CREATE TRIGGER update_class_sessions_updated_at 
  BEFORE UPDATE ON public.class_sessions 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 6. Holidays
-- ==========================================

CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date NOT NULL DEFAULT CURRENT_DATE,
  classroom_ids ARRAY DEFAULT '{}'::uuid[],
  class_session_ids ARRAY DEFAULT '{}'::uuid[],
  CONSTRAINT holidays_pkey PRIMARY KEY (id)
);

-- RLS
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.holidays FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
