-- Forward-only hardening for the 1000043 teaching reconciliation.
-- This migration deliberately redefines missing API/RBAC primitives rather
-- than changing deployed history.

DO $$
BEGIN
  IF to_regclass('public.teachings') IS NULL
     OR to_regclass('public.teaching_members') IS NULL
     OR to_regclass('public.role_inheritance') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR to_regprocedure('public.resolve_teaching_permission(uuid,text,uuid,uuid,uuid,date)') IS NULL
     OR to_regprocedure('public.resolve_user_permission(uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000044 prerequisites missing; apply migrations through 1000043 first';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.rbac_policy_epoch (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  epoch bigint NOT NULL DEFAULT 1 CHECK (epoch > 0),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
INSERT INTO public.rbac_policy_epoch(singleton, epoch)
VALUES (true, 1)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bump_rbac_policy_epoch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.rbac_policy_epoch
  SET epoch = epoch + 1, updated_at = timezone('utc'::text, now())
  WHERE singleton = true;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_role_inheritance_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role_id = NEW.parent_role_id THEN
    RAISE EXCEPTION 'RBAC_ROLE_INHERITANCE_CYCLE';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors(role_id) AS (
      SELECT NEW.parent_role_id
      UNION
      SELECT inheritance.parent_role_id
      FROM public.role_inheritance inheritance
      JOIN ancestors ancestor ON ancestor.role_id = inheritance.role_id
      WHERE NOT (TG_OP = 'UPDATE' AND inheritance.role_id = OLD.role_id AND inheritance.parent_role_id = OLD.parent_role_id)
    )
    SELECT 1 FROM ancestors WHERE role_id = NEW.role_id
  ) THEN
    RAISE EXCEPTION 'RBAC_ROLE_INHERITANCE_CYCLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS role_inheritance_cycle_guard ON public.role_inheritance;
CREATE TRIGGER role_inheritance_cycle_guard
BEFORE INSERT OR UPDATE ON public.role_inheritance
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_inheritance_cycle();

DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'roles', 'role_inheritance', 'role_permission_policies',
    'user_role_assignments', 'teaching_members'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'rbac_policy_epoch_' || target_table, target_table);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bump_rbac_policy_epoch()',
      'rbac_policy_epoch_' || target_table, target_table
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_api_permission(
  p_user_id uuid,
  p_permission_key text,
  p_classroom_id uuid DEFAULT NULL,
  p_class_session_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.role() = 'service_role'
    OR (
      auth.uid() = p_user_id AND (
        p_permission_key = 'teaching.teachings.create'
        OR EXISTS (
          SELECT 1 FROM public.resolve_user_permission(
            p_user_id, p_permission_key, p_classroom_id, p_class_session_id
          ) legacy WHERE legacy.is_allowed AND NOT legacy.is_denied
        )
        OR EXISTS (
          SELECT 1
          FROM public.teachings teaching
          WHERE public.has_teaching_permission(
            p_user_id,
            p_permission_key,
            teaching.id,
            p_classroom_id,
            p_class_session_id
          )
        )
      )
    );
$$;

REVOKE ALL ON TABLE public.rbac_policy_epoch FROM PUBLIC, anon;
GRANT SELECT ON public.rbac_policy_epoch TO authenticated;
REVOKE ALL ON FUNCTION public.bump_rbac_policy_epoch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_role_inheritance_cycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provision_teaching_owner_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_user_id IS NOT NULL AND NOT NEW.is_quarantine THEN
    INSERT INTO public.teaching_members(teaching_id, user_id, role_id, status)
    SELECT NEW.id, NEW.owner_user_id, role.id, 'active'
    FROM public.roles role
    WHERE role.code = 'teaching_owner'
    ON CONFLICT (teaching_id, user_id) DO UPDATE SET
      role_id = EXCLUDED.role_id,
      status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teaching_owner_membership_provision ON public.teachings;
CREATE TRIGGER teaching_owner_membership_provision
AFTER INSERT OR UPDATE OF owner_user_id, is_quarantine ON public.teachings
FOR EACH ROW EXECUTE FUNCTION public.provision_teaching_owner_member();

REVOKE ALL ON FUNCTION public.provision_teaching_owner_member() FROM PUBLIC;

DO $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT * FROM (VALUES
      ('teachings', 'Teaching owners create teachings'),
      ('teachings', 'Teaching owners update teachings'),
      ('teachings', 'Teaching owners delete teachings'),
      ('teaching_members', 'Teaching managers create membership'),
      ('teaching_members', 'Teaching managers update membership'),
      ('teaching_members', 'Teaching managers delete membership'),
      ('lessons', 'Teaching lessons read'),
      ('lessons', 'Teaching lessons create'),
      ('lessons', 'Teaching lessons update'),
      ('lessons', 'Teaching lessons delete'),
      ('class_session_teachers', 'Teaching session teachers read'),
      ('class_session_teachers', 'Teaching session teachers create'),
      ('class_session_teachers', 'Teaching session teachers update'),
      ('class_session_teachers', 'Teaching session teachers delete'),
      ('enrollments', 'Teaching enrollments read'),
      ('enrollments', 'Teaching enrollments create'),
      ('enrollments', 'Teaching enrollments update'),
      ('enrollments', 'Teaching enrollments delete'),
      ('class_occurrences', 'Teaching occurrences read'),
      ('class_occurrences', 'Teaching occurrences create'),
      ('class_occurrences', 'Teaching occurrences update'),
      ('class_occurrences', 'Teaching occurrences delete'),
      ('occurrence_reports', 'Teaching reports read'),
      ('occurrence_reports', 'Teaching reports create'),
      ('occurrence_reports', 'Teaching reports update'),
      ('occurrence_reports', 'Teaching reports delete'),
      ('report_templates', 'Teaching templates read'),
      ('report_templates', 'Teaching templates create'),
      ('report_templates', 'Teaching templates update'),
      ('report_templates', 'Teaching templates delete'),
      ('student_credentials', 'Teaching credentials read'),
      ('student_credentials', 'Teaching credentials create'),
      ('student_credentials', 'Teaching credentials update'),
      ('student_credentials', 'Teaching credentials delete')
    ) AS policies(table_name, policy_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', candidate.policy_name, candidate.table_name);
  END LOOP;
END;
$$;

-- Leave no 1000043 policy names behind so that the immutable reconciliation
-- script can be replayed; canonical replacements below retain the same scope.
DO $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT * FROM (VALUES
      ('teachings', 'Teaching members can read teachings'),
      ('teachings', 'Teaching owners manage teachings'),
      ('teaching_members', 'Teaching members can read membership'),
      ('teaching_members', 'Teaching managers manage membership'),
      ('classrooms', 'Teaching classrooms read'),
      ('classrooms', 'Teaching classrooms write'),
      ('classrooms', 'Teaching classrooms update'),
      ('classrooms', 'Teaching classrooms delete'),
      ('courses', 'Teaching courses read'),
      ('courses', 'Teaching courses write'),
      ('courses', 'Teaching courses update'),
      ('courses', 'Teaching courses delete'),
      ('class_sessions', 'Teaching sessions read'),
      ('class_sessions', 'Teaching sessions write'),
      ('class_sessions', 'Teaching sessions update'),
      ('class_sessions', 'Teaching sessions delete'),
      ('lessons', 'Teaching scoped lessons'),
      ('class_session_teachers', 'Teaching scoped session teachers'),
      ('enrollments', 'Teaching scoped enrollments'),
      ('class_occurrences', 'Teaching scoped occurrences'),
      ('occurrence_reports', 'Teaching scoped reports'),
      ('report_templates', 'Teaching scoped report templates'),
      ('teachers', 'Teaching scoped teachers'),
      ('teachers', 'Teaching teachers manage'),
      ('teachers', 'Teaching teachers update'),
      ('teachers', 'Teaching teachers delete'),
      ('student_credentials', 'Teaching scoped credentials'),
      ('teachings', 'Canonical teachings read'),
      ('teaching_members', 'Canonical teaching members read'),
      ('classrooms', 'Canonical classrooms read'),
      ('classrooms', 'Canonical classrooms create'),
      ('classrooms', 'Canonical classrooms update'),
      ('classrooms', 'Canonical classrooms delete'),
      ('courses', 'Canonical courses read'),
      ('courses', 'Canonical courses create'),
      ('courses', 'Canonical courses update'),
      ('courses', 'Canonical courses delete'),
      ('class_sessions', 'Canonical sessions read'),
      ('class_sessions', 'Canonical sessions create'),
      ('class_sessions', 'Canonical sessions update'),
      ('class_sessions', 'Canonical sessions delete'),
      ('teachers', 'Canonical teachers read'),
      ('teachers', 'Canonical teachers create'),
      ('teachers', 'Canonical teachers update'),
      ('teachers', 'Canonical teachers delete')
    ) AS policies(table_name, policy_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', candidate.policy_name, candidate.table_name);
  END LOOP;
END;
$$;

-- Action-specific RLS policies replace the remaining FOR ALL variants.
DROP POLICY IF EXISTS "Teaching owners manage teachings" ON public.teachings;
CREATE POLICY "Teaching owners create teachings" ON public.teachings FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid() AND is_quarantine = false);
CREATE POLICY "Teaching owners update teachings" ON public.teachings FOR UPDATE TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid() AND is_quarantine = false);
CREATE POLICY "Teaching owners delete teachings" ON public.teachings FOR DELETE TO authenticated USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "Teaching managers manage membership" ON public.teaching_members;
CREATE POLICY "Teaching managers create membership" ON public.teaching_members FOR INSERT TO authenticated WITH CHECK (public.can_teaching_action(teaching_id, 'members', 'manage'));
CREATE POLICY "Teaching managers update membership" ON public.teaching_members FOR UPDATE TO authenticated USING (public.can_teaching_action(teaching_id, 'members', 'manage')) WITH CHECK (public.can_teaching_action(teaching_id, 'members', 'manage'));
CREATE POLICY "Teaching managers delete membership" ON public.teaching_members FOR DELETE TO authenticated USING (public.can_teaching_action(teaching_id, 'members', 'manage'));

DROP POLICY IF EXISTS "Teaching scoped lessons" ON public.lessons;
CREATE POLICY "Teaching lessons read" ON public.lessons FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND (public.can_teaching_action(course.teaching_id, 'lessons', 'read') OR public.can_teaching_action(course.teaching_id, 'lessons', 'list'))));
CREATE POLICY "Teaching lessons create" ON public.lessons FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_teaching_action(course.teaching_id, 'lessons', 'create')));
CREATE POLICY "Teaching lessons update" ON public.lessons FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_teaching_action(course.teaching_id, 'lessons', 'update'))) WITH CHECK (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_teaching_action(course.teaching_id, 'lessons', 'update')));
CREATE POLICY "Teaching lessons delete" ON public.lessons FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_teaching_action(course.teaching_id, 'lessons', 'delete')));

DROP POLICY IF EXISTS "Teaching scoped session teachers" ON public.class_session_teachers;
CREATE POLICY "Teaching session teachers read" ON public.class_session_teachers FOR SELECT TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.class_sessions.read') OR public.can_access_class_session(class_session_id, 'teaching.class_sessions.list'));
CREATE POLICY "Teaching session teachers create" ON public.class_session_teachers FOR INSERT TO authenticated WITH CHECK (public.can_access_class_session(class_session_id, 'teaching.class_sessions.update'));
CREATE POLICY "Teaching session teachers update" ON public.class_session_teachers FOR UPDATE TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.class_sessions.update')) WITH CHECK (public.can_access_class_session(class_session_id, 'teaching.class_sessions.update'));
CREATE POLICY "Teaching session teachers delete" ON public.class_session_teachers FOR DELETE TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.class_sessions.update'));

DROP POLICY IF EXISTS "Teaching scoped enrollments" ON public.enrollments;
CREATE POLICY "Teaching enrollments read" ON public.enrollments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.classrooms classroom WHERE classroom.id = enrollments.classroom_id AND (public.can_teaching_action(classroom.teaching_id, 'enrollments', 'read') OR public.can_teaching_action(classroom.teaching_id, 'enrollments', 'list'))) OR EXISTS (SELECT 1 FROM public.class_sessions session WHERE session.id = enrollments.class_session_id AND (public.can_teaching_action(session.teaching_id, 'enrollments', 'read') OR public.can_teaching_action(session.teaching_id, 'enrollments', 'list'))));
CREATE POLICY "Teaching enrollments create" ON public.enrollments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms classroom WHERE classroom.id = enrollments.classroom_id AND public.can_teaching_action(classroom.teaching_id, 'enrollments', 'create')) OR EXISTS (SELECT 1 FROM public.class_sessions session WHERE session.id = enrollments.class_session_id AND public.can_teaching_action(session.teaching_id, 'enrollments', 'create')));
CREATE POLICY "Teaching enrollments update" ON public.enrollments FOR UPDATE TO authenticated USING (public.can_access_enrollment(id, 'teaching.enrollments.update')) WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms classroom WHERE classroom.id = enrollments.classroom_id AND public.can_teaching_action(classroom.teaching_id, 'enrollments', 'update')) OR EXISTS (SELECT 1 FROM public.class_sessions session WHERE session.id = enrollments.class_session_id AND public.can_teaching_action(session.teaching_id, 'enrollments', 'update')));
CREATE POLICY "Teaching enrollments delete" ON public.enrollments FOR DELETE TO authenticated USING (public.can_access_enrollment(id, 'teaching.enrollments.delete'));

DROP POLICY IF EXISTS "Teaching scoped occurrences" ON public.class_occurrences;
CREATE POLICY "Teaching occurrences read" ON public.class_occurrences FOR SELECT TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.occurrences.read') OR public.can_access_class_session(class_session_id, 'teaching.occurrences.list'));
CREATE POLICY "Teaching occurrences create" ON public.class_occurrences FOR INSERT TO authenticated WITH CHECK (public.can_access_class_session(class_session_id, 'teaching.occurrences.create'));
CREATE POLICY "Teaching occurrences update" ON public.class_occurrences FOR UPDATE TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.occurrences.update')) WITH CHECK (public.can_access_class_session(class_session_id, 'teaching.occurrences.update'));
CREATE POLICY "Teaching occurrences delete" ON public.class_occurrences FOR DELETE TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.occurrences.delete'));

DROP POLICY IF EXISTS "Teaching scoped reports" ON public.occurrence_reports;
CREATE POLICY "Teaching reports read" ON public.occurrence_reports FOR SELECT TO authenticated USING (public.can_access_report(id, 'teaching.reports.read') OR public.can_access_report(id, 'teaching.reports.list'));
CREATE POLICY "Teaching reports create" ON public.occurrence_reports FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.class_occurrences occurrence JOIN public.class_sessions session ON session.id = occurrence.class_session_id WHERE occurrence.id = occurrence_reports.class_occurrence_id AND public.can_teaching_action(session.teaching_id, 'reports', 'create')));
CREATE POLICY "Teaching reports update" ON public.occurrence_reports FOR UPDATE TO authenticated USING (public.can_access_report(id, 'teaching.reports.update')) WITH CHECK (EXISTS (SELECT 1 FROM public.class_occurrences occurrence JOIN public.class_sessions session ON session.id = occurrence.class_session_id WHERE occurrence.id = occurrence_reports.class_occurrence_id AND public.can_teaching_action(session.teaching_id, 'reports', 'update')));
CREATE POLICY "Teaching reports delete" ON public.occurrence_reports FOR DELETE TO authenticated USING (public.can_access_report(id, 'teaching.reports.delete'));

DROP POLICY IF EXISTS "Teaching scoped report templates" ON public.report_templates;
CREATE POLICY "Teaching templates read" ON public.report_templates FOR SELECT TO authenticated USING (public.can_teaching_action(teaching_id, 'templates', 'read') OR public.can_teaching_action(teaching_id, 'templates', 'list') OR instructor_id = auth.uid());
CREATE POLICY "Teaching templates create" ON public.report_templates FOR INSERT TO authenticated WITH CHECK (public.can_teaching_action(teaching_id, 'templates', 'create') OR instructor_id = auth.uid());
CREATE POLICY "Teaching templates update" ON public.report_templates FOR UPDATE TO authenticated USING (public.can_teaching_action(teaching_id, 'templates', 'update') OR instructor_id = auth.uid()) WITH CHECK (public.can_teaching_action(teaching_id, 'templates', 'update') OR instructor_id = auth.uid());
CREATE POLICY "Teaching templates delete" ON public.report_templates FOR DELETE TO authenticated USING (public.can_teaching_action(teaching_id, 'templates', 'delete') OR instructor_id = auth.uid());

DROP POLICY IF EXISTS "Teaching scoped credentials" ON public.student_credentials;
CREATE POLICY "Teaching credentials read" ON public.student_credentials FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Teaching credentials create" ON public.student_credentials FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.can_access_student(student_id, 'teaching.students.create'));
CREATE POLICY "Teaching credentials update" ON public.student_credentials FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.can_access_student(student_id, 'teaching.students.update')) WITH CHECK (user_id = auth.uid() OR public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Teaching credentials delete" ON public.student_credentials FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.can_access_student(student_id, 'teaching.students.delete'));

-- Canonical policy names intentionally differ from 1000043's names.  That
-- lets an administrator replay the immutable reconciliation migration, then
-- reapply 1000044 to return to this final state.
CREATE POLICY "Canonical teachings read" ON public.teachings FOR SELECT TO authenticated
  USING (public.can_access_teaching(id));
CREATE POLICY "Canonical teaching members read" ON public.teaching_members FOR SELECT TO authenticated
  USING (public.can_access_teaching(teaching_id));

CREATE POLICY "Canonical classrooms read" ON public.classrooms FOR SELECT TO authenticated
  USING (public.can_teaching_action(teaching_id, 'classrooms', 'read') OR public.can_teaching_action(teaching_id, 'classrooms', 'list'));
CREATE POLICY "Canonical classrooms create" ON public.classrooms FOR INSERT TO authenticated
  WITH CHECK (public.can_teaching_action(teaching_id, 'classrooms', 'create'));
CREATE POLICY "Canonical classrooms update" ON public.classrooms FOR UPDATE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'classrooms', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'classrooms', 'update'));
CREATE POLICY "Canonical classrooms delete" ON public.classrooms FOR DELETE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'classrooms', 'delete'));

CREATE POLICY "Canonical courses read" ON public.courses FOR SELECT TO authenticated
  USING (public.can_teaching_action(teaching_id, 'courses', 'read') OR public.can_teaching_action(teaching_id, 'courses', 'list'));
CREATE POLICY "Canonical courses create" ON public.courses FOR INSERT TO authenticated
  WITH CHECK (public.can_teaching_action(teaching_id, 'courses', 'create'));
CREATE POLICY "Canonical courses update" ON public.courses FOR UPDATE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'courses', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'courses', 'update'));
CREATE POLICY "Canonical courses delete" ON public.courses FOR DELETE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'courses', 'delete'));

CREATE POLICY "Canonical sessions read" ON public.class_sessions FOR SELECT TO authenticated
  USING (public.can_teaching_action(teaching_id, 'class_sessions', 'read') OR public.can_teaching_action(teaching_id, 'class_sessions', 'list'));
CREATE POLICY "Canonical sessions create" ON public.class_sessions FOR INSERT TO authenticated
  WITH CHECK (public.can_teaching_action(teaching_id, 'class_sessions', 'create'));
CREATE POLICY "Canonical sessions update" ON public.class_sessions FOR UPDATE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'class_sessions', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'class_sessions', 'update'));
CREATE POLICY "Canonical sessions delete" ON public.class_sessions FOR DELETE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'class_sessions', 'delete'));

CREATE POLICY "Canonical teachers read" ON public.teachers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.class_session_teachers assignment JOIN public.class_sessions session ON session.id = assignment.class_session_id WHERE assignment.teacher_id = teachers.id AND public.can_access_class_session(session.id, 'teaching.teachers.read')));
CREATE POLICY "Canonical teachers create" ON public.teachers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Canonical teachers update" ON public.teachers FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Canonical teachers delete" ON public.teachers FOR DELETE TO authenticated
  USING (user_id = auth.uid());
