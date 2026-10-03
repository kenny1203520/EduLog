BEGIN;

-- Import status is operational metadata. Keep it separate from the verified
-- batch checkpoint so a caller cannot mark unwritten batches as completed.
CREATE OR REPLACE FUNCTION public.web_extension_import_info(
  p_token_id uuid, p_token_hash text, p_operation text, p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid; v_job public.web_extension_import_jobs; v_date date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation <> 'info' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  SELECT * INTO v_job FROM public.web_extension_import_jobs
    WHERE id=(p_input->>'job_id')::uuid AND user_id=v_user;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT public.can_access_classroom(v_job.classroom_id,'teaching.classrooms.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_date := COALESCE((p_input->>'roster_date')::date, (now() AT TIME ZONE 'Asia/Taipei')::date);

  RETURN jsonb_build_object(
    'job', jsonb_build_object('id',v_job.id,'status',v_job.status,'source_class_id',v_job.source_class_id,
      'classroom_id',v_job.classroom_id,'class_session_id',v_job.class_session_id,
      'created_at',v_job.created_at,'updated_at',v_job.updated_at,'counts',v_job.counts),
    'batches', COALESCE((SELECT jsonb_agg(jsonb_build_object('key',b.batch_key,'status',b.status,
      'applied',COALESCE((b.result->>'applied')::integer,0),'counts',COALESCE(b.result->'counts','{}'::jsonb)) ORDER BY b.created_at,b.batch_key)
      FROM public.web_extension_import_batches b WHERE b.job_id=v_job.id),'[]'::jsonb),
    'roster_date',v_date,
    'roster', public.get_class_session_workspace(v_job.class_session_id,v_date)
  );
END $$;

CREATE OR REPLACE FUNCTION public.web_extension_finalize_import(
  p_token_id uuid, p_token_hash text, p_operation text, p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid; v_job public.web_extension_import_jobs; v_expected uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation <> 'complete' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  SELECT * INTO v_job FROM public.web_extension_import_jobs
    WHERE id=(p_input->>'job_id')::uuid AND user_id=v_user FOR UPDATE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT public.can_access_classroom(v_job.classroom_id,'teaching.classrooms.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT array_agg(value::uuid) INTO v_expected FROM jsonb_array_elements_text(p_input->'expected_batch_keys');
  IF v_expected IS NULL OR cardinality(v_expected)=0 OR
     cardinality(v_expected)<>(SELECT count(*) FROM public.web_extension_import_batches WHERE job_id=v_job.id) OR
     EXISTS(SELECT 1 FROM public.web_extension_import_batches b WHERE b.job_id=v_job.id AND (b.status<>'applied' OR NOT b.batch_key=ANY(v_expected))) THEN
    RAISE EXCEPTION 'IMPORT_BATCHES_INCOMPLETE';
  END IF;
  IF v_job.status='cancelled' THEN RAISE EXCEPTION 'JOB_STOPPED'; END IF;
  UPDATE public.web_extension_import_jobs SET status='complete',updated_at=now() WHERE id=v_job.id;
  RETURN jsonb_build_object('status','complete','verified',true,'batch_count',cardinality(v_expected),
    'applied_rows',COALESCE((SELECT sum((b.result->>'applied')::integer) FROM public.web_extension_import_batches b WHERE b.job_id=v_job.id),0));
END $$;

CREATE OR REPLACE FUNCTION public.web_extension_enrollment_info(
  p_token_id uuid, p_token_hash text, p_operation text, p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid; v_row jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation <> 'enrollment-info' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  SELECT jsonb_build_object('id',e.id,'student_id',e.student_id,'student_name',s.name,
      'course_id',e.course_id,'course_name',c.display_name,'class_session_id',e.class_session_id,
      'class_name',cs.name,'start_date',e.start_date,'status',e.status)
    INTO v_row FROM public.enrollments e
    JOIN public.students s ON s.id=e.student_id
    JOIN public.courses c ON c.id=e.course_id
    JOIN public.class_sessions cs ON cs.id=e.class_session_id
    WHERE e.id=(p_input->>'enrollment_id')::uuid AND public.can_access_enrollment(e.id,'teaching.enrollments.read');
  IF v_row IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.web_extension_import_info(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.web_extension_finalize_import(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.web_extension_enrollment_info(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.web_extension_import_info(uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.web_extension_finalize_import(uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.web_extension_enrollment_info(uuid,text,text,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
