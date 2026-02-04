-- ==========================================
-- Operations Schema: Enrollments, Reporting & Operations
-- ==========================================
-- Consolidates: Enrollments, Class Occurrences, Occurrence Reports, Reports, Suspensions
-- Date: 2026-02-05
-- Dependencies: 20240101000002_academics.sql

-- ==========================================
-- 1. Enrollments
-- ==========================================

CREATE TABLE IF NOT EXISTS public.enrollments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  student_id uuid NOT NULL,
  course_id uuid NOT NULL,
  classroom_id uuid,
  status text DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'dropped'::text])),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  class_session_id uuid,
  start_date date DEFAULT CURRENT_DATE,
  lesson_number integer DEFAULT 1,
  external_link text,
  CONSTRAINT enrollments_pkey PRIMARY KEY (id),
  CONSTRAINT enrollments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT enrollments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id),
  CONSTRAINT enrollments_classroom_id_fkey FOREIGN KEY (classroom_id) REFERENCES public.classrooms(id),
  CONSTRAINT enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT enrollments_class_session_id_fkey FOREIGN KEY (class_session_id) REFERENCES public.class_sessions(id)
);

-- RLS
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.enrollments FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Trigger
CREATE TRIGGER update_enrollments_updated_at 
  BEFORE UPDATE ON public.enrollments 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 2. Class Occurrences
-- ==========================================

CREATE TABLE IF NOT EXISTS public.class_occurrences (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  class_session_id uuid NOT NULL,
  occurrence_date date NOT NULL,
  status character varying DEFAULT 'scheduled'::character varying CHECK (status::text = ANY (ARRAY['scheduled'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'rescheduled'::character varying]::text[])),
  original_start_time time without time zone,
  original_end_time time without time zone,
  actual_start_time time without time zone,
  actual_end_time time without time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_conducted boolean DEFAULT true,
  CONSTRAINT class_occurrences_pkey PRIMARY KEY (id),
  CONSTRAINT class_occurrences_class_session_id_fkey FOREIGN KEY (class_session_id) REFERENCES public.class_sessions(id)
);

-- RLS
ALTER TABLE public.class_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.class_occurrences FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Trigger
CREATE TRIGGER update_class_occurrences_updated_at
  BEFORE UPDATE ON public.class_occurrences
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Constraints
-- Ensure uniqueness (Added via logic from 00005)
ALTER TABLE public.class_occurrences ADD CONSTRAINT class_occurrences_session_date_unique UNIQUE (class_session_id, occurrence_date);

-- ==========================================
-- 3. Occurrence Reports
-- ==========================================

CREATE TABLE IF NOT EXISTS public.occurrence_reports (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  enrollment_id uuid NOT NULL,
  class_occurrence_id uuid NOT NULL,
  content text DEFAULT ''::text,
  version integer DEFAULT 1,
  last_edited_by uuid,
  last_edited_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  lesson_id uuid,
  is_completed boolean DEFAULT true,
  progress_letter character varying CHECK (progress_letter::text ~ '^[A-Z](-[A-Z])?$'::text),
  attendance_status character varying DEFAULT 'present'::character varying CHECK (attendance_status::text = ANY (ARRAY['present'::character varying, 'absent'::character varying]::text[])),
  absence_reason character varying,
  class_participation numeric,
  classroom_behavior numeric,
  contact_notes text,
  class_notes text,
  external_link text,
  CONSTRAINT occurrence_reports_pkey PRIMARY KEY (id),
  CONSTRAINT occurrence_reports_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id),
  CONSTRAINT occurrence_reports_class_occurrence_id_fkey FOREIGN KEY (class_occurrence_id) REFERENCES public.class_occurrences(id),
  CONSTRAINT occurrence_reports_last_edited_by_fkey FOREIGN KEY (last_edited_by) REFERENCES auth.users(id),
  CONSTRAINT occurrence_reports_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id)
);

-- RLS
ALTER TABLE public.occurrence_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.occurrence_reports FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Trigger
CREATE TRIGGER update_occurrence_reports_updated_at
  BEFORE UPDATE ON public.occurrence_reports
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Version Snapshot Trigger Function
CREATE OR REPLACE FUNCTION create_report_version_snapshot()
RETURNS TRIGGER AS $$
BEGIN
    -- Save old version before update
    IF OLD.content IS DISTINCT FROM NEW.content THEN
        INSERT INTO report_versions (occurrence_report_id, version, content, edited_by)
        VALUES (OLD.id, OLD.version, OLD.content, OLD.last_edited_by);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_report_version_snapshot
  BEFORE UPDATE ON public.occurrence_reports
  FOR EACH ROW
  EXECUTE FUNCTION create_report_version_snapshot();

-- Constraints
-- Ensure uniqueness (Added via logic from 00005)
ALTER TABLE public.occurrence_reports ADD CONSTRAINT occurrence_reports_enrollment_occurrence_unique UNIQUE (enrollment_id, class_occurrence_id);

-- ==========================================
-- 4. Report Versions
-- ==========================================

CREATE TABLE IF NOT EXISTS public.report_versions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  occurrence_report_id uuid NOT NULL,
  version integer NOT NULL,
  content text NOT NULL,
  edited_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT report_versions_pkey PRIMARY KEY (id),
  CONSTRAINT report_versions_occurrence_report_id_fkey FOREIGN KEY (occurrence_report_id) REFERENCES public.occurrence_reports(id),
  CONSTRAINT report_versions_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.report_versions FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ==========================================
-- 5. Lesson Reports (Legacy)
-- ==========================================

CREATE TABLE IF NOT EXISTS public.lesson_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  enrollment_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  content text DEFAULT ''::text,
  version integer DEFAULT 1,
  updated_by uuid,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  CONSTRAINT lesson_reports_pkey PRIMARY KEY (id),
  CONSTRAINT lesson_reports_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id),
  CONSTRAINT lesson_reports_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id),
  CONSTRAINT lesson_reports_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id),
  CONSTRAINT lesson_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.lesson_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.lesson_reports FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Trigger
CREATE TRIGGER update_lesson_reports_updated_at 
  BEFORE UPDATE ON public.lesson_reports 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 6. Reports (Legacy)
-- ==========================================

CREATE TABLE IF NOT EXISTS public.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  content text DEFAULT ''::text,
  date date DEFAULT CURRENT_DATE,
  student_id uuid NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.reports FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Trigger
CREATE TRIGGER update_reports_updated_at 
  BEFORE UPDATE ON public.reports 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 7. Report Templates
-- ==========================================

CREATE TABLE IF NOT EXISTS public.report_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  content text NOT NULL,
  contact_notes text,
  class_notes text,
  instructor_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT report_templates_pkey PRIMARY KEY (id),
  CONSTRAINT report_templates_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.report_templates FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ==========================================
-- 8. Student Suspensions
-- ==========================================

CREATE TABLE IF NOT EXISTS public.student_suspensions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT student_suspensions_pkey PRIMARY KEY (id),
  CONSTRAINT student_suspensions_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id)
);

-- RLS
ALTER TABLE public.student_suspensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.student_suspensions FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
