-- ==========================================
-- Relax RLS Policies: Enable Shared Access
-- ==========================================
-- Date: 2026-02-04
-- Purpose: Allow any authenticated user to manage ALL data.
-- Coverage: All 17 tables from the current public schema.

-- Macro-like approach: Drop old policies and add new "authenticated" policy for each table.

-- 1. Students & Related
DROP POLICY IF EXISTS "Users can view their own students" ON students;
DROP POLICY IF EXISTS "Users can insert their own students" ON students;
DROP POLICY IF EXISTS "Users can update their own students" ON students;
DROP POLICY IF EXISTS "Users can delete their own students" ON students;
CREATE POLICY "Enable all access for authenticated users" ON students FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own student contacts" ON student_contacts;
CREATE POLICY "Enable all access for authenticated users" ON student_contacts FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own student schools" ON student_schools;
CREATE POLICY "Enable all access for authenticated users" ON student_schools FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own student credentials" ON student_credentials;
CREATE POLICY "Enable all access for authenticated users" ON student_credentials FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- 2. Courses & Classes
DROP POLICY IF EXISTS "Users can manage their own courses" ON courses;
CREATE POLICY "Enable all access for authenticated users" ON courses FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own lessons" ON lessons;
CREATE POLICY "Enable all access for authenticated users" ON lessons FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own classrooms" ON classrooms;
CREATE POLICY "Enable all access for authenticated users" ON classrooms FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own classroom schedules" ON classroom_schedules;
CREATE POLICY "Enable all access for authenticated users" ON classroom_schedules FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- 3. Sessions, Enrollments & Suspensions
DROP POLICY IF EXISTS "Users can manage their own class sessions" ON class_sessions;
CREATE POLICY "Enable all access for authenticated users" ON class_sessions FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own enrollments" ON enrollments;
CREATE POLICY "Enable all access for authenticated users" ON enrollments FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- NOTE: student_suspensions did not have explicit RLS in previous files, but we should enable it for consistency
ALTER TABLE student_suspensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON student_suspensions FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- 4. Reports (Legacy & New)
DROP POLICY IF EXISTS "Users can view their own reports" ON reports;
DROP POLICY IF EXISTS "Users can insert their own reports" ON reports;
DROP POLICY IF EXISTS "Users can update their own reports" ON reports;
DROP POLICY IF EXISTS "Users can delete their own reports" ON reports;
CREATE POLICY "Enable all access for authenticated users" ON reports FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own lesson reports" ON lesson_reports;
CREATE POLICY "Enable all access for authenticated users" ON lesson_reports FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own class occurrences" ON class_occurrences;
CREATE POLICY "Enable all access for authenticated users" ON class_occurrences FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own occurrence reports" ON occurrence_reports;
CREATE POLICY "Enable all access for authenticated users" ON occurrence_reports FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage their own report versions" ON report_versions;
CREATE POLICY "Enable all access for authenticated users" ON report_versions FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- 5. Additional Tables found in schema
-- Report Templates
ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own templates" ON report_templates; -- speculative drop
CREATE POLICY "Enable all access for authenticated users" ON report_templates FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Holidays
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage holidays" ON holidays; -- speculative drop
CREATE POLICY "Enable all access for authenticated users" ON holidays FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
