-- ==========================================
-- User Preferences
-- ==========================================
-- Per-user application preferences that should follow a login across devices.
-- Date: 2026-05-11
-- Dependencies: 1000001_core_schema.sql
-- ==========================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    time_zone text NOT NULL DEFAULT 'Asia/Taipei',
    CONSTRAINT user_preferences_pkey PRIMARY KEY (id),
    CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT user_preferences_user_id_unique UNIQUE (user_id),
    CONSTRAINT user_preferences_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64)
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own preferences"
ON public.user_preferences
FOR SELECT
USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert their own preferences"
ON public.user_preferences
FOR INSERT
WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update their own preferences"
ON public.user_preferences
FOR UPDATE
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

CREATE TRIGGER update_user_preferences_updated_at
BEFORE UPDATE ON public.user_preferences
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
