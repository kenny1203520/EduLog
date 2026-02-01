-- Add class column to student_schools table
ALTER TABLE student_schools ADD COLUMN IF NOT EXISTS class text;
