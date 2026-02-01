-- Add created_at and updated_at to all tables

-- 1. Helper Function for Updating Timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$ language 'plpgsql';

-- 2. Students
ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone default timezone('utc'::text, now()) not null;

DROP TRIGGER IF EXISTS update_students_updated_at ON students;
CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 3. Student Contacts
ALTER TABLE student_contacts ADD COLUMN IF NOT EXISTS created_at timestamp with time zone default timezone('utc'::text, now()) not null;
ALTER TABLE student_contacts ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone default timezone('utc'::text, now()) not null;

DROP TRIGGER IF EXISTS update_student_contacts_updated_at ON student_contacts;
CREATE TRIGGER update_student_contacts_updated_at BEFORE UPDATE ON student_contacts FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 4. Student Schools
ALTER TABLE student_schools ADD COLUMN IF NOT EXISTS created_at timestamp with time zone default timezone('utc'::text, now()) not null;
ALTER TABLE student_schools ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone default timezone('utc'::text, now()) not null;

DROP TRIGGER IF EXISTS update_student_schools_updated_at ON student_schools;
CREATE TRIGGER update_student_schools_updated_at BEFORE UPDATE ON student_schools FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 5. Student Credentials
ALTER TABLE student_credentials ADD COLUMN IF NOT EXISTS created_at timestamp with time zone default timezone('utc'::text, now()) not null;
-- updated_at already exists in credentials, just need trigger
DROP TRIGGER IF EXISTS update_student_credentials_updated_at ON student_credentials;
CREATE TRIGGER update_student_credentials_updated_at BEFORE UPDATE ON student_credentials FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 6. Reports
ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone default timezone('utc'::text, now()) not null;

DROP TRIGGER IF EXISTS update_reports_updated_at ON reports;
CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON reports FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
