-- ==========================================
-- Session Time Zones
-- ==========================================
-- Adds per-session scheduling time zones and per-occurrence time zone snapshots.
-- Existing data is assumed to have been scheduled in Asia/Taipei.
-- Date: 2026-05-11
-- Dependencies: 1000002_academics.sql, 1000003_operations.sql
-- ==========================================

ALTER TABLE public.class_sessions
ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'Asia/Taipei';

ALTER TABLE public.class_occurrences
ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'Asia/Taipei';

UPDATE public.class_sessions
SET time_zone = 'Asia/Taipei'
WHERE time_zone IS NULL OR length(time_zone) = 0;

UPDATE public.class_occurrences
SET time_zone = 'Asia/Taipei'
WHERE time_zone IS NULL OR length(time_zone) = 0;

ALTER TABLE public.class_sessions
DROP CONSTRAINT IF EXISTS class_sessions_time_zone_check;

ALTER TABLE public.class_sessions
ADD CONSTRAINT class_sessions_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64);

ALTER TABLE public.class_occurrences
DROP CONSTRAINT IF EXISTS class_occurrences_time_zone_check;

ALTER TABLE public.class_occurrences
ADD CONSTRAINT class_occurrences_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64);
