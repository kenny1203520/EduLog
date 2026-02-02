-- ==========================================
-- Foundation Schema: Core Functions & Student Management
-- ==========================================
-- Consolidates: Students, Contacts, Schools, Credentials, Reports
-- Date: 2026-02-02
-- Dependencies: None (must run first)

-- ==========================================
-- 1. Helper Functions
-- ==========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- ==========================================
-- 2. Students Table
-- ==========================================

CREATE TABLE IF NOT EXISTS students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  -- Basic Info
  name TEXT NOT NULL,
  notes TEXT,
  
  -- Extended Details
  gov_id TEXT,
  email TEXT,
  phone TEXT,
  residence_address TEXT,
  mailing_address TEXT,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid()
);

-- RLS
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own students" ON students FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own students" ON students FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own students" ON students FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own students" ON students FOR DELETE USING (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_students_updated_at 
  BEFORE UPDATE ON students 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 3. Student Contacts
-- ==========================================

CREATE TABLE IF NOT EXISTS student_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  name TEXT NOT NULL,
  relation TEXT,
  phone TEXT,
  email TEXT,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- RLS
ALTER TABLE student_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own student contacts" 
  ON student_contacts FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_student_contacts_updated_at 
  BEFORE UPDATE ON student_contacts 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 4. Student Schools
-- ==========================================

CREATE TABLE IF NOT EXISTS student_schools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  name TEXT NOT NULL,
  status TEXT,
  grade TEXT,
  class TEXT,
  school_student_id TEXT,
  start_date TEXT,
  end_date TEXT,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- RLS
ALTER TABLE student_schools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own student schools" 
  ON student_schools FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_student_schools_updated_at 
  BEFORE UPDATE ON student_schools 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 5. Student Credentials
-- ==========================================

CREATE TABLE IF NOT EXISTS student_credentials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  platform TEXT NOT NULL,
  username TEXT,
  password TEXT,
  url TEXT,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- RLS
ALTER TABLE student_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own student credentials" 
  ON student_credentials FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_student_credentials_updated_at 
  BEFORE UPDATE ON student_credentials 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 6. Reports Table (Legacy)
-- ==========================================

CREATE TABLE IF NOT EXISTS reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  content TEXT DEFAULT '',
  date DATE DEFAULT CURRENT_DATE,
  
  student_id UUID REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- RLS
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own reports" ON reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own reports" ON reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own reports" ON reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own reports" ON reports FOR DELETE USING (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_reports_updated_at 
  BEFORE UPDATE ON reports 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
