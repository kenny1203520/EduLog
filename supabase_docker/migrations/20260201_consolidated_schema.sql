-- Consolidated Schema: Students, Schools, Contacts, Credentials, Reports
-- Merges:
-- - 20260131_init_schema.sql
-- - 20260201_add_class_to_schools.sql
-- - 20260201_add_timestamps.sql
-- - 20260201_fix_policies.sql
-- - 20260201_remove_redundant_columns.sql

-- ==========================================
-- 1. Helper Functions
-- ==========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$ language 'plpgsql';

-- ==========================================
-- 2. Tables Definition
-- ==========================================

-- 2.1 Students Table
CREATE TABLE IF NOT EXISTS students (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  -- Basic Info
  name text NOT NULL,
  notes text,
  
  -- Extended Details
  gov_id text,
  email text,
  phone text,
  residence_address text,
  mailing_address text,
  
  -- REMOVED: grade, orange_apple_id (Redundant/Moved)
  
  user_id uuid REFERENCES auth.users DEFAULT auth.uid()
);

-- 2.2 Student Contacts (One-to-Many)
CREATE TABLE IF NOT EXISTS student_contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  name text NOT NULL,
  relation text, -- e.g. Father, Mother
  phone text,
  email text,
  
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- 2.3 Student Schools (One-to-Many)
CREATE TABLE IF NOT EXISTS student_schools (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  name text NOT NULL,
  status text, -- e.g. Graduated, Enrolled
  grade text,  -- e.g. Year 1
  class text,  -- e.g. Class A (Added 2026-02-01)
  school_student_id text, -- School ID / 學號
  
  start_date text, -- YYYY-MM-DD
  end_date text,   -- YYYY-MM-DD (Empty = Present)
  
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- 2.4 Student Credentials (One-to-Many)
CREATE TABLE IF NOT EXISTS student_credentials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  platform text NOT NULL, -- 'Orange Apple', 'Roblox', 'Minecraft', 'Anydesk', etc.
  username text,
  password text,
  url text,
  
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- 2.5 Reports Table
CREATE TABLE IF NOT EXISTS reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  content text DEFAULT '',
  date date DEFAULT CURRENT_DATE,
  
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- ==========================================
-- 3. Triggers (Auto-update updated_at)
-- ==========================================

-- Students
CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Contacts
CREATE TRIGGER update_student_contacts_updated_at BEFORE UPDATE ON student_contacts FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Schools
CREATE TRIGGER update_student_schools_updated_at BEFORE UPDATE ON student_schools FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Credentials
CREATE TRIGGER update_student_credentials_updated_at BEFORE UPDATE ON student_credentials FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Reports
CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON reports FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 4. Row Level Security (RLS) & Policies
-- ==========================================

-- Enable RLS
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- 4.1 Students Policies
CREATE POLICY "Users can view their own students" ON students FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own students" ON students FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own students" ON students FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own students" ON students FOR DELETE USING (auth.uid() = user_id);

-- 4.2 Contacts Policies
-- Consolidated "manage" policy
CREATE POLICY "Users can manage their own student contacts" ON student_contacts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4.3 Schools Policies
CREATE POLICY "Users can manage their own student schools" ON student_schools FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4.4 Credentials Policies
CREATE POLICY "Users can manage their own student credentials" ON student_credentials FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4.5 Reports Policies
CREATE POLICY "Users can view their own reports" ON reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own reports" ON reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own reports" ON reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own reports" ON reports FOR DELETE USING (auth.uid() = user_id);
