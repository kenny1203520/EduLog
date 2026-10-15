BEGIN;
CREATE OR REPLACE FUNCTION public.web_extension_memory(p_operation text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_user uuid:=auth.uid(); v_origin text:='https://corp.orangeapple.co'; v_class text:=p_input->>'source_class_id';
  v_ref jsonb; v_item jsonb; v_target jsonb; v_relation jsonb; v_link public.web_extension_source_links;
  v_memory public.web_extension_mapping_memory; v_kind text; v_key text; v_scope text; v_plural text;
  v_id uuid; v_revision text; v_reason text; v_valid boolean; v_ids uuid[]; v_versions jsonb;
  v_links jsonb:='[]'; v_targets jsonb:='[]'; v_memories jsonb:='[]'; v_results jsonb:='[]'; v_count integer;
  v_accessible boolean; v_relation_valid boolean; v_identity_compatible boolean; v_student_compatible boolean; v_course_compatible boolean;
  v_old_identity jsonb; v_new_identity jsonb; v_old_student text; v_new_student text; v_old_course text; v_new_course text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_user IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_operation='resolve' THEN
    IF jsonb_typeof(p_input->'source_refs')<>'array' OR jsonb_array_length(p_input->'source_refs')>50 OR jsonb_typeof(p_input->'target_refs')<>'array' OR jsonb_array_length(p_input->'target_refs')>50 OR jsonb_array_length(COALESCE(p_input->'memory_refs','[]'))>50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(p_input->'source_refs') LOOP
      v_kind:=v_ref->>'source_kind';v_key:=v_ref->>'source_id';v_id:=NULL;v_revision:=NULL;v_reason:='remembered';
      v_plural:=CASE v_kind WHEN 'student' THEN 'students' WHEN 'course' THEN 'courses' WHEN 'classroom' THEN 'classrooms' WHEN 'class_session' THEN 'class_sessions' WHEN 'enrollment' THEN 'enrollments' WHEN 'occurrence' THEN 'occurrences' WHEN 'report' THEN 'report_targets' END;
      IF v_plural IS NULL OR length(v_key) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
      SELECT * INTO v_link FROM public.web_extension_source_links WHERE user_id=v_user AND source_origin=v_origin AND source_kind=v_kind AND source_id=v_key;
      IF v_link.id IS NOT NULL THEN v_id:=v_link.edulog_id;v_revision:=v_link.updated_at::text;
        SELECT * INTO v_memory FROM public.web_extension_mapping_memory WHERE user_id=v_user AND source_origin=v_origin AND kind=v_kind AND source_key=v_key AND scope_key='';
        IF v_memory.revision IS NOT NULL THEN v_revision:=v_memory.revision::text; END IF;
      ELSIF v_kind IN ('student','class_session','enrollment') THEN
        IF v_kind='student' THEN SELECT array_agg(id) INTO v_ids FROM public.students WHERE external_link=v_origin||'/students/'||v_key AND public.can_access_student(id,'teaching.students.read');
        ELSIF v_kind='class_session' THEN SELECT array_agg(id) INTO v_ids FROM public.class_sessions WHERE external_link=v_origin||'/courses/dt/'||v_key AND public.can_access_class_session(id,'teaching.class_sessions.read');
        ELSE SELECT array_agg(id) INTO v_ids FROM public.enrollments WHERE external_link=v_origin||'/dt_admissions/'||v_key AND public.can_access_enrollment(id,'teaching.enrollments.read'); END IF;
        IF cardinality(v_ids)=1 THEN v_id:=v_ids[1];v_reason:='external_link'; END IF;
      END IF;
      IF v_id IS NULL THEN CONTINUE; END IF;
      v_target:=public.web_extension_memory_target(v_plural,v_id);v_valid:=v_target IS NOT NULL;
      v_links:=v_links||jsonb_build_array(jsonb_build_object('source_origin',v_origin,'source_kind',v_kind,'source_id',v_key,'target_id',CASE WHEN v_valid THEN v_id END,'valid',v_valid,'reason',CASE WHEN v_valid THEN v_reason ELSE 'target_unavailable' END,'revision',v_revision));
      IF v_valid THEN v_targets:=v_targets||jsonb_build_array(v_target); END IF;
    END LOOP;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(p_input->'target_refs') LOOP
      v_target:=public.web_extension_memory_target(v_ref->>'kind',(v_ref->>'id')::uuid);
      IF v_target IS NOT NULL THEN v_targets:=v_targets||jsonb_build_array(v_target); END IF;
    END LOOP;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(COALESCE(p_input->'memory_refs','[]')) LOOP
      v_kind:=v_ref->>'kind';v_key:=v_ref->>'key';
      IF v_kind NOT IN ('course_rule','admission','classroom') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
      FOR v_memory IN SELECT * FROM public.web_extension_mapping_memory WHERE user_id=v_user AND source_origin=v_origin AND kind=v_kind AND source_key=v_key ORDER BY (source_class_id IS NOT DISTINCT FROM v_class) DESC,updated_at DESC LIMIT 5 LOOP
        v_versions:='{}';v_valid:=true;v_accessible:=true;v_relation_valid:=true;v_identity_compatible:=false;v_reason:='valid';
        FOR v_plural,v_id IN SELECT * FROM (VALUES(CASE WHEN v_kind='course_rule' THEN 'courses' WHEN v_kind='classroom' THEN 'classrooms' ELSE 'enrollments' END,v_memory.target_id),('students',v_memory.student_id),('courses',v_memory.course_id),('class_sessions',v_memory.class_session_id)) t(kind,id) WHERE id IS NOT NULL LOOP
          v_target:=public.web_extension_memory_target(v_plural,v_id);
          IF v_target IS NULL THEN v_valid:=false;v_accessible:=false;v_reason:='target_unavailable';
          ELSE v_targets:=v_targets||jsonb_build_array(v_target);v_versions:=v_versions||jsonb_build_object(v_id::text,v_target->>'target_version'); END IF;
        END LOOP;
        IF v_kind='admission' AND v_memory.target_id IS NOT NULL AND v_accessible THEN
          v_relation:=public.web_extension_memory_target('enrollments',v_memory.target_id);
          v_relation_valid:=v_relation->>'student_id'=v_memory.student_id::text AND v_relation->>'course_id'=v_memory.course_id::text AND v_relation->>'class_session_id'=v_memory.class_session_id::text;
          IF NOT v_relation_valid THEN v_valid:=false;v_reason:='target_relationship_changed'; END IF;
        END IF;
        IF v_kind='admission' AND v_ref->>'source_identity' IS NOT NULL AND v_memory.source_identity IS DISTINCT FROM v_ref->>'source_identity' THEN
          v_valid:=false;IF v_accessible AND v_relation_valid THEN v_reason:='source_identity_changed'; END IF;
          IF v_accessible AND v_relation_valid THEN
            BEGIN
              v_old_identity:=v_memory.source_identity::jsonb;v_new_identity:=(v_ref->>'source_identity')::jsonb;
            EXCEPTION WHEN others THEN v_old_identity:=NULL;v_new_identity:=NULL;
            END;
            IF jsonb_typeof(v_old_identity)='array' AND jsonb_typeof(v_new_identity)='array' AND
               (CASE WHEN jsonb_typeof(v_old_identity)='array' THEN jsonb_array_length(v_old_identity) ELSE -1 END)=2 AND
               (CASE WHEN jsonb_typeof(v_new_identity)='array' THEN jsonb_array_length(v_new_identity) ELSE -1 END)=2 THEN
              v_old_student:=nullif(v_old_identity->>0,'');v_new_student:=nullif(v_new_identity->>0,'');v_old_course:=v_old_identity->>1;v_new_course:=v_new_identity->>1;
              v_student_compatible:=v_old_student IS NOT DISTINCT FROM v_new_student;
              IF NOT v_student_compatible AND v_old_student IS NULL AND v_new_student IS NOT NULL THEN
                v_student_compatible:=EXISTS(SELECT 1 FROM public.web_extension_source_links l WHERE l.user_id=v_user AND l.source_origin=v_origin AND l.source_kind='student' AND l.source_id=v_new_student AND l.edulog_id=v_memory.student_id) OR
                  EXISTS(SELECT 1 FROM public.students s WHERE s.id=v_memory.student_id AND s.external_link=v_origin||'/students/'||v_new_student AND public.can_access_student(s.id,'teaching.students.read'));
              END IF;
              v_course_compatible:=v_old_course IS NOT DISTINCT FROM v_new_course;
              IF NOT v_course_compatible AND v_old_course LIKE 'label:%' AND v_new_course LIKE 'code:%' AND
                 regexp_replace(trim(substr(v_old_course,7)),'\s+',' ','g')=regexp_replace(trim(COALESCE(v_ref->>'source_course_label','')),'\s+',' ','g') AND
                 EXISTS(SELECT 1 FROM public.web_extension_source_links l WHERE l.user_id=v_user AND l.source_origin=v_origin AND l.source_kind='course' AND l.source_id=v_ref->>'source_course_id' AND l.edulog_id=v_memory.course_id) THEN v_course_compatible:=true; END IF;
              v_identity_compatible:=v_student_compatible AND v_course_compatible;
            END IF;
          END IF;
          IF v_identity_compatible THEN
            UPDATE public.web_extension_mapping_memory SET source_identity=v_ref->>'source_identity',revision=gen_random_uuid(),updated_at=now()
              WHERE user_id=v_memory.user_id AND source_origin=v_memory.source_origin AND kind=v_memory.kind AND source_key=v_memory.source_key AND scope_key=v_memory.scope_key RETURNING * INTO v_memory;
            v_valid:=true;v_reason:='identity_enriched';
          END IF;
        END IF;
        v_memories:=v_memories||jsonb_build_array(jsonb_build_object('kind',v_kind,'key',v_key,'source_class_id',v_memory.source_class_id,'source_identity',v_memory.source_identity,'target_id',CASE WHEN v_valid THEN v_memory.target_id END,'student_id',CASE WHEN v_valid THEN v_memory.student_id END,'course_id',CASE WHEN v_valid THEN v_memory.course_id END,'class_session_id',CASE WHEN v_valid THEN v_memory.class_session_id END,'revision',v_memory.revision,'valid',v_valid,'reason',v_reason,'suggestion',v_kind='course_rule' AND v_memory.source_class_id IS DISTINCT FROM v_class,'versions',v_versions));
      END LOOP;
    END LOOP;
    RETURN jsonb_build_object('source_links',v_links,'targets',v_targets,'memories',v_memories);
  END IF;
  IF p_operation<>'memory-confirm' OR p_input->>'source_origin' IS DISTINCT FROM v_origin OR jsonb_typeof(p_input->'items')<>'array' OR jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_input->'items') LOOP
    v_kind:=v_item->>'kind';v_key:=v_item->>'key';v_scope:=CASE WHEN v_kind='course_rule' THEN v_class ELSE '' END;
    IF v_kind NOT IN ('student','course','class_session','classroom','enrollment','admission','course_rule') OR length(v_key) NOT BETWEEN 1 AND (CASE WHEN v_kind='course_rule' THEN 512 ELSE 256 END) OR v_class IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text||v_origin||v_kind||v_key||v_scope,0));
    SELECT * INTO v_memory FROM public.web_extension_mapping_memory WHERE user_id=v_user AND source_origin=v_origin AND kind=v_kind AND source_key=v_key AND scope_key=v_scope FOR UPDATE;
    v_revision:=v_memory.revision::text;
    IF v_revision IS NULL AND v_kind IN ('student','course','class_session','enrollment') THEN SELECT updated_at::text INTO v_revision FROM public.web_extension_source_links WHERE user_id=v_user AND source_origin=v_origin AND source_kind=v_kind AND source_id=v_key FOR UPDATE; END IF;
    IF v_item->>'expected_revision' IS DISTINCT FROM v_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    IF v_item->>'action'='clear' THEN
      DELETE FROM public.web_extension_mapping_memory WHERE user_id=v_user AND source_origin=v_origin AND kind=v_kind AND source_key=v_key AND scope_key=v_scope;
      DELETE FROM public.web_extension_source_links WHERE user_id=v_user AND source_origin=v_origin AND source_kind=CASE WHEN v_kind='admission' THEN 'enrollment' ELSE v_kind END AND source_id=v_key;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('kind',v_kind,'key',v_key,'cleared',true));CONTINUE;
    END IF;
    IF v_item->>'action'<>'confirm' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    v_versions:=COALESCE(v_item->'versions','{}');v_count:=0;
    FOR v_plural,v_id IN SELECT * FROM (VALUES(CASE v_kind WHEN 'course_rule' THEN 'courses' WHEN 'course' THEN 'courses' WHEN 'student' THEN 'students' WHEN 'class_session' THEN 'class_sessions' WHEN 'classroom' THEN 'classrooms' ELSE 'enrollments' END,NULLIF(v_item->>'target_id','')::uuid),('students',NULLIF(v_item->>'student_id','')::uuid),('courses',NULLIF(v_item->>'course_id','')::uuid),('class_sessions',NULLIF(v_item->>'class_session_id','')::uuid)) t(kind,id) WHERE id IS NOT NULL LOOP
      v_target:=public.web_extension_memory_target(v_plural,v_id);v_count:=v_count+1;
      IF v_target IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
      IF v_versions->>v_id::text IS DISTINCT FROM v_target->>'target_version' THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    END LOOP;
    IF v_count=0 OR (v_kind<>'admission' AND v_item->>'target_id' IS NULL) OR (v_kind='admission' AND (v_item->>'student_id' IS NULL OR v_item->>'course_id' IS NULL OR v_item->>'class_session_id' IS NULL)) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF v_kind='admission' AND v_item->>'target_id' IS NOT NULL THEN
      v_relation:=public.web_extension_memory_target('enrollments',(v_item->>'target_id')::uuid);
      IF v_relation->>'student_id' IS DISTINCT FROM v_item->>'student_id' OR v_relation->>'course_id' IS DISTINCT FROM v_item->>'course_id' OR v_relation->>'class_session_id' IS DISTINCT FROM v_item->>'class_session_id' THEN RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT'; END IF;
    END IF;
    IF v_kind='admission' AND NOT EXISTS(SELECT 1 FROM public.class_sessions s JOIN public.courses c ON c.id=(v_item->>'course_id')::uuid WHERE s.id=(v_item->>'class_session_id')::uuid AND s.teaching_id=c.teaching_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    INSERT INTO public.web_extension_mapping_memory(user_id,source_origin,kind,source_key,scope_key,source_class_id,source_identity,target_id,student_id,course_id,class_session_id)
      VALUES(v_user,v_origin,v_kind,v_key,v_scope,v_class,v_item->>'source_identity',NULLIF(v_item->>'target_id','')::uuid,NULLIF(v_item->>'student_id','')::uuid,NULLIF(v_item->>'course_id','')::uuid,NULLIF(v_item->>'class_session_id','')::uuid)
      ON CONFLICT(user_id,source_origin,kind,source_key,scope_key) DO UPDATE SET target_id=EXCLUDED.target_id,student_id=EXCLUDED.student_id,course_id=EXCLUDED.course_id,class_session_id=EXCLUDED.class_session_id,source_identity=EXCLUDED.source_identity,source_class_id=EXCLUDED.source_class_id,revision=gen_random_uuid(),updated_at=now() RETURNING * INTO v_memory;
    IF v_kind IN ('student','course','class_session','enrollment','admission') AND v_memory.target_id IS NOT NULL THEN
      INSERT INTO public.web_extension_source_links(user_id,source_origin,source_kind,source_id,edulog_id) VALUES(v_user,v_origin,CASE WHEN v_kind='admission' THEN 'enrollment' ELSE v_kind END,v_key,v_memory.target_id)
        ON CONFLICT(user_id,source_origin,source_kind,source_id) DO UPDATE SET edulog_id=EXCLUDED.edulog_id,updated_at=now();
    END IF;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('kind',v_kind,'key',v_key,'revision',v_memory.revision));
  END LOOP;
  RETURN jsonb_build_object('items',v_results);
END $$;
REVOKE ALL ON FUNCTION public.web_extension_memory(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
