BEGIN;

CREATE TABLE public.web_extension_work_record_metadata (
  user_id uuid NOT NULL,
  work_id uuid NOT NULL,
  server_job_id uuid,
  source_origin text NOT NULL CHECK (source_origin = 'https://corp.orangeapple.co'),
  source_path text NOT NULL CHECK (source_path ~ '^/(courses/dt/[0-9]+|dt_admissions/[0-9]+|admissions/unfilled_report)$'),
  source_class_id text NOT NULL CHECK (length(source_class_id) BETWEEN 1 AND 100),
  source_label text NOT NULL DEFAULT '' CHECK (length(source_label) <= 160),
  target_classroom_id uuid,
  target_class_session_id uuid,
  target_label text NOT NULL DEFAULT '' CHECK (length(target_label) <= 160),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 100),
  source_device text NOT NULL DEFAULT '' CHECK (length(source_device) <= 80),
  pinned boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_id),
  UNIQUE (user_id, server_job_id),
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  FOREIGN KEY (server_job_id) REFERENCES public.web_extension_import_jobs(id) ON DELETE CASCADE
);

CREATE INDEX web_extension_work_record_metadata_recent
  ON public.web_extension_work_record_metadata(user_id, updated_at DESC, work_id DESC);

ALTER TABLE public.web_extension_work_record_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY web_extension_work_record_metadata_self
  ON public.web_extension_work_record_metadata USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.web_extension_work_record_metadata FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.web_extension_work_records(
  p_token_id uuid, p_token_hash text, p_operation text, p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_user uuid;
  v_item public.web_extension_work_record_metadata;
  v_job public.web_extension_import_jobs;
  v_changes jsonb;
  v_cursor timestamptz;
  v_cursor_id uuid;
  v_limit integer;
  v_items jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_user,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  IF p_operation='capabilities' THEN RETURN jsonb_build_object('work_records',true); END IF;
  IF p_operation='list' THEN
    v_limit:=LEAST(50,GREATEST(1,COALESCE((p_input->>'limit')::integer,50)));
    IF p_input->>'cursor' IS NOT NULL THEN
      v_cursor:=split_part(p_input->>'cursor','|',1)::timestamptz;
      v_cursor_id:=split_part(p_input->>'cursor','|',2)::uuid;
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC,x.work_id DESC),'[]'::jsonb)
      INTO v_items FROM (
        SELECT work_id,server_job_id,source_origin,source_path,source_class_id,source_label,
          target_classroom_id,target_class_session_id,target_label,title,source_device,pinned,
          archived_at,revision,updated_at
        FROM public.web_extension_work_record_metadata m
        WHERE m.user_id=v_user AND (v_cursor IS NULL OR (m.updated_at,m.work_id)<(v_cursor,v_cursor_id))
        ORDER BY m.updated_at DESC,m.work_id DESC LIMIT v_limit+1
      ) x;
    RETURN jsonb_build_object(
      'items',CASE WHEN jsonb_array_length(v_items)>v_limit THEN (SELECT jsonb_agg(value) FROM jsonb_array_elements(v_items) WITH ORDINALITY e(value,n) WHERE n<=v_limit) ELSE v_items END,
      'next_cursor',CASE WHEN jsonb_array_length(v_items)>v_limit THEN (v_items->(v_limit-1)->>'updated_at')||'|'||(v_items->(v_limit-1)->>'work_id') END
    );
  END IF;
  IF p_operation<>'patch' OR p_input->>'work_id' IS NULL OR jsonb_typeof(p_input->'changes') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  v_changes:=p_input->'changes';
  IF (v_changes - ARRAY['server_job_id','source_origin','source_path','source_class_id','source_label','target_classroom_id','target_class_session_id','target_label','title','source_device','pinned','archived_at']::text[])<>'{}'::jsonb
    OR (v_changes ? 'title' AND (jsonb_typeof(v_changes->'title')<>'string' OR length(v_changes->>'title')>100))
    OR (v_changes ? 'pinned' AND jsonb_typeof(v_changes->'pinned')<>'boolean')
    OR (v_changes ? 'archived_at' AND jsonb_typeof(v_changes->'archived_at') NOT IN ('string','null'))
    OR (v_changes ? 'source_origin' AND v_changes->>'source_origin'<>'https://corp.orangeapple.co')
    OR (v_changes ? 'source_path' AND (jsonb_typeof(v_changes->'source_path')<>'string' OR v_changes->>'source_path' !~ '^/(courses/dt/[0-9]+|dt_admissions/[0-9]+|admissions/unfilled_report)$'))
    OR (v_changes ? 'source_class_id' AND (jsonb_typeof(v_changes->'source_class_id')<>'string' OR length(v_changes->>'source_class_id') NOT BETWEEN 1 AND 100))
    OR (v_changes ? 'source_label' AND (jsonb_typeof(v_changes->'source_label')<>'string' OR length(v_changes->>'source_label')>160))
    OR (v_changes ? 'target_label' AND (jsonb_typeof(v_changes->'target_label')<>'string' OR length(v_changes->>'target_label')>160))
    OR (v_changes ? 'source_device' AND (jsonb_typeof(v_changes->'source_device')<>'string' OR length(v_changes->>'source_device')>80))
    OR (v_changes ? 'server_job_id' AND jsonb_typeof(v_changes->'server_job_id') NOT IN ('string','null'))
    OR (v_changes ? 'target_classroom_id' AND jsonb_typeof(v_changes->'target_classroom_id') NOT IN ('string','null'))
    OR (v_changes ? 'target_class_session_id' AND jsonb_typeof(v_changes->'target_class_session_id') NOT IN ('string','null')) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  IF v_changes ? 'server_job_id' AND v_changes->>'server_job_id' IS NOT NULL THEN
    SELECT * INTO v_job FROM public.web_extension_import_jobs WHERE id=(v_changes->>'server_job_id')::uuid AND user_id=v_user FOR SHARE;
    IF v_job.id IS NULL OR v_job.source_origin<>'https://corp.orangeapple.co' THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF v_job.source_class_id IS DISTINCT FROM COALESCE(v_changes->>'source_class_id',v_item.source_class_id)
      OR (v_changes ? 'target_classroom_id' AND NULLIF(v_changes->>'target_classroom_id','')::uuid IS DISTINCT FROM v_job.classroom_id)
      OR (v_changes ? 'target_class_session_id' AND NULLIF(v_changes->>'target_class_session_id','')::uuid IS DISTINCT FROM v_job.class_session_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
  END IF;
  SELECT * INTO v_item FROM public.web_extension_work_record_metadata WHERE user_id=v_user AND work_id=(p_input->>'work_id')::uuid FOR UPDATE;
  IF COALESCE(p_input->>'expected_revision','')<>COALESCE(v_item.revision::text,'') THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF v_item.work_id IS NULL AND (v_changes->>'source_path' IS NULL OR v_changes->>'source_class_id' IS NULL) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  INSERT INTO public.web_extension_work_record_metadata (
    user_id,work_id,server_job_id,source_origin,source_path,source_class_id,source_label,
    target_classroom_id,target_class_session_id,target_label,title,source_device,pinned,archived_at
  ) VALUES (
    v_user,(p_input->>'work_id')::uuid,
    NULLIF(v_changes->>'server_job_id','')::uuid,
    COALESCE(v_changes->>'source_origin',v_item.source_origin,'https://corp.orangeapple.co'),COALESCE(v_changes->>'source_path',v_item.source_path),COALESCE(v_changes->>'source_class_id',v_item.source_class_id),COALESCE(v_changes->>'source_label',v_item.source_label,''),
    COALESCE(NULLIF(v_changes->>'target_classroom_id','')::uuid,v_item.target_classroom_id),COALESCE(NULLIF(v_changes->>'target_class_session_id','')::uuid,v_item.target_class_session_id),COALESCE(v_changes->>'target_label',v_item.target_label,''),
    COALESCE(v_changes->>'title',v_item.title,''),COALESCE(v_changes->>'source_device',v_item.source_device,''),COALESCE((v_changes->>'pinned')::boolean,v_item.pinned,false),CASE WHEN v_changes ? 'archived_at' THEN NULLIF(v_changes->>'archived_at','')::timestamptz ELSE v_item.archived_at END
  ) ON CONFLICT(user_id,work_id) DO UPDATE SET
    server_job_id=CASE WHEN v_changes ? 'server_job_id' THEN NULLIF(v_changes->>'server_job_id','')::uuid ELSE web_extension_work_record_metadata.server_job_id END,
    source_origin=CASE WHEN v_changes ? 'source_origin' THEN v_changes->>'source_origin' ELSE web_extension_work_record_metadata.source_origin END,
    source_path=CASE WHEN v_changes ? 'source_path' THEN v_changes->>'source_path' ELSE web_extension_work_record_metadata.source_path END,
    source_class_id=CASE WHEN v_changes ? 'source_class_id' THEN v_changes->>'source_class_id' ELSE web_extension_work_record_metadata.source_class_id END,
    source_label=CASE WHEN v_changes ? 'source_label' THEN v_changes->>'source_label' ELSE web_extension_work_record_metadata.source_label END,
    target_classroom_id=CASE WHEN v_changes ? 'target_classroom_id' THEN NULLIF(v_changes->>'target_classroom_id','')::uuid ELSE web_extension_work_record_metadata.target_classroom_id END,
    target_class_session_id=CASE WHEN v_changes ? 'target_class_session_id' THEN NULLIF(v_changes->>'target_class_session_id','')::uuid ELSE web_extension_work_record_metadata.target_class_session_id END,
    target_label=CASE WHEN v_changes ? 'target_label' THEN v_changes->>'target_label' ELSE web_extension_work_record_metadata.target_label END,
    title=CASE WHEN v_changes ? 'title' THEN v_changes->>'title' ELSE web_extension_work_record_metadata.title END,
    source_device=CASE WHEN v_changes ? 'source_device' THEN v_changes->>'source_device' ELSE web_extension_work_record_metadata.source_device END,
    pinned=CASE WHEN v_changes ? 'pinned' THEN (v_changes->>'pinned')::boolean ELSE web_extension_work_record_metadata.pinned END,
    archived_at=CASE WHEN v_changes ? 'archived_at' THEN NULLIF(v_changes->>'archived_at','')::timestamptz ELSE web_extension_work_record_metadata.archived_at END,
    revision=gen_random_uuid(),updated_at=now()
  RETURNING * INTO v_item;
  RETURN jsonb_build_object('item',jsonb_build_object('work_id',v_item.work_id,'server_job_id',v_item.server_job_id,'source_origin',v_item.source_origin,'source_path',v_item.source_path,'source_class_id',v_item.source_class_id,'source_label',v_item.source_label,'target_classroom_id',v_item.target_classroom_id,'target_class_session_id',v_item.target_class_session_id,'target_label',v_item.target_label,'title',v_item.title,'source_device',v_item.source_device,'pinned',v_item.pinned,'archived_at',v_item.archived_at,'revision',v_item.revision,'updated_at',v_item.updated_at));
END $$;

REVOKE ALL ON FUNCTION public.web_extension_work_records(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_work_records(uuid,text,text,jsonb) TO service_role;

COMMIT;
