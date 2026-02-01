-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Students
ALTER TABLE students ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_students_modtime ON students;
CREATE TRIGGER update_students_modtime BEFORE UPDATE ON students FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Student Schools
ALTER TABLE student_schools ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE student_schools ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_student_schools_modtime ON student_schools;
CREATE TRIGGER update_student_schools_modtime BEFORE UPDATE ON student_schools FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Student Contacts
ALTER TABLE student_contacts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE student_contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_student_contacts_modtime ON student_contacts;
CREATE TRIGGER update_student_contacts_modtime BEFORE UPDATE ON student_contacts FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Student Credentials
ALTER TABLE student_credentials ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE student_credentials ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_student_credentials_modtime ON student_credentials;
CREATE TRIGGER update_student_credentials_modtime BEFORE UPDATE ON student_credentials FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Courses
ALTER TABLE courses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE courses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_courses_modtime ON courses;
CREATE TRIGGER update_courses_modtime BEFORE UPDATE ON courses FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Lessons
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_lessons_modtime ON lessons;
CREATE TRIGGER update_lessons_modtime BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Classrooms
ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_classrooms_modtime ON classrooms;
CREATE TRIGGER update_classrooms_modtime BEFORE UPDATE ON classrooms FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Classroom Schedules
ALTER TABLE classroom_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE classroom_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_classroom_schedules_modtime ON classroom_schedules;
CREATE TRIGGER update_classroom_schedules_modtime BEFORE UPDATE ON classroom_schedules FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Class Sessions
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_class_sessions_modtime ON class_sessions;
CREATE TRIGGER update_class_sessions_modtime BEFORE UPDATE ON class_sessions FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Enrollments
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_enrollments_modtime ON enrollments;
CREATE TRIGGER update_enrollments_modtime BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Lesson Reports
ALTER TABLE lesson_reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE lesson_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DROP TRIGGER IF EXISTS update_lesson_reports_modtime ON lesson_reports;
CREATE TRIGGER update_lesson_reports_modtime BEFORE UPDATE ON lesson_reports FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
