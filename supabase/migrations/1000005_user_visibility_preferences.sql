-- ==========================================
-- User Visibility Preferences
-- ==========================================
-- Per-user UI visibility preferences for classrooms and class sessions.
-- Date: 2026-04-16
-- Dependencies: 1000001_core_schema.sql
-- ==========================================

CREATE TABLE IF NOT EXISTS public.user_entity_visibility_preferences (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    entity_type text NOT NULL CHECK (
        entity_type = ANY (ARRAY['classroom'::text, 'class_session'::text])
    ),
    entity_id uuid NOT NULL,
    is_hidden boolean NOT NULL DEFAULT true,
    CONSTRAINT user_entity_visibility_preferences_pkey PRIMARY KEY (id),
    CONSTRAINT user_entity_visibility_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
    CONSTRAINT user_entity_visibility_preferences_user_entity_unique UNIQUE (user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS user_entity_visibility_preferences_lookup_idx
ON public.user_entity_visibility_preferences (user_id, entity_type, is_hidden);

ALTER TABLE public.user_entity_visibility_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own visibility preferences"
ON public.user_entity_visibility_preferences
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own visibility preferences"
ON public.user_entity_visibility_preferences
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own visibility preferences"
ON public.user_entity_visibility_preferences
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own visibility preferences"
ON public.user_entity_visibility_preferences
FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_user_entity_visibility_preferences_updated_at
BEFORE UPDATE ON public.user_entity_visibility_preferences
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
