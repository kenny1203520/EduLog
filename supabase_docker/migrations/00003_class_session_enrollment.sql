-- ==========================================
-- Class Session & Enrollment System
-- ==========================================
-- Tables: Class Sessions, Enrollments, Lesson Reports
-- Date: 2026-02-02
-- Dependencies: 00001, 00002

-- ==========================================
-- 1. Class Sessions
-- ==========================================

CREATE TABLE IF NOT EXISTS class_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  name TEXT NOT NULL,
  classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
  course_ids UUID[] DEFAULT '{}',
  
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  capacity INTEGER DEFAULT 10,
  lesson_number INTEGER,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- RLS
ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own class sessions" 
  ON class_sessions FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_class_sessions_updated_at 
  BEFORE UPDATE ON class_sessions 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 2. Enrollments
-- ==========================================

CREATE TABLE IF NOT EXISTS enrollments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  student_id UUID REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
  class_session_id UUID REFERENCES class_sessions(id) ON DELETE SET NULL,
  
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'dropped')),
  start_date DATE DEFAULT CURRENT_DATE,
  lesson_number INTEGER DEFAULT 1,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

-- RLS
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own enrollments" 
  ON enrollments FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_enrollments_updated_at 
  BEFORE UPDATE ON enrollments 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 3. Lesson Reports (Legacy)
-- ==========================================

CREATE TABLE IF NOT EXISTS lesson_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  enrollment_id UUID REFERENCES enrollments(id) ON DELETE CASCADE NOT NULL,
  lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE NOT NULL,
  
  content TEXT DEFAULT '',
  version INTEGER DEFAULT 1,
  updated_by UUID REFERENCES auth.users,
  
  user_id UUID REFERENCES auth.users DEFAULT auth.uid() NOT NULL,
  
  UNIQUE(enrollment_id, lesson_id)
);

-- RLS
ALTER TABLE lesson_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own lesson reports" 
  ON lesson_reports FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_lesson_reports_updated_at 
  BEFORE UPDATE ON lesson_reports 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_enrollments_student_id ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class_session_id ON enrollments(class_session_id);
CREATE INDEX IF NOT EXISTS idx_lesson_reports_enrollment_id ON lesson_reports(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_lesson_reports_lesson_id ON lesson_reports(lesson_id);
