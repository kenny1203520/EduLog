BEGIN;

CREATE OR REPLACE FUNCTION public.assert_extension_history_reconciliation_target(
  p_history_id uuid,
  p_report_id uuid,
  p_target_enrollment_id uuid,
  p_occurrence_id uuid,
  p_meta jsonb,
  p_data jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE
  v_history public.enrollment_history_reports;
  v_old public.enrollments;
  v_target public.enrollments;
  v_report public.occurrence_reports;
  v_occurrence public.class_occurrences;
  v_anchor public.enrollments;
  v_old_course public.courses;
  v_target_course public.courses;
  v_anchor_course public.courses;
  v_entry_meta jsonb;
BEGIN
  IF p_history_id IS NULL OR p_report_id IS NULL OR p_target_enrollment_id IS NULL OR p_occurrence_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_history FROM public.enrollment_history_reports WHERE id=p_history_id;
  IF NOT FOUND OR v_history.linked_report_id IS DISTINCT FROM p_report_id THEN RETURN false; END IF;
  SELECT * INTO v_old FROM public.enrollments WHERE id=v_history.enrollment_id;
  SELECT * INTO v_target FROM public.enrollments WHERE id=p_target_enrollment_id;
  SELECT * INTO v_report FROM public.occurrence_reports WHERE id=p_report_id AND class_occurrence_id=p_occurrence_id;
  SELECT * INTO v_occurrence FROM public.class_occurrences WHERE id=p_occurrence_id;
  IF v_old.id IS NULL OR v_target.id IS NULL OR v_report.id IS NULL OR v_occurrence.id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_anchor FROM public.enrollments WHERE id=v_report.enrollment_id;
  IF v_anchor.id IS NULL THEN RETURN false; END IF;

  IF NOT public.can_access_enrollment(v_target.id,'teaching.enrollments.read')
    OR NOT public.can_access_class_session(v_occurrence.class_session_id,'teaching.occurrences.read') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  IF v_history.enrollment_id IS DISTINCT FROM v_target.id
    AND (NOT public.can_access_enrollment(v_history.enrollment_id,'teaching.enrollments.read')
      OR NOT public.can_access_enrollment(v_history.enrollment_id,'teaching.reports.read')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT * INTO v_old_course FROM public.courses WHERE id=v_old.course_id;
  SELECT * INTO v_target_course FROM public.courses WHERE id=v_target.course_id;
  SELECT * INTO v_anchor_course FROM public.courses WHERE id=v_anchor.course_id;
  IF v_old.student_id IS DISTINCT FROM v_target.student_id
    OR v_old.student_id IS DISTINCT FROM v_anchor.student_id
    OR v_old_course.teaching_id IS DISTINCT FROM v_target_course.teaching_id
    OR v_old_course.teaching_id IS DISTINCT FROM v_anchor_course.teaching_id
    OR NOT public.history_occurrence_eligible(v_anchor.id,p_occurrence_id) THEN
    RAISE EXCEPTION 'INVALID_REFERENCE';
  END IF;

  IF v_history.enrollment_id IS DISTINCT FROM v_target.id
    AND NOT COALESCE((p_meta->>'reconfirm_occurrence')::boolean,false) THEN
    RAISE EXCEPTION 'INVALID_REFERENCE';
  END IF;

  IF COALESCE(p_meta->'include_fields' ?| ARRAY['lesson_id','is_completed','progress_letter'],false) THEN
    v_entry_meta:=p_meta->'lesson_entry';
    IF jsonb_typeof(v_entry_meta) IS DISTINCT FROM 'object'
      OR (v_entry_meta->>'enrollment_id') IS DISTINCT FROM v_target.id::text
      OR (v_entry_meta->>'course_id') IS DISTINCT FROM v_target.course_id::text
      OR (v_entry_meta->>'lesson_id') IS NULL
      OR (p_data ? 'lesson_id' AND (p_data->>'lesson_id') IS DISTINCT FROM v_entry_meta->>'lesson_id')
      OR NOT EXISTS(SELECT 1 FROM public.lessons lesson
        WHERE lesson.id=(v_entry_meta->>'lesson_id')::uuid AND lesson.course_id=v_target.course_id)
      OR v_entry_meta->>'entry_id' IS NULL
      OR NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_report.lesson_entries,'[]'::jsonb)) entry(value)
        WHERE entry.value->>'id'=v_entry_meta->>'entry_id'
          AND entry.value->>'enrollment_id'=v_target.id::text
          AND entry.value->>'course_id'=v_target.course_id::text
          AND entry.value->>'lesson_id'=v_entry_meta->>'lesson_id'
      ) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
  END IF;
  RETURN true;
END
$function$;
REVOKE ALL ON FUNCTION public.assert_extension_history_reconciliation_target(uuid,uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.extension_history_enrollment_remap_allowed(
  p_current jsonb,
  p_target_id uuid,
  p_row jsonb,
  p_data jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE
  v_meta jsonb:=p_row->'history_reconciliation';
BEGIN
  IF p_current IS NULL OR p_current->>'id' IS DISTINCT FROM p_target_id::text
    OR NOT COALESCE((v_meta->>'reconfirm_occurrence')::boolean,false)
    OR p_current->>'linked_report_id' IS DISTINCT FROM v_meta->>'report_id'
    OR p_current->>'source_origin' IS DISTINCT FROM p_data->>'source_origin'
    OR p_current->>'source_admission_id' IS DISTINCT FROM p_data->>'source_admission_id'
    OR p_current->>'source_report_id' IS DISTINCT FROM p_data->>'source_report_id'
    OR p_current->>'source_key' IS DISTINCT FROM p_data->>'source_key' THEN
    RETURN false;
  END IF;
  RETURN public.assert_extension_history_reconciliation_target(
    p_target_id,(v_meta->>'report_id')::uuid,(p_data->>'enrollment_id')::uuid,
    (v_meta->>'class_occurrence_id')::uuid,v_meta,p_data
  );
END
$function$;
REVOKE ALL ON FUNCTION public.extension_history_enrollment_remap_allowed(jsonb,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Permit only a confirmed, same-source remap of a linked history row.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition:=replace(pg_get_functiondef('public.web_extension_workspace_before_history_reconciliation(uuid,text,text,jsonb)'::regprocedure),E'\\r','');
  v_old:=$old$AND v_current->d.key IS DISTINCT FROM d.value$old$;
  v_new:=$new$AND v_current->d.key IS DISTINCT FROM d.value
       AND NOT (
         v_kind='history_report' AND d.key='enrollment_id'
         AND public.extension_history_enrollment_remap_allowed(v_current,v_id,v_row,v_data)
       )$new$;
  IF position(v_new IN v_definition)>0 THEN NULL;
  ELSIF position(v_old IN v_definition)=0 OR strpos(substring(v_definition FROM position(v_old IN v_definition)+1),v_old)>0 THEN
    RAISE EXCEPTION 'EXTENSION_HISTORY_IDENTITY_PATCH_FAILED';
  ELSE
    v_definition:=replace(v_definition,v_old,v_new);
  END IF;
  EXECUTE v_definition;
END
$migration$;

-- Persist the confirmed target enrollment on the source history row only when
-- the same exact-link authorization gate permits the immutable-key exception.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition:=replace(pg_get_functiondef('public.web_extension_workspace_before_history_reconciliation(uuid,text,text,jsonb)'::regprocedure),E'\\r','');
  v_old:=$old$IF v_current IS NULL OR (v_current->v_field IS DISTINCT FROM v_data->v_field AND (v_row->'overwrite') ? v_field) THEN v_patch:=v_patch||jsonb_build_object(v_field,v_data->v_field); END IF;$old$;
  v_new:=$new$IF v_current IS NULL OR (v_current->v_field IS DISTINCT FROM v_data->v_field AND (
       (v_row->'overwrite') ? v_field
       OR (v_kind='history_report' AND v_field='enrollment_id' AND public.extension_history_enrollment_remap_allowed(v_current,v_id,v_row,v_data))
     )) THEN v_patch:=v_patch||jsonb_build_object(v_field,v_data->v_field); END IF;$new$;
  IF position(v_new IN v_definition)>0 THEN NULL;
  ELSIF position(v_old IN v_definition)=0 THEN RAISE EXCEPTION 'EXTENSION_HISTORY_ENROLLMENT_PATCH_FAILED';
  ELSE v_definition:=replace(v_definition,v_old,v_new); END IF;
  EXECUTE v_definition;
END
$migration$;

-- Persist the enrollment through the existing typed update path once the
-- shared remap gate added the enrollment_id to v_patch.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition:=replace(pg_get_functiondef('public.web_extension_workspace_before_history_reconciliation(uuid,text,text,jsonb)'::regprocedure),E'\\r','');
  v_old:=$old$SET (lesson_id,is_completed,progress_letter,attendance_status,absence_reason,class_participation,classroom_behavior,content,contact_notes,class_notes,external_link,source_fields,source_evidence,version,updated_at)=(SELECT x.lesson_id,$old$;
  v_new:=$new$SET (enrollment_id,lesson_id,is_completed,progress_letter,attendance_status,absence_reason,class_participation,classroom_behavior,content,contact_notes,class_notes,external_link,source_fields,source_evidence,version,updated_at)=(SELECT x.enrollment_id,x.lesson_id,$new$;
  IF position(v_new IN v_definition)>0 THEN NULL;
  ELSIF position(v_old IN v_definition)=0 THEN RAISE EXCEPTION 'EXTENSION_HISTORY_ENROLLMENT_WRITE_PATCH_FAILED';
  ELSE v_definition:=replace(v_definition,v_old,v_new); END IF;
  EXECUTE v_definition;
END
$migration$;

-- A lesson can be synchronized into an already-linked shared report when the
-- incoming enrollment is cross-course, provided the exact history/report link
-- authorizes that student's matching lesson entry.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition:=replace(pg_get_functiondef('public.web_extension_workspace_before_history_reconciliation(uuid,text,text,jsonb)'::regprocedure),E'\\r','');
  v_old:=$old$        ) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
        IF v_data ? 'lesson_id' AND NOT EXISTS($old$;
  v_new:=$new$        ) AND NOT public.assert_extension_history_reconciliation_target(
          (v_row->>'target_id')::uuid,
          (v_row->'history_reconciliation'->>'report_id')::uuid,
          (v_data->>'enrollment_id')::uuid,
          (v_row->'history_reconciliation'->>'class_occurrence_id')::uuid,
          v_row->'history_reconciliation',v_data
        ) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
        IF v_data ? 'lesson_id' AND NOT EXISTS($new$;
  IF position(v_new IN v_definition)>0 THEN NULL;
  ELSIF position(v_old IN v_definition)=0 THEN RAISE EXCEPTION 'EXTENSION_HISTORY_TARGET_ELIGIBILITY_PATCH_FAILED';
  ELSE v_definition:=replace(v_definition,v_old,v_new); END IF;
  EXECUTE v_definition;
END
$migration$;


-- Extension history routing can resolve the exact report already linked to a
-- source row after an occurrence correction or enrollment remapping. A supplied
-- history-row ID is accepted only when its report link, permissions, student,
-- and teaching scope match the selected target. Normal routing can also return a
-- same-student, same-teaching report for another lesson entry.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_start integer;
  v_end integer;
BEGIN
  v_definition := pg_get_functiondef('public.enrollment_history_access(text,jsonb)'::regprocedure);
  v_old := replace($old$IF p_operation='route' THEN
    IF jsonb_typeof(p_input->'dates') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'dates') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF NOT public.can_access_enrollment((p_input->>'enrollment_id')::uuid,'teaching.enrollments.read') OR NOT public.can_access_enrollment((p_input->>'enrollment_id')::uuid,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    SELECT COALESCE(jsonb_agg(x.row ORDER BY x.id),'[]') INTO v_items FROM (
     SELECT o.id,jsonb_build_object('id',o.id,'class_session_id',o.class_session_id,'occurrence_date',o.occurrence_date,'class_name',s.name,'start_time',o.original_start_time,'end_time',o.original_end_time,'enrollment',public.web_extension_target('enrollment',(p_input->>'enrollment_id')::uuid),'report',CASE WHEN public.can_access_report(r.id,'teaching.reports.read') THEN to_jsonb(r)-'user_id' END,'can_write',CASE WHEN r.id IS NULL THEN public.can_create_occurrence_report((p_input->>'enrollment_id')::uuid,o.id) ELSE public.can_access_report(r.id,'teaching.reports.read') AND public.can_mutate_occurrence_report(r.id,'teaching.reports.update') END) row
     FROM public.class_occurrences o JOIN public.class_sessions s ON s.id=o.class_session_id
     LEFT JOIN public.occurrence_reports r ON r.class_occurrence_id=o.id AND r.enrollment_id=(p_input->>'enrollment_id')::uuid
     WHERE o.occurrence_date IN (SELECT value::date FROM jsonb_array_elements_text(p_input->'dates')) AND o.status<>'cancelled'
       AND public.can_access_class_session(s.id,'teaching.occurrences.read') AND public.can_access_class_session(s.id,'teaching.class_sessions.read')
       AND public.history_occurrence_eligible((p_input->>'enrollment_id')::uuid,o.id)
       AND (p_input->>'cursor' IS NULL OR o.id>(p_input->>'cursor')::uuid)
     ORDER BY o.id LIMIT v_limit+1
    ) x;
    RETURN jsonb_build_object('items',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items-v_limit ELSE v_items END,'next_cursor',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items->(v_limit-1)->>'id' END);
  END IF;$old$, E'\n    ', E'\n   ');
  v_new := $new$IF p_operation IN ('route','route-linked') THEN
    IF p_operation='route' AND (jsonb_typeof(p_input->'dates') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'dates') NOT BETWEEN 1 AND 50) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF p_operation='route-linked' AND (jsonb_typeof(p_input->'linked_report_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'linked_report_ids') NOT BETWEEN 1 AND 50 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_input->'linked_report_ids') id WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') OR (p_input ? 'linked_history_ids' AND (jsonb_typeof(p_input->'linked_history_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'linked_history_ids') NOT BETWEEN 1 AND 50 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_input->'linked_history_ids') id WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')))) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF NOT public.can_access_enrollment((p_input->>'enrollment_id')::uuid,'teaching.enrollments.read') OR NOT public.can_access_enrollment((p_input->>'enrollment_id')::uuid,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    SELECT COALESCE(jsonb_agg(x.row ORDER BY x.id),'[]') INTO v_items FROM (
     SELECT o.id,jsonb_build_object(
       'id',o.id,'class_occurrence_id',o.id,'class_session_id',o.class_session_id,'occurrence_date',o.occurrence_date,'class_name',s.name,'start_time',o.original_start_time,'end_time',o.original_end_time,
       'enrollment',public.web_extension_target('enrollment',(p_input->>'enrollment_id')::uuid),
       'report',CASE WHEN r.id IS NOT NULL AND public.can_access_report(r.id,'teaching.reports.read') THEN (to_jsonb(r)-'user_id')||jsonb_build_object('lesson_entry_labels',COALESCE((
         SELECT jsonb_agg(jsonb_build_object('id',entry.value->>'id','enrollment_id',entry.value->>'enrollment_id','enrollment_name',student.name,'course_id',course.id,'course_name',COALESCE(course.display_name,course.subject),'lesson_id',lesson.id,'lesson_name',lesson.title) ORDER BY entry.value->>'id')
         FROM jsonb_array_elements(COALESCE(r.lesson_entries,'[]'::jsonb)) entry(value)
         JOIN public.enrollments entry_enrollment ON entry_enrollment.id=(entry.value->>'enrollment_id')::uuid
         JOIN public.students student ON student.id=entry_enrollment.student_id
         JOIN public.courses course ON course.id=entry_enrollment.course_id
         LEFT JOIN public.lessons lesson ON lesson.id=(entry.value->>'lesson_id')::uuid
         WHERE public.can_access_enrollment(entry_enrollment.id,'teaching.enrollments.read') AND public.can_access_student(student.id,'teaching.students.read')
       ),'[]'::jsonb)) END,
       'ambiguous_report',COALESCE(r.match_count>1,false),
       'can_write',CASE WHEN r.match_count>1 THEN false WHEN r.id IS NULL THEN public.can_create_occurrence_report((p_input->>'enrollment_id')::uuid,o.id) ELSE public.can_access_report(r.id,'teaching.reports.read') AND public.can_mutate_occurrence_report(r.id,'teaching.reports.update') END
     ) row
     FROM public.class_occurrences o JOIN public.class_sessions s ON s.id=o.class_session_id
     LEFT JOIN LATERAL (
       SELECT candidate.*,count(*) OVER() AS match_count
       FROM public.occurrence_reports candidate
       WHERE candidate.class_occurrence_id=o.id AND (
         candidate.enrollment_id=(p_input->>'enrollment_id')::uuid
         OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(candidate.lesson_entries,'[]'::jsonb)) entry(value) WHERE entry.value->>'enrollment_id'=p_input->>'enrollment_id')
         OR (p_operation='route' AND EXISTS(
           SELECT 1 FROM public.enrollments target_enrollment
           JOIN public.courses target_course ON target_course.id=target_enrollment.course_id
           JOIN public.enrollments anchor_enrollment ON anchor_enrollment.id=candidate.enrollment_id
           JOIN public.courses anchor_course ON anchor_course.id=anchor_enrollment.course_id
           WHERE target_enrollment.id=(p_input->>'enrollment_id')::uuid
             AND anchor_enrollment.student_id=target_enrollment.student_id
             AND anchor_course.teaching_id=target_course.teaching_id
             AND public.history_occurrence_eligible(anchor_enrollment.id,o.id)
         ))
         OR (p_operation='route-linked' AND candidate.id::text IN (SELECT jsonb_array_elements_text(p_input->'linked_report_ids')) AND EXISTS(
           SELECT 1
           FROM public.enrollment_history_reports history
           JOIN public.enrollments linked_enrollment ON linked_enrollment.id=history.enrollment_id
           JOIN public.courses linked_course ON linked_course.id=linked_enrollment.course_id
           JOIN public.enrollments target_enrollment ON target_enrollment.id=(p_input->>'enrollment_id')::uuid
           JOIN public.courses target_course ON target_course.id=target_enrollment.course_id
           JOIN public.enrollments anchor_enrollment ON anchor_enrollment.id=candidate.enrollment_id
           JOIN public.courses anchor_course ON anchor_course.id=anchor_enrollment.course_id
           WHERE history.linked_report_id=candidate.id
             AND (history.enrollment_id=target_enrollment.id OR (
               history.id::text IN (SELECT jsonb_array_elements_text(p_input->'linked_history_ids'))
               AND public.can_access_enrollment(history.enrollment_id,'teaching.enrollments.read')
               AND public.can_access_enrollment(history.enrollment_id,'teaching.reports.read')
               AND linked_enrollment.student_id=target_enrollment.student_id
               AND linked_course.teaching_id=target_course.teaching_id
               AND anchor_enrollment.student_id=target_enrollment.student_id
               AND anchor_course.teaching_id=target_course.teaching_id
             ))
         ))
       )
       AND (p_operation='route' OR candidate.id::text IN (SELECT jsonb_array_elements_text(p_input->'linked_report_ids')))
       ORDER BY (candidate.enrollment_id=(p_input->>'enrollment_id')::uuid) DESC,candidate.id
       LIMIT 1
     ) r ON true
     WHERE o.status<>'cancelled'
       AND public.can_access_class_session(s.id,'teaching.occurrences.read') AND public.can_access_class_session(s.id,'teaching.class_sessions.read')
       AND ((p_operation='route' AND o.occurrence_date IN (SELECT value::date FROM jsonb_array_elements_text(p_input->'dates')))
         OR (p_operation='route-linked' AND r.id IS NOT NULL AND EXISTS(
           SELECT 1 FROM public.enrollment_history_reports history
           WHERE history.linked_report_id=r.id
             AND (history.enrollment_id=(p_input->>'enrollment_id')::uuid
               OR history.id::text IN (SELECT jsonb_array_elements_text(p_input->'linked_history_ids')))
             AND r.id::text IN (SELECT jsonb_array_elements_text(p_input->'linked_report_ids'))
         )))
       AND (p_operation='route-linked' OR public.history_occurrence_eligible((p_input->>'enrollment_id')::uuid,o.id)
         OR (r.id IS NOT NULL AND public.history_occurrence_eligible(r.enrollment_id,o.id)))
       AND (p_input->>'cursor' IS NULL OR o.id>(p_input->>'cursor')::uuid)
     ORDER BY o.id LIMIT v_limit+1
    ) x;
    RETURN jsonb_build_object('items',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items-v_limit ELSE v_items END,'next_cursor',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items->(v_limit-1)->>'id' END);
  END IF;$new$;
  IF position(v_old IN v_definition)>0 THEN
    v_definition:=replace(v_definition,v_old,v_new);
  ELSIF position('IF p_operation IN (''route'',''route-linked'') THEN' IN v_definition)=0 THEN
    v_start:=strpos(v_definition,' IF p_operation=''route'' THEN');
    v_end:=strpos(v_definition,' IF p_operation IN (''list'',''detail'') THEN');
    IF v_start=0 OR v_end<=v_start THEN RAISE EXCEPTION 'EXTENSION_HISTORY_ROUTE_PATCH_FAILED'; END IF;
    v_new:=replace(' '||v_new,E'\n    ',E'\n   ');
    v_definition:=substring(v_definition FROM 1 FOR v_start-1)||v_new||E'\n'||substring(v_definition FROM v_end);
  END IF;
  EXECUTE v_definition;
END
$migration$;

-- The source identity wrapper uses the exact report selected in preview. This
-- keeps a corrected linked report attached to its source row even when the
-- report's anchor enrollment differs from the lesson entry being synchronized.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_start integer;
  v_end integer;
BEGIN
  v_definition := pg_get_functiondef('public.web_extension_workspace(uuid,text,text,jsonb)'::regprocedure);
  v_old := $old$SELECT * INTO v_report FROM public.occurrence_reports
            WHERE enrollment_id=(v_data->>'enrollment_id')::uuid AND class_occurrence_id=(v_meta->>'class_occurrence_id')::uuid;$old$;
  v_new := $new$IF v_meta->>'report_id' IS NOT NULL THEN
            SELECT * INTO v_report FROM public.occurrence_reports
              WHERE id=(v_meta->>'report_id')::uuid AND class_occurrence_id=(v_meta->>'class_occurrence_id')::uuid;
          ELSE
            SELECT * INTO v_report FROM public.occurrence_reports
              WHERE enrollment_id=(v_data->>'enrollment_id')::uuid AND class_occurrence_id=(v_meta->>'class_occurrence_id')::uuid;
          END IF;$new$;
  IF position('IF v_meta->>''report_id'' IS NOT NULL THEN' IN v_definition)>0 THEN
    NULL;
  ELSIF position(v_old IN v_definition)>0 THEN
    v_definition:=replace(v_definition,v_old,v_new);
  ELSE
    v_start:=strpos(v_definition,'SELECT * INTO v_report FROM public.occurrence_reports');
    v_end:=CASE WHEN v_start=0 THEN 0 ELSE v_start+strpos(substring(v_definition FROM v_start),';')-1 END;
    IF v_start=0 OR v_end<=v_start OR strpos(substring(v_definition FROM v_start+1),'SELECT * INTO v_report FROM public.occurrence_reports')>0 THEN RAISE EXCEPTION 'EXTENSION_SOURCE_IDENTITY_PATCH_FAILED'; END IF;
    v_definition:=substring(v_definition FROM 1 FOR v_start-1)||v_new||substring(v_definition FROM v_end+1);
  END IF;
  EXECUTE v_definition;
END
$migration$;

-- Reconciliation now treats lesson progress as an entry patch while keeping
-- attendance, comments and report identity shared at the occurrence level.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_start integer;
  v_end integer;
  v_insert text;
BEGIN
  v_definition := pg_get_functiondef('public.web_extension_workspace_before_stale_diagnostics(uuid,text,text,jsonb)'::regprocedure);

  v_old := $old$v_patch jsonb; v_value jsonb; v_field text; v_expected text; v_actual text;$old$;
  v_new := $new$v_patch jsonb; v_value jsonb; v_field text; v_expected text; v_actual text;
  v_entry_meta jsonb; v_entries jsonb; v_next_entries jsonb; v_entry jsonb; v_entry_data jsonb;
  v_entry_id uuid; v_expected_entry_id uuid; v_entry_found boolean; v_entry_changed boolean; v_current_value jsonb;
  v_target_course_id uuid; v_target_lesson_id uuid; v_primary_entry_id uuid;$new$;
  IF position('v_entry_meta jsonb;' IN v_definition)>0 THEN NULL;
  ELSIF position(v_old IN v_definition)>0 THEN v_definition:=replace(v_definition,v_old,v_new);
  ELSE RAISE EXCEPTION 'EXTENSION_HISTORY_ENTRY_DECLARATION_PATCH_FAILED'; END IF;

  v_old := $old$k NOT IN ('key','class_occurrence_id','include_fields','overwrite','include_internal')$old$;
  v_new := $new$k NOT IN ('key','class_occurrence_id','report_id','reconfirm_occurrence','lesson_entry','include_fields','overwrite','include_internal')$new$;
  IF position(v_old IN v_definition)>0 THEN v_definition:=replace(v_definition,v_old,v_new);
  ELSIF position($marker$k NOT IN ('key','class_occurrence_id','report_id','reconfirm_occurrence','lesson_entry','include_fields','overwrite','include_internal')$marker$ IN v_definition)=0 THEN RAISE EXCEPTION 'EXTENSION_HISTORY_ENTRY_METADATA_PATCH_FAILED'; END IF;

  v_old := $old$IF v_enrollment.id IS NULL OR v_occurrence.id IS NULL OR v_occurrence.occurrence_date<>(v_data->>'report_date')::date OR v_occurrence.status='cancelled'
       OR NOT public.history_occurrence_eligible(v_enrollment.id,v_occurrence.id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;$old$;
  v_new := $new$PERFORM public.assert_extension_history_reconciliation_target(
        (v_row->>'target_id')::uuid,(v_meta->>'report_id')::uuid,v_enrollment.id,v_occurrence.id,v_meta,v_data);
      IF v_enrollment.id IS NULL OR v_occurrence.id IS NULL OR v_occurrence.status='cancelled'
       OR (v_occurrence.occurrence_date<>(v_data->>'report_date')::date AND NOT (
         COALESCE((v_meta->>'reconfirm_occurrence')::boolean,false) AND v_meta->>'report_id' IS NOT NULL
         AND EXISTS(SELECT 1 FROM public.enrollment_history_reports history WHERE history.id=(v_row->>'target_id')::uuid AND history.linked_report_id=(v_meta->>'report_id')::uuid)
       ))
       OR (NOT (COALESCE((v_meta->>'reconfirm_occurrence')::boolean,false) AND v_meta->>'report_id' IS NOT NULL
         AND EXISTS(SELECT 1 FROM public.enrollment_history_reports history WHERE history.id=(v_row->>'target_id')::uuid AND history.linked_report_id=(v_meta->>'report_id')::uuid))
         AND NOT public.history_occurrence_eligible(v_enrollment.id,v_occurrence.id)
         AND NOT EXISTS(SELECT 1 FROM public.occurrence_reports candidate
           JOIN public.enrollments anchor ON anchor.id=candidate.enrollment_id
           JOIN public.courses anchor_course ON anchor_course.id=anchor.course_id
           JOIN public.courses target_course ON target_course.id=v_enrollment.course_id
           WHERE candidate.id=(v_meta->>'report_id')::uuid AND candidate.class_occurrence_id=v_occurrence.id
             AND anchor.student_id=v_enrollment.student_id AND anchor_course.teaching_id=target_course.teaching_id
             AND public.history_occurrence_eligible(anchor.id,v_occurrence.id))) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;$new$;
  IF position(v_old IN v_definition)>0 THEN v_definition:=replace(v_definition,v_old,v_new);
  ELSIF position('assert_extension_history_reconciliation_target' IN v_definition)=0 THEN
    v_start:=strpos(v_definition,'IF v_enrollment.id IS NULL OR v_occurrence.id IS NULL');
    v_old:=$old$THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;$old$;
    v_end:=CASE WHEN v_start=0 THEN 0 ELSE strpos(substring(v_definition FROM v_start),v_old) END;
    IF v_start=0 OR v_end=0 THEN RAISE EXCEPTION 'EXTENSION_HISTORY_OCCURRENCE_PATCH_FAILED'; END IF;
    v_end:=v_start+v_end+char_length(v_old)-2;
    v_definition:=substring(v_definition FROM 1 FOR v_start-1)||v_new||substring(v_definition FROM v_end+1);
  END IF;

  v_old := $old$SELECT * INTO v_report FROM public.occurrence_reports WHERE enrollment_id=v_enrollment.id AND class_occurrence_id=v_occurrence.id;$old$;
  v_new := $new$IF v_meta->>'report_id' IS NOT NULL THEN
       SELECT * INTO v_report FROM public.occurrence_reports WHERE id=(v_meta->>'report_id')::uuid AND class_occurrence_id=v_occurrence.id;
     ELSIF v_history.linked_report_id IS NOT NULL THEN
       SELECT * INTO v_report FROM public.occurrence_reports WHERE id=v_history.linked_report_id AND class_occurrence_id=v_occurrence.id;
     ELSE
       SELECT * INTO v_report FROM public.occurrence_reports candidate
       WHERE candidate.class_occurrence_id=v_occurrence.id AND (
         candidate.enrollment_id=v_enrollment.id
         OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(candidate.lesson_entries,'[]'::jsonb)) entry(value) WHERE entry.value->>'enrollment_id'=v_enrollment.id::text)
         OR EXISTS(SELECT 1 FROM public.enrollments anchor JOIN public.courses anchor_course ON anchor_course.id=anchor.course_id JOIN public.courses target_course ON target_course.id=v_enrollment.course_id
           WHERE anchor.id=candidate.enrollment_id AND anchor.student_id=v_enrollment.student_id AND anchor_course.teaching_id=target_course.teaching_id AND public.history_occurrence_eligible(anchor.id,v_occurrence.id))
       ) ORDER BY (candidate.enrollment_id=v_enrollment.id) DESC,candidate.id LIMIT 1;
     END IF;$new$;
  IF position('IF v_meta->>''report_id'' IS NOT NULL THEN' IN v_definition)>0 THEN NULL;
  ELSIF position(v_old IN v_definition)>0 THEN v_definition:=replace(v_definition,v_old,v_new);
  ELSE RAISE EXCEPTION 'EXTENSION_HISTORY_REPORT_SELECTION_PATCH_FAILED'; END IF;

  v_old := $old$v_patch:='{}'::jsonb;v_reconciliation:='[]'::jsonb;
    FOR v_field IN SELECT jsonb_array_elements_text(v_meta->'include_fields') LOOP
      IF v_field='class_notes' AND NOT COALESCE((v_meta->>'include_internal')::boolean,false) THEN CONTINUE; END IF;
      IF NOT v_data ? v_field THEN CONTINUE; END IF;
      v_value:=v_data->v_field;
      IF v_report.id IS NOT NULL AND to_jsonb(v_report)->v_field IS DISTINCT FROM v_value AND to_jsonb(v_report)->v_field IS NOT NULL AND to_jsonb(v_report)->>v_field<>'' AND NOT COALESCE(v_meta->'overwrite' ? v_field,false) THEN
        v_reconciliation:=v_reconciliation||jsonb_build_array(jsonb_build_object('field',v_field,'status','preserved'));
      ELSE
        v_patch:=v_patch||jsonb_build_object(v_field,v_value);
        v_reconciliation:=v_reconciliation||jsonb_build_array(jsonb_build_object('field',v_field,'status',CASE WHEN v_report.id IS NULL OR to_jsonb(v_report)->v_field IS DISTINCT FROM v_value THEN 'updated' ELSE 'unchanged' END));
      END IF;
    END LOOP;$old$;
  v_new := $new$v_patch:='{}'::jsonb;v_reconciliation:='[]'::jsonb;
    v_entry_meta:=v_meta->'lesson_entry';v_entries:=COALESCE(v_report.lesson_entries,'[]'::jsonb);v_entry_found:=false;v_entry_changed:=false;v_entry_id:=NULL;v_entry_data:=NULL;
    IF v_entry_meta IS NOT NULL THEN
      IF jsonb_typeof(v_entry_meta) IS DISTINCT FROM 'object'
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_entry_meta) key WHERE key NOT IN ('enrollment_id','course_id','lesson_id','entry_id'))
        OR (v_entry_meta->>'enrollment_id') IS DISTINCT FROM v_enrollment.id::text
        OR (v_entry_meta->>'course_id') IS DISTINCT FROM v_enrollment.course_id::text
        OR (v_entry_meta->>'lesson_id') IS NULL
        OR (v_data ? 'lesson_id' AND (v_data->>'lesson_id') IS DISTINCT FROM v_entry_meta->>'lesson_id')
        OR (v_entry_meta->>'entry_id' IS NOT NULL AND (v_entry_meta->>'entry_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'INVALID_REPORT_LESSON_ENTRY'; END IF;
      v_target_course_id:=(v_entry_meta->>'course_id')::uuid;v_target_lesson_id:=(v_entry_meta->>'lesson_id')::uuid;
      IF NOT EXISTS(SELECT 1 FROM public.lessons lesson WHERE lesson.id=v_target_lesson_id AND lesson.course_id=v_target_course_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
      IF v_entry_meta->>'entry_id' IS NOT NULL THEN v_expected_entry_id:=(v_entry_meta->>'entry_id')::uuid; ELSE v_expected_entry_id:=NULL; END IF;
      FOR v_entry IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
        IF v_entry->>'enrollment_id'=v_enrollment.id::text AND v_entry->>'course_id'=v_target_course_id::text AND v_entry->>'lesson_id'=v_target_lesson_id::text THEN
          v_entry_found:=true;v_entry_id:=(v_entry->>'id')::uuid;v_entry_data:=v_entry;
        END IF;
      END LOOP;
      IF (v_entry_found AND v_entry_id IS DISTINCT FROM v_expected_entry_id) OR (NOT v_entry_found AND v_expected_entry_id IS NOT NULL) THEN RAISE EXCEPTION 'PREVIEW_STALE'; END IF;
      IF NOT v_entry_found THEN
        v_entry_id:=gen_random_uuid();v_entry_data:=jsonb_build_object('id',v_entry_id,'enrollment_id',v_enrollment.id,'course_id',v_target_course_id,'lesson_id',v_target_lesson_id,'is_completed',false,'progress_letter',NULL);v_entry_changed:=true;
      END IF;
    END IF;
    FOR v_field IN SELECT jsonb_array_elements_text(v_meta->'include_fields') LOOP
      IF v_field='class_notes' AND NOT COALESCE((v_meta->>'include_internal')::boolean,false) THEN CONTINUE; END IF;
      IF v_entry_meta IS NOT NULL AND v_field IN ('lesson_id','is_completed','progress_letter') THEN
        IF v_field='lesson_id' THEN v_value:=to_jsonb(v_target_lesson_id); ELSE IF NOT v_data ? v_field THEN CONTINUE; END IF;v_value:=v_data->v_field; END IF;
        v_current_value:=v_entry_data->v_field;
        IF v_entry_found AND v_current_value IS DISTINCT FROM v_value AND v_current_value IS NOT NULL AND v_current_value<>'null'::jsonb AND v_current_value #>> '{}'<>'' AND NOT COALESCE(v_meta->'overwrite' ? v_field,false) THEN
          v_reconciliation:=v_reconciliation||jsonb_build_array(jsonb_build_object('field',v_field,'status','preserved'));
        ELSE
          IF v_current_value IS DISTINCT FROM v_value THEN v_entry_changed:=true; END IF;
          v_entry_data:=v_entry_data||jsonb_build_object(v_field,v_value);
          v_reconciliation:=v_reconciliation||jsonb_build_array(jsonb_build_object('field',v_field,'status',CASE WHEN v_current_value IS DISTINCT FROM v_value THEN 'updated' ELSE 'unchanged' END));
        END IF;
        CONTINUE;
      END IF;
      IF NOT v_data ? v_field THEN CONTINUE; END IF;
      v_value:=v_data->v_field;
      IF v_report.id IS NOT NULL AND to_jsonb(v_report)->v_field IS DISTINCT FROM v_value AND to_jsonb(v_report)->v_field IS NOT NULL AND to_jsonb(v_report)->>v_field<>'' AND NOT COALESCE(v_meta->'overwrite' ? v_field,false) THEN
        v_reconciliation:=v_reconciliation||jsonb_build_array(jsonb_build_object('field',v_field,'status','preserved'));
      ELSE
        v_patch:=v_patch||jsonb_build_object(v_field,v_value);
        v_reconciliation:=v_reconciliation||jsonb_build_array(jsonb_build_object('field',v_field,'status',CASE WHEN v_report.id IS NULL OR to_jsonb(v_report)->v_field IS DISTINCT FROM v_value THEN 'updated' ELSE 'unchanged' END));
      END IF;
    END LOOP;$new$;
  IF position(v_old IN v_definition)>0 THEN v_definition:=replace(v_definition,v_old,v_new);
  ELSIF position('IF v_entry_meta IS NOT NULL AND v_entry_changed THEN' IN v_definition)=0 THEN
    v_start:=strpos(v_definition,'v_patch:=''{}''::jsonb;v_reconciliation:=''[]''::jsonb;');
    v_end:=CASE WHEN v_start=0 THEN 0 ELSE strpos(substring(v_definition FROM v_start),'v_version_key:=''history_reconciliation:''||v_source_id;') END;
    IF v_start=0 OR v_end=0 THEN RAISE EXCEPTION 'EXTENSION_HISTORY_ENTRY_PATCH_FAILED'; END IF;
    v_definition:=substring(v_definition FROM 1 FOR v_start-1)||v_new||E'\n'||substring(v_definition FROM v_start+v_end-1);
  END IF;

  v_old := $old$    END LOOP;
    v_version_key:='history_reconciliation:'||v_source_id;$old$;
  v_new := $new$    END LOOP;
    IF v_entry_meta IS NOT NULL AND v_entry_changed THEN
      v_next_entries:='[]'::jsonb;
      FOR v_entry IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
        IF v_entry->>'id'=v_entry_id::text THEN v_next_entries:=v_next_entries||jsonb_build_array(v_entry_data);
        ELSE v_next_entries:=v_next_entries||jsonb_build_array(v_entry); END IF;
      END LOOP;
      IF NOT v_entry_found THEN v_next_entries:=v_next_entries||jsonb_build_array(v_entry_data); END IF;
      v_primary_entry_id:=v_report.primary_lesson_entry_id;
      IF v_primary_entry_id IS NULL THEN v_primary_entry_id:=v_entry_id; END IF;
      v_patch:=v_patch||jsonb_build_object('lesson_entries',v_next_entries,'primary_lesson_entry_id',v_primary_entry_id);
    END IF;
    v_version_key:='history_reconciliation:'||v_source_id;$new$;
  IF position(v_old IN v_definition)>0 THEN v_definition:=replace(v_definition,v_old,v_new);
  ELSIF position('IF v_entry_meta IS NOT NULL AND v_entry_changed THEN' IN v_definition)=0 THEN
    v_start:=strpos(v_definition,'v_version_key:=''history_reconciliation:''||v_source_id;');
    v_end:=strpos(v_new,'IF v_entry_meta IS NOT NULL AND v_entry_changed THEN');
    IF v_start=0 OR v_end=0 THEN RAISE EXCEPTION 'EXTENSION_HISTORY_ENTRY_LIFECYCLE_PATCH_FAILED'; END IF;
    v_insert:=substring(v_new FROM v_end FOR strpos(v_new,'v_version_key:=''history_reconciliation:''||v_source_id;')-v_end);
    v_definition:=substring(v_definition FROM 1 FOR v_start-1)||v_insert||E'\n    '||substring(v_definition FROM v_start);
  END IF;

  EXECUTE v_definition;
END
$migration$;

-- The stale-diagnostics wrapper runs before the entry-aware reconciliation
-- wrapper. Keep its authorization and optimistic-version preflight aligned
-- with the selected report and lesson entry, including an explicitly
-- reconfirmed source report whose occurrence was corrected after linking.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_start integer;
  v_end integer;
BEGIN
  v_definition := pg_get_functiondef('public.web_extension_workspace_before_stale_diagnostics(uuid,text,text,jsonb)'::regprocedure);

  v_old := $old$('key','class_occurrence_id','include_fields','overwrite','include_internal')$old$;
  v_new := $new$('key','class_occurrence_id','report_id','reconfirm_occurrence','lesson_entry','include_fields','overwrite','include_internal')$new$;
  IF position(v_old IN v_definition)>0 THEN v_definition:=replace(v_definition,v_old,v_new);
  ELSIF position($marker$k NOT IN ('key','class_occurrence_id','report_id','reconfirm_occurrence','lesson_entry','include_fields','overwrite','include_internal')$marker$ IN v_definition)=0 THEN RAISE EXCEPTION 'EXTENSION_HISTORY_PREFLIGHT_METADATA_PATCH_FAILED'; END IF;

  v_old := $old$IF v_check_enrollment.id IS NULL OR v_check_occurrence.id IS NULL
        OR v_check_occurrence.occurrence_date<>(v_check_data->>'report_date')::date
        OR v_check_occurrence.status='cancelled'
        OR NOT public.history_occurrence_eligible(v_check_enrollment.id,v_check_occurrence.id)
        OR NOT public.can_access_enrollment(v_check_enrollment.id,'teaching.enrollments.read')
        OR NOT public.can_access_class_session(v_check_occurrence.class_session_id,'teaching.occurrences.read') THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;$old$;
  v_new := $new$PERFORM public.assert_extension_history_reconciliation_target(
         (v_check_row->>'target_id')::uuid,(v_check_meta->>'report_id')::uuid,v_check_enrollment.id,v_check_occurrence.id,v_check_meta,v_check_data);
       IF v_check_enrollment.id IS NULL OR v_check_occurrence.id IS NULL
        OR v_check_occurrence.status='cancelled'
        OR (v_check_occurrence.occurrence_date<>(v_check_data->>'report_date')::date AND NOT (
          COALESCE((v_check_meta->>'reconfirm_occurrence')::boolean,false)
          AND v_check_meta->>'report_id' IS NOT NULL
          AND EXISTS(SELECT 1 FROM public.enrollment_history_reports history WHERE history.id=(v_check_row->>'target_id')::uuid AND history.linked_report_id=(v_check_meta->>'report_id')::uuid)
        ))
        OR (NOT (COALESCE((v_check_meta->>'reconfirm_occurrence')::boolean,false)
          AND v_check_meta->>'report_id' IS NOT NULL
          AND EXISTS(SELECT 1 FROM public.enrollment_history_reports history WHERE history.id=(v_check_row->>'target_id')::uuid AND history.linked_report_id=(v_check_meta->>'report_id')::uuid))
          AND NOT public.history_occurrence_eligible(v_check_enrollment.id,v_check_occurrence.id)
          AND NOT EXISTS (
            SELECT 1 FROM public.occurrence_reports candidate
            JOIN public.enrollments anchor ON anchor.id=candidate.enrollment_id
            JOIN public.courses anchor_course ON anchor_course.id=anchor.course_id
            JOIN public.courses target_course ON target_course.id=v_check_enrollment.course_id
            WHERE candidate.id=(v_check_meta->>'report_id')::uuid
              AND candidate.class_occurrence_id=v_check_occurrence.id
              AND anchor.student_id=v_check_enrollment.student_id
              AND anchor_course.teaching_id=target_course.teaching_id
              AND public.history_occurrence_eligible(anchor.id,v_check_occurrence.id)
          ))
        OR NOT public.can_access_enrollment(v_check_enrollment.id,'teaching.enrollments.read')
        OR NOT public.can_access_class_session(v_check_occurrence.class_session_id,'teaching.occurrences.read') THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;$new$;
  IF position(v_old IN v_definition)>0 THEN v_definition:=replace(v_definition,v_old,v_new);
  ELSIF position('COALESCE((v_check_meta->>''reconfirm_occurrence'')::boolean,false)' IN v_definition)=0 THEN
    v_start:=strpos(v_definition,'IF v_check_enrollment.id IS NULL OR v_check_occurrence.id IS NULL');
    v_old:=$old$THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;$old$;
    v_end:=CASE WHEN v_start=0 THEN 0 ELSE strpos(substring(v_definition FROM v_start),v_old) END;
    IF v_start=0 OR v_end=0 THEN RAISE EXCEPTION 'EXTENSION_HISTORY_PREFLIGHT_OCCURRENCE_PATCH_FAILED'; END IF;
    v_end:=v_start+v_end+char_length(v_old)-2;
    v_definition:=substring(v_definition FROM 1 FOR v_start-1)||v_new||substring(v_definition FROM v_end+1);
  END IF;

  v_old := $old$      SELECT * INTO v_check_report FROM public.occurrence_reports WHERE enrollment_id=v_check_enrollment.id AND class_occurrence_id=v_check_occurrence.id FOR UPDATE;$old$;
  v_new := $new$      IF v_check_meta->>'report_id' IS NOT NULL THEN
        SELECT * INTO v_check_report FROM public.occurrence_reports
        WHERE id=(v_check_meta->>'report_id')::uuid AND class_occurrence_id=v_check_occurrence.id FOR UPDATE;
      ELSIF v_check_history.linked_report_id IS NOT NULL THEN
        SELECT * INTO v_check_report FROM public.occurrence_reports
        WHERE id=v_check_history.linked_report_id AND class_occurrence_id=v_check_occurrence.id FOR UPDATE;
      ELSE
        SELECT * INTO v_check_report FROM public.occurrence_reports WHERE enrollment_id=v_check_enrollment.id AND class_occurrence_id=v_check_occurrence.id FOR UPDATE;
      END IF;$new$;
  IF position('IF v_check_meta->>''report_id'' IS NOT NULL THEN' IN v_definition)>0 THEN NULL;
  ELSIF position(v_old IN v_definition)>0 THEN v_definition:=replace(v_definition,v_old,v_new);
  ELSE RAISE EXCEPTION 'EXTENSION_HISTORY_PREFLIGHT_REPORT_PATCH_FAILED'; END IF;

  EXECUTE v_definition;
END
$migration$;

-- A source enrollment can be represented by a lesson entry in a shared report
-- anchored to another enrollment. Re-sync is allowed only for that exact
-- linked report and entry, and only when both enrollments belong to the same
-- student and teaching.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition:=pg_get_functiondef('public.validate_enrollment_history(jsonb,jsonb,public.web_extension_import_jobs,jsonb)'::regprocedure);
  v_old:=$old$v_same_link:=EXISTS(SELECT 1 FROM public.occurrence_reports r WHERE r.id=existing.linked_report_id AND r.enrollment_id=existing.enrollment_id AND r.class_occurrence_id=(p_row->'history_reconciliation'->>'class_occurrence_id')::uuid);$old$;
  v_new:=$new$v_same_link:=public.assert_extension_history_reconciliation_target(
     existing.id,existing.linked_report_id,(p_data->>'enrollment_id')::uuid,
     (p_row->'history_reconciliation'->>'class_occurrence_id')::uuid,
     p_row->'history_reconciliation',p_data);$new$;
  IF position(v_old IN v_definition)>0 THEN v_definition:=replace(v_definition,v_old,v_new);
  ELSIF position(v_new IN v_definition)=0 THEN RAISE EXCEPTION 'EXTENSION_HISTORY_LINK_VALIDATOR_PATCH_FAILED'; END IF;
  EXECUTE v_definition;
END
$migration$;

COMMIT;
