-- Teacher roles and configurable recipients for incomplete-report notifications.

CREATE TABLE IF NOT EXISTS public.teacher_role_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text,
    name text NOT NULL,
    is_system boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 100,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT teacher_role_types_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS teacher_role_types_code_unique
    ON public.teacher_role_types (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS teacher_role_types_name_unique
    ON public.teacher_role_types (lower(btrim(name)));

INSERT INTO public.teacher_role_types (code, name, is_system, sort_order) VALUES
    ('instructor', '講師', true, 10),
    ('assistant_instructor', '助教', true, 20),
    ('trainee_instructor', '實習講師', true, 30),
    ('trainee_assistant', '實習助教', true, 40),
    ('teacher', '老師', true, 50),
    ('learning_coach', '學習教練', true, 60),
    ('coach', '教練', true, 70),
    ('trainee_teacher', '實習教師', true, 80),
    ('trainee_tutor', '實習老師', true, 90),
    ('trainee_learning_coach', '實習學習教練', true, 100),
    ('trainee_coach', '實習教練', true, 110)
ON CONFLICT DO NOTHING;

ALTER TABLE public.teacher_role_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read teacher roles" ON public.teacher_role_types
    FOR SELECT USING ((select auth.role()) = 'authenticated');
CREATE POLICY "Authenticated users can create custom teacher roles" ON public.teacher_role_types
    FOR INSERT WITH CHECK ((select auth.role()) = 'authenticated' AND is_system = false);
CREATE POLICY "Authenticated users can update custom teacher roles" ON public.teacher_role_types
    FOR UPDATE USING ((select auth.role()) = 'authenticated' AND is_system = false)
    WITH CHECK ((select auth.role()) = 'authenticated' AND is_system = false);
CREATE POLICY "Authenticated users can delete custom teacher roles" ON public.teacher_role_types
    FOR DELETE USING ((select auth.role()) = 'authenticated' AND is_system = false);
CREATE TRIGGER update_teacher_role_types_updated_at BEFORE UPDATE ON public.teacher_role_types
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE public.class_session_teachers
    ADD COLUMN IF NOT EXISTS role_type_id uuid;

UPDATE public.class_session_teachers
SET role_type_id = (SELECT id FROM public.teacher_role_types WHERE code = 'teacher')
WHERE role_type_id IS NULL;

ALTER TABLE public.class_session_teachers
    ALTER COLUMN role_type_id SET NOT NULL;
ALTER TABLE public.class_session_teachers
    ADD CONSTRAINT class_session_teachers_role_type_id_fkey
    FOREIGN KEY (role_type_id) REFERENCES public.teacher_role_types(id);
CREATE INDEX IF NOT EXISTS idx_class_session_teachers_role_type_id
    ON public.class_session_teachers(role_type_id);

CREATE OR REPLACE FUNCTION public.set_default_teacher_role_type()
RETURNS trigger AS $$
BEGIN
    IF NEW.role_type_id IS NULL THEN
        SELECT id INTO NEW.role_type_id FROM public.teacher_role_types WHERE code = 'teacher';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_class_session_teacher_default_role
    BEFORE INSERT ON public.class_session_teachers
    FOR EACH ROW EXECUTE PROCEDURE public.set_default_teacher_role_type();

CREATE TABLE IF NOT EXISTS public.incomplete_report_notification_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type text NOT NULL CHECK (scope_type IN ('global', 'classroom', 'class_session')),
    classroom_id uuid REFERENCES public.classrooms(id) ON DELETE CASCADE,
    class_session_id uuid REFERENCES public.class_sessions(id) ON DELETE CASCADE,
    role_type_id uuid NOT NULL REFERENCES public.teacher_role_types(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT incomplete_report_notification_scope_shape CHECK (
        (scope_type = 'global' AND classroom_id IS NULL AND class_session_id IS NULL)
        OR (scope_type = 'classroom' AND classroom_id IS NOT NULL AND class_session_id IS NULL)
        OR (scope_type = 'class_session' AND classroom_id IS NULL AND class_session_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS incomplete_report_notification_global_unique
    ON public.incomplete_report_notification_rules(role_type_id) WHERE scope_type = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS incomplete_report_notification_classroom_unique
    ON public.incomplete_report_notification_rules(classroom_id, role_type_id) WHERE scope_type = 'classroom';
CREATE UNIQUE INDEX IF NOT EXISTS incomplete_report_notification_session_unique
    ON public.incomplete_report_notification_rules(class_session_id, role_type_id) WHERE scope_type = 'class_session';

ALTER TABLE public.incomplete_report_notification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage incomplete report notification rules"
    ON public.incomplete_report_notification_rules FOR ALL
    USING ((select auth.role()) = 'authenticated')
    WITH CHECK ((select auth.role()) = 'authenticated');
CREATE TRIGGER update_incomplete_report_notification_rules_updated_at
    BEFORE UPDATE ON public.incomplete_report_notification_rules
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
