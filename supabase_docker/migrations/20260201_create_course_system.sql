-- Phase 2: Course & Report System
-- Tables: courses, lessons, classrooms, classroom_schedules, enrollments, lesson_reports

-- ==========================================
-- 1. Courses (課程)
-- ==========================================
CREATE TABLE IF NOT EXISTS courses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  subject text NOT NULL, -- e.g. "Scratch", "Python"
  stage text NOT NULL,   -- e.g. "Level 1", "Beginner" (The classifier)
  description text,
  
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own courses" ON courses FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 2. Lessons (課)
-- ==========================================
CREATE TABLE IF NOT EXISTS lessons (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL, -- e.g. "Lesson 1: Intro"
  sequence int NOT NULL DEFAULT 1, -- Ordering
  
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own lessons" ON lessons FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_lessons_updated_at BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 3. Classrooms (教室)
-- ==========================================
CREATE TABLE IF NOT EXISTS classrooms (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  name text NOT NULL, -- e.g. "Room A"
  color text DEFAULT '#10b981', -- Hex color for UI
  
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own classrooms" ON classrooms FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_classrooms_updated_at BEFORE UPDATE ON classrooms FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 4. Classroom Schedules (教室課表)
-- ==========================================
CREATE TABLE IF NOT EXISTS classroom_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  
  classroom_id uuid REFERENCES classrooms(id) ON DELETE CASCADE NOT NULL,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
  start_time time NOT NULL,
  end_time time NOT NULL,
  
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

ALTER TABLE classroom_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own classroom schedules" ON classroom_schedules FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ==========================================
-- 5. Enrollments (學生選課)
-- ==========================================
CREATE TABLE IF NOT EXISTS enrollments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  classroom_id uuid REFERENCES classrooms(id) ON DELETE SET NULL, -- Can be null initially?
  
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'dropped')),
  
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own enrollments" ON enrollments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_enrollments_updated_at BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 6. Lesson Reports (課堂報告)
-- ==========================================
CREATE TABLE IF NOT EXISTS lesson_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  enrollment_id uuid REFERENCES enrollments(id) ON DELETE CASCADE NOT NULL,
  lesson_id uuid REFERENCES lessons(id) ON DELETE CASCADE NOT NULL,
  
  content text DEFAULT '',
  version int DEFAULT 1, -- Optimistic Locking
  
  updated_by uuid REFERENCES auth.users, -- Track who made the last edit
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL,
  
  -- One report per lesson per enrollment
  UNIQUE(enrollment_id, lesson_id)
);

ALTER TABLE lesson_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own lesson reports" ON lesson_reports FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_lesson_reports_updated_at BEFORE UPDATE ON lesson_reports FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
