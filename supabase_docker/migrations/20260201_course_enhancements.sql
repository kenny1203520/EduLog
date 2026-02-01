-- Migration: Course Management Enhancements
-- Date: 2026-02-01

-- Add display_name to courses table
-- This allows courses to have a "friendly name" different from their internal identifier
-- Example: "菁英_Python 程式進階班" -> "Python 程式進階班"
ALTER TABLE courses 
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Add lesson_number to class_sessions table
-- This helps in tracking which lesson of a course a specific session covers
ALTER TABLE class_sessions 
ADD COLUMN IF NOT EXISTS lesson_number INTEGER;

-- Add start_date and lesson_number to enrollments table
-- Tracks when a student specifically starts a course/session and their progress
ALTER TABLE enrollments 
ADD COLUMN IF NOT EXISTS start_date DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS lesson_number INTEGER DEFAULT 1;

-- Add notes to occurrences (often helpful for the teacher)
ALTER TABLE class_occurrences
ADD COLUMN IF NOT EXISTS notes TEXT;
