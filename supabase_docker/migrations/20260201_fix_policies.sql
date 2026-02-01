-- Fix RLS Policies for Deletion
-- It seems the delete policies might be missing or not applied correctly.
-- This script explicitly drops and recreates the DELETE policies.

-- 1. Students
DROP POLICY IF EXISTS "Users can delete their own students" ON students;
CREATE POLICY "Users can delete their own students" ON students FOR DELETE USING (auth.uid() = user_id);

-- 2. Contacts
DROP POLICY IF EXISTS "Users can manage their own student contacts" ON student_contacts;
CREATE POLICY "Users can manage their own student contacts" ON student_contacts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. Schools
DROP POLICY IF EXISTS "Users can manage their own student schools" ON student_schools;
CREATE POLICY "Users can manage their own student schools" ON student_schools FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Credentials
DROP POLICY IF EXISTS "Users can manage their own student credentials" ON student_credentials;
CREATE POLICY "Users can manage their own student credentials" ON student_credentials FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. Reports
DROP POLICY IF EXISTS "Users can delete their own reports" ON reports;
CREATE POLICY "Users can delete their own reports" ON reports FOR DELETE USING (auth.uid() = user_id);

-- Ensure RLS is enabled
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
