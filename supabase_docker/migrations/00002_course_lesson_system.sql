-- ==========================================
-- Course & Lesson System
-- ==========================================
-- Tables: Courses, Lessons, Classrooms, Classroom Schedules
-- Date: 2026-02-02
-- Dependencies: 00001_foundation_student_management.sql

-- ==========================================
-- 1. Courses
-- ==========================================

CREATE TABLE IF NOT EXISTS courses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  subject TEXT NOT NULL,
  stage TEXT NOT NULL,
  description TEXT,
  display_name TEXT,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- RLS
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own courses" 
  ON courses FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_courses_updated_at 
  BEFORE UPDATE ON courses 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 2. Lessons
-- ==========================================

CREATE TABLE IF NOT EXISTS lessons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 1,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- RLS
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own lessons" 
  ON lessons FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_lessons_updated_at 
  BEFORE UPDATE ON lessons 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 3. Classrooms
-- ==========================================

CREATE TABLE IF NOT EXISTS classrooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  name TEXT NOT NULL,
  color TEXT DEFAULT '#10b981',
  address TEXT,
  phone TEXT,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- RLS
ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own classrooms" 
  ON classrooms FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_classrooms_updated_at 
  BEFORE UPDATE ON classrooms 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 4. Classroom Schedules
-- ==========================================

CREATE TABLE IF NOT EXISTS classroom_schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  classroom_id UUID REFERENCES classrooms(id) ON DELETE CASCADE NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- RLS
ALTER TABLE classroom_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own classroom schedules" 
  ON classroom_schedules FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_classroom_schedules_updated_at 
  BEFORE UPDATE ON classroom_schedules 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_lessons_course_id ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_classroom_schedules_classroom_id ON classroom_schedules(classroom_id);
