-- One row per report, with redaction before search, counting and pagination.
CREATE FUNCTION public.get_student_report_reference_history(
  p_student_id uuid, p_course_id uuid, p_exclude_report_id uuid, p_search text,
  p_descending boolean, p_limit integer, p_offset integer, p_report_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
  WITH readable_enrollments AS MATERIALIZED (
    SELECT e.id, e.course_id,
           public.has_api_permission(auth.uid(), 'teaching.reports.list', NULL, e.class_session_id) AS linked_allowed
    FROM public.enrollments e
    WHERE e.student_id = p_student_id
      AND private.account_is_active(auth.uid())
      AND (public.can_access_enrollment(e.id, 'teaching.enrollments.read')
        OR public.can_access_enrollment(e.id, 'teaching.enrollments.list'))
  ), candidates AS MATERIALIZED (
    SELECT r.*, anchor.course_id AS anchor_course_id, o.occurrence_date,
           COALESCE(o.actual_start_time, o.original_start_time) AS start_time,
           EXISTS (SELECT 1 FROM readable_enrollments e WHERE e.id = r.enrollment_id)
             AND (
               public.can_access_occurrence_report(r.id)
               OR public.can_access_report(r.id, 'teaching.reports.read')
               OR public.can_access_report(r.id, 'teaching.reports.list')
             ) AS full_access
    FROM public.enrollments anchor
    JOIN public.occurrence_reports r ON r.enrollment_id = anchor.id
    JOIN public.class_occurrences o ON o.id = r.class_occurrence_id
    WHERE anchor.student_id = p_student_id
      AND r.id IS DISTINCT FROM p_exclude_report_id
      AND (p_report_id IS NULL OR r.id = p_report_id)
      AND EXISTS (SELECT 1 FROM readable_enrollments)
  ), visible AS (
    SELECT r.id, r.occurrence_date, r.start_time, r.attendance_status, r.content, r.content_document,
           CASE WHEN r.full_access THEN r.contact_notes END AS contact_notes,
           CASE WHEN r.full_access THEN r.contact_notes_document END AS contact_notes_document,
           CASE WHEN r.full_access THEN r.class_notes END AS class_notes,
           CASE WHEN r.full_access THEN r.class_notes_document END AS class_notes_document,
           CASE WHEN r.full_access THEN r.primary_lesson_entry_id END AS primary_lesson_entry_id,
           CASE WHEN r.full_access THEN r.progress_letter END AS progress_letter,
           CASE WHEN r.full_access THEN r.is_completed END AS is_completed,
           NOT r.full_access AS is_linked_lesson_entry,
           CASE WHEN r.full_access THEN r.anchor_course_id END AS anchor_course_id,
           CASE WHEN r.full_access THEN COALESCE(NULLIF(anchor_course.display_name, ''), concat_ws(' ', anchor_course.subject, anchor_course.stage)) END AS course_name,
           COALESCE(entries.rows, '[]'::jsonb) AS lesson_entries
    FROM candidates r
    LEFT JOIN public.courses anchor_course ON r.full_access AND anchor_course.id = r.anchor_course_id
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'id', item.entry->>'id', 'course_id', c.id,
        'course_name', COALESCE(NULLIF(c.display_name, ''), concat_ws(' ', c.subject, c.stage)),
        'lesson_id', l.id, 'lesson_title', l.title, 'lesson_sequence', l.sequence,
        'progress_letter', item.entry->>'progress_letter', 'is_completed', item.entry->'is_completed'
      ) ORDER BY item.position) AS rows
      FROM jsonb_array_elements(
        CASE WHEN r.full_access AND COALESCE(r.lesson_entries, '[]'::jsonb) = '[]'::jsonb AND r.lesson_id IS NOT NULL
          THEN jsonb_build_array(jsonb_build_object('course_id', r.anchor_course_id,
                'lesson_id', r.lesson_id, 'progress_letter', r.progress_letter, 'is_completed', r.is_completed))
          ELSE COALESCE(r.lesson_entries, '[]'::jsonb) END
      ) WITH ORDINALITY AS item(entry, position)
      JOIN public.lessons l ON l.id = CASE WHEN item.entry->>'lesson_id' ~*
        '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN (item.entry->>'lesson_id')::uuid END
      JOIN public.courses c ON c.id = l.course_id
        AND (c.id::text = item.entry->>'course_id' OR (r.full_access AND NULLIF(item.entry->>'course_id', '') IS NULL))
      WHERE r.full_access OR EXISTS (
        SELECT 1 FROM readable_enrollments e
        WHERE e.linked_allowed AND e.id <> r.enrollment_id
          AND e.id::text = item.entry->>'enrollment_id' AND e.course_id = c.id
      )
    ) entries
    WHERE r.full_access OR entries.rows IS NOT NULL
  ), filtered AS MATERIALIZED (
    SELECT v.*
    FROM visible v
    WHERE (
      v.attendance_status IN ('present', 'absent') OR jsonb_array_length(v.lesson_entries) > 0
      OR v.is_completed OR NULLIF(btrim(concat(v.progress_letter, v.content, v.contact_notes, v.class_notes)), '') IS NOT NULL
      OR jsonb_path_exists(jsonb_build_array(v.content_document, v.contact_notes_document, v.class_notes_document),
           'strict $.** ? (exists (@.text)).text ? (@ like_regex "\\S")', '{}'::jsonb, true)
    )
    AND (p_course_id IS NULL OR p_course_id = v.anchor_course_id
      OR v.lesson_entries @> jsonb_build_array(jsonb_build_object('course_id', p_course_id)))
    AND (NULLIF(btrim(p_search), '') IS NULL OR strpos(
      lower(concat_ws(' ', v.content, v.contact_notes, v.class_notes, v.progress_letter, v.course_name,
        (SELECT string_agg(concat_ws(' ', e->>'course_name', e->>'lesson_title', e->>'progress_letter'), ' ')
         FROM jsonb_array_elements(v.lesson_entries) e),
        (SELECT string_agg(node #>> '{}', ' ')
         FROM jsonb_path_query(jsonb_build_array(
           CASE WHEN NULLIF(btrim(v.content), '') IS NULL THEN v.content_document END,
           CASE WHEN NULLIF(btrim(v.contact_notes), '') IS NULL THEN v.contact_notes_document END,
           CASE WHEN NULLIF(btrim(v.class_notes), '') IS NULL THEN v.class_notes_document END),
           'strict $.** ? (exists (@.text)).text ? (@.type() == "string")', '{}'::jsonb, true) node))),
      lower(btrim(p_search))
    ) > 0)
  ), numbered AS (
    SELECT *, row_number() OVER (ORDER BY
      CASE WHEN p_descending THEN occurrence_date END DESC,
      CASE WHEN p_descending THEN start_time END DESC NULLS LAST,
      CASE WHEN p_descending THEN id END DESC,
      CASE WHEN NOT p_descending THEN occurrence_date END ASC,
      CASE WHEN NOT p_descending THEN start_time END ASC NULLS LAST,
      id ASC) AS position
    FROM filtered
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'data', COALESCE((SELECT jsonb_agg(to_jsonb(n) - 'position' - 'anchor_course_id' ORDER BY n.position)
      FROM numbered n
      WHERE n.position > greatest(0, p_offset)
        AND n.position <= greatest(0, p_offset)::bigint + least(100, greatest(1, p_limit))), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.get_student_report_reference_history(uuid, uuid, uuid, text, boolean, integer, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_report_reference_history(uuid, uuid, uuid, text, boolean, integer, integer, uuid) TO authenticated;
