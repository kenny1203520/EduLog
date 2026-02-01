-- Remove redundant columns from students table
-- grade: moved to student_schools
-- orange_apple_id: moved to student_credentials

ALTER TABLE students DROP COLUMN IF EXISTS grade;
ALTER TABLE students DROP COLUMN IF EXISTS orange_apple_id;
