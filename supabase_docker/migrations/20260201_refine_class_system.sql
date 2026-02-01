-- Phase 2.1: Refine Class System
-- 1. Add Address to Classrooms
ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS address text;

-- 2. Create Class Sessions (replacing simple schedules if needed, but we can keep schedules for simple blocking if desired. 
-- However, User request implies "Class Session" is the main specific entity)
CREATE TABLE IF NOT EXISTS class_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  name text NOT NULL, -- e.g. "Python L1 Tuesday"
  classroom_id uuid REFERENCES classrooms(id) ON DELETE SET NULL,
  
  -- Supports multiple courses in one session (e.g. Mixed Lab)
  course_ids uuid[] DEFAULT '{}', 
  
  -- Schedule
  day_of_week int CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
  start_time time NOT NULL,
  end_time time NOT NULL,
  
  capacity int DEFAULT 10,
  
  user_id uuid REFERENCES auth.users DEFAULT auth.uid() NOT NULL
);

ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own class sessions" ON class_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_class_sessions_updated_at BEFORE UPDATE ON class_sessions FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 3. Update Enrollments to link to Class Session
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS class_session_id uuid REFERENCES class_sessions(id) ON DELETE SET NULL;

-- 4. Migrate existing schedules to sessions? (Optional, assuming fresh start or manual)
-- We will leave existing "classroom_schedules" for now or assume they are deprecated. 
-- The user request implies a more robust "Class Session". 
