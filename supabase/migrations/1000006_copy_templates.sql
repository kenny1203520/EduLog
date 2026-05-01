-- ==========================================
-- Copy Templates
-- ==========================================
-- User-customizable templates for attendance copy and course copy.
-- Date: 2026-04-23
-- Dependencies: 1000001_core_schema.sql
-- ==========================================

CREATE TABLE IF NOT EXISTS public.copy_templates (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    template_type text NOT NULL CHECK (
        template_type = ANY (ARRAY['attendance_copy'::text, 'course_copy'::text])
    ),
    scope_type text NOT NULL CHECK (
        scope_type = ANY (ARRAY['user_default'::text, 'class_session'::text])
    ),
    scope_entity_id text NOT NULL,
    template_text text NOT NULL,
    CONSTRAINT copy_templates_pkey PRIMARY KEY (id),
    CONSTRAINT copy_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
    CONSTRAINT copy_templates_user_scope_unique UNIQUE (user_id, template_type, scope_type, scope_entity_id)
);

CREATE INDEX IF NOT EXISTS copy_templates_lookup_idx
ON public.copy_templates (user_id, template_type, scope_type);

ALTER TABLE public.copy_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own copy templates"
ON public.copy_templates
FOR SELECT
USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert their own copy templates"
ON public.copy_templates
FOR INSERT
WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update their own copy templates"
ON public.copy_templates
FOR UPDATE
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete their own copy templates"
ON public.copy_templates
FOR DELETE
USING ((select auth.uid()) = user_id);

CREATE TRIGGER update_copy_templates_updated_at
BEFORE UPDATE ON public.copy_templates
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
