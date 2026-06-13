-- ==========================================
-- Date Record Time Zones
-- ==========================================
-- Stores the IANA time zone used to create/interpret date-only records.
-- Existing records are assumed to have been managed in Asia/Taipei.
-- Date: 2026-05-16
-- Dependencies: 1000001_core_schema.sql, 1000002_academics.sql, 1000003_operations.sql
-- ==========================================

ALTER TABLE public.enrollments
ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'Asia/Taipei';

ALTER TABLE public.holidays
ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'Asia/Taipei';

ALTER TABLE public.student_schools
ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'Asia/Taipei';

ALTER TABLE public.student_suspensions
ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'Asia/Taipei';

UPDATE public.enrollments
SET time_zone = 'Asia/Taipei'
WHERE time_zone IS NULL OR length(time_zone) = 0;

UPDATE public.holidays
SET time_zone = 'Asia/Taipei'
WHERE time_zone IS NULL OR length(time_zone) = 0;

UPDATE public.student_schools
SET time_zone = 'Asia/Taipei'
WHERE time_zone IS NULL OR length(time_zone) = 0;

UPDATE public.student_suspensions
SET time_zone = 'Asia/Taipei'
WHERE time_zone IS NULL OR length(time_zone) = 0;

ALTER TABLE public.enrollments
DROP CONSTRAINT IF EXISTS enrollments_time_zone_check;

ALTER TABLE public.enrollments
ADD CONSTRAINT enrollments_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64);

ALTER TABLE public.holidays
DROP CONSTRAINT IF EXISTS holidays_time_zone_check;

ALTER TABLE public.holidays
ADD CONSTRAINT holidays_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64);

ALTER TABLE public.student_schools
DROP CONSTRAINT IF EXISTS student_schools_time_zone_check;

ALTER TABLE public.student_schools
ADD CONSTRAINT student_schools_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64);

ALTER TABLE public.student_suspensions
DROP CONSTRAINT IF EXISTS student_suspensions_time_zone_check;

ALTER TABLE public.student_suspensions
ADD CONSTRAINT student_suspensions_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64);
