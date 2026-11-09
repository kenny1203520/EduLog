-- Teacher archive and teacher-directory read models.
--
-- * teacher_records.archived_at: an archived teacher keeps their history
--   (reports, past class assignments) but is hidden from the default list
--   and cannot be assigned to a class again. Archiving requires that the
--   teacher has no current or future class assignment.
-- * set_teacher_archived(teacher, archived): archive or restore; needs the
--   platform-level teaching.teachers.update permission.
-- * get_teachers_overview gains a status filter (active / archived / all),
--   searches email and phone (and ID number) for callers allowed to read
--   teacher contact details, and returns email, phone, class_count and
--   archived_at. The four-argument form stays as a wrapper (active only).
-- * get_teacher_assignments(teacher): the teacher's class assignments the
--   caller may see, with role and whether the caller may change them.
--
-- Rerunnable.

BEGIN;

ALTER TABLE public.teacher_records ADD COLUMN IF NOT EXISTS archived_at timestamptz;
-- teacher_records uses column-level grants; extend them to the new column.
GRANT SELECT (archived_at) ON public.teacher_records TO authenticated, service_role;

-- An archived teacher cannot be given a class assignment.
CREATE OR REPLACE FUNCTION private.reject_archived_teacher_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.teacher_id = OLD.teacher_id
     AND NEW.effective_from = OLD.effective_from
     AND NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to
     AND NEW.role_id = OLD.role_id THEN
    RETURN NEW;
  END IF;
  -- Ending or shortening an existing assignment stays possible.
  IF TG_OP = 'UPDATE' AND NEW.teacher_id = OLD.teacher_id
     AND NEW.effective_to IS NOT NULL
     AND (OLD.effective_to IS NULL OR NEW.effective_to <= OLD.effective_to) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.teacher_records teacher WHERE teacher.id = NEW.teacher_id AND teacher.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TEACHER_ARCHIVED';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.reject_archived_teacher_assignment() FROM PUBLIC;

DROP TRIGGER IF EXISTS reject_archived_teacher_assignment ON public.class_session_teachers;
CREATE TRIGGER reject_archived_teacher_assignment
  BEFORE INSERT OR UPDATE ON public.class_session_teachers
  FOR EACH ROW EXECUTE FUNCTION private.reject_archived_teacher_assignment();

CREATE OR REPLACE FUNCTION public.set_teacher_archived(p_teacher_id uuid, p_archived boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_archived_at timestamptz;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_archived IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ARCHIVED';
  END IF;
  IF NOT public.has_api_permission(v_user_id, 'teaching.teachers.update', NULL, NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;
  PERFORM 1 FROM public.teacher_records WHERE id = p_teacher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TEACHER_NOT_FOUND';
  END IF;
  IF p_archived AND EXISTS (
    SELECT 1 FROM public.class_session_teachers assignment
    WHERE assignment.teacher_id = p_teacher_id
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TEACHER_HAS_ACTIVE_ASSIGNMENTS';
  END IF;
  UPDATE public.teacher_records
     SET archived_at = CASE WHEN p_archived THEN COALESCE(archived_at, now()) ELSE NULL END,
         updated_at = now()
   WHERE id = p_teacher_id
  RETURNING archived_at INTO v_archived_at;
  RETURN jsonb_build_object('id', p_teacher_id, 'archived_at', v_archived_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_teacher_archived(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_teacher_archived(uuid, boolean) TO authenticated;

-- p_status has no default so a four-argument call stays unambiguous: it
-- resolves to the four-argument wrapper below (active teachers).
CREATE OR REPLACE FUNCTION public.get_teachers_overview(p_limit integer, p_offset integer, p_search text, p_sort text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_search text := btrim(COALESCE(p_search, ''));
  v_sensitive boolean;
  v_result jsonb;
BEGIN
  PERFORM private.assert_overview_request(
    p_limit, p_offset, v_search, p_sort,
    ARRAY['name', '-name', 'created_at', '-created_at', 'class_count', '-class_count']
  );
  IF p_status IS NULL OR p_status NOT IN ('active', 'archived', 'all') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_STATUS';
  END IF;
  v_sensitive := public.has_api_permission(v_user_id, 'teaching.teachers.read_sensitive', NULL, NULL);

  -- The teachers view applies can_access_teacher: the caller's own record,
  -- every teacher for a platform-level read grant (including teachers with
  -- no class assignment yet), or teachers sharing a class session the caller
  -- may read teachers in.
  WITH access AS MATERIALIZED (
    SELECT public.has_teaching_permission_any_scope(v_user_id, 'teaching.teachers.read')
        OR public.has_teaching_permission_any_scope(v_user_id, 'teaching.teachers.list') AS allowed
  ),
  visible_teachers AS MATERIALIZED (
    SELECT teacher.id, teacher.user_id, teacher.name, teacher.bio, teacher.bio_document,
           teacher.created_at, teacher.updated_at, record.archived_at,
           (v_sensitive OR teacher.user_id = v_user_id) AS show_contact,
           profile.contact_email, profile.phone, profile.government_id,
           (SELECT count(DISTINCT assignment.class_session_id) FROM public.class_session_teachers assignment
             WHERE assignment.teacher_id = teacher.id
               AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)) AS class_count
    -- archived_at is read from teacher_records: the compatibility view's
    -- column list is owned by 1000101, which reconciliation reruns recreate.
    FROM public.teachers teacher
    JOIN public.teacher_records record ON record.id = teacher.id
    JOIN public.profiles profile ON profile.id = teacher.profile_id
    CROSS JOIN access
    WHERE teacher.user_id = v_user_id OR access.allowed
  ),
  status_teachers AS MATERIALIZED (
    SELECT * FROM visible_teachers teacher
    WHERE p_status = 'all'
       OR (p_status = 'active' AND teacher.archived_at IS NULL)
       OR (p_status = 'archived' AND teacher.archived_at IS NOT NULL)
  ),
  filtered_teachers AS MATERIALIZED (
    SELECT * FROM status_teachers teacher
    WHERE v_search = ''
       OR strpos(lower(COALESCE(teacher.name, '')), lower(v_search)) > 0
       OR (teacher.show_contact AND (
             strpos(lower(COALESCE(teacher.contact_email, '')), lower(v_search)) > 0
          OR strpos(regexp_replace(COALESCE(teacher.phone, ''), '[^0-9+]', '', 'g'), regexp_replace(v_search, '[^0-9+]', '', 'g')) > 0
             AND regexp_replace(v_search, '[^0-9+]', '', 'g') <> ''
          OR upper(COALESCE(teacher.government_id, '')) = upper(v_search)))
  ),
  ordered_teachers AS MATERIALIZED (
    SELECT teacher.*, row_number() OVER (
      ORDER BY
        CASE WHEN p_sort = 'name' THEN lower(COALESCE(teacher.name, '')) END ASC,
        CASE WHEN p_sort = '-name' THEN lower(COALESCE(teacher.name, '')) END DESC,
        CASE WHEN p_sort = 'created_at' THEN teacher.created_at END ASC,
        CASE WHEN p_sort = '-created_at' THEN teacher.created_at END DESC,
        CASE WHEN p_sort = 'class_count' THEN teacher.class_count END ASC,
        CASE WHEN p_sort = '-class_count' THEN teacher.class_count END DESC,
        lower(COALESCE(teacher.name, '')) ASC,
        teacher.id ASC
    ) AS page_ordinal
    FROM filtered_teachers teacher
  ),
  page_teachers AS MATERIALIZED (
    SELECT * FROM ordered_teachers ORDER BY page_ordinal LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', teacher.id, 'user_id', teacher.user_id, 'name', teacher.name,
        'bio', teacher.bio, 'bio_document', teacher.bio_document,
        'email', CASE WHEN teacher.show_contact THEN teacher.contact_email END,
        'phone', CASE WHEN teacher.show_contact THEN teacher.phone END,
        'class_count', teacher.class_count,
        'archived_at', teacher.archived_at,
        'created_at', teacher.created_at, 'updated_at', teacher.updated_at
      ) ORDER BY teacher.page_ordinal) FROM page_teachers teacher
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered_teachers),
    'statistics', jsonb_build_object(
      'totalTeachers', (SELECT count(*) FROM visible_teachers WHERE archived_at IS NULL),
      'linkedAccounts', (SELECT count(*) FROM visible_teachers WHERE archived_at IS NULL AND user_id IS NOT NULL),
      'unlinkedAccounts', (SELECT count(*) FROM visible_teachers WHERE archived_at IS NULL AND user_id IS NULL),
      'unassignedTeachers', (SELECT count(*) FROM visible_teachers WHERE archived_at IS NULL AND class_count = 0),
      'archivedTeachers', (SELECT count(*) FROM visible_teachers WHERE archived_at IS NOT NULL)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_teachers_overview(integer, integer, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_teachers_overview(integer, integer, text, text, text) TO authenticated;

-- Earlier callers and contracts use the four-argument form.
CREATE OR REPLACE FUNCTION public.get_teachers_overview(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_search text DEFAULT ''::text, p_sort text DEFAULT 'name'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.get_teachers_overview(p_limit, p_offset, p_search, p_sort, 'active'::text);
$function$;

REVOKE ALL ON FUNCTION public.get_teachers_overview(integer, integer, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_teachers_overview(integer, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_teacher_assignments(p_teacher_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF NOT public.can_access_teacher(p_teacher_id, 'teaching.teachers.read') THEN
    RETURN NULL;
  END IF;
  RETURN COALESCE((
    WITH readable_sessions AS MATERIALIZED (
      SELECT public.accessible_class_session_ids(v_user_id, 'teaching.class_sessions.read') AS id
      UNION SELECT public.accessible_class_session_ids(v_user_id, 'teaching.class_sessions.list')
    )
    SELECT jsonb_agg(jsonb_build_object(
      'class_session_id', session.id,
      'class_session_name', session.name,
      'classroom_id', classroom.id,
      'classroom_name', classroom.name,
      'classroom_color', classroom.color,
      'role_id', role.id,
      'role_code', role.code,
      'role_name', role.name,
      'effective_from', assignment.effective_from,
      'effective_to', assignment.effective_to,
      'is_current', assignment.effective_from <= CURRENT_DATE
                    AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE),
      'can_manage', public.has_api_permission(v_user_id, 'teaching.class_sessions.update', NULL, session.id)
                    AND public.has_api_permission(v_user_id, 'teaching.roles.manage', NULL, session.id)
    ) ORDER BY (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE) DESC,
               assignment.effective_from DESC, session.name)
    FROM public.class_session_teachers assignment
    JOIN readable_sessions readable ON readable.id = assignment.class_session_id
    JOIN public.class_sessions session ON session.id = assignment.class_session_id
    LEFT JOIN public.classrooms classroom ON classroom.id = session.classroom_id
    JOIN public.roles role ON role.id = assignment.role_id
    WHERE assignment.teacher_id = p_teacher_id
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_teacher_assignments(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_teacher_assignments(uuid) TO authenticated;

COMMIT;
