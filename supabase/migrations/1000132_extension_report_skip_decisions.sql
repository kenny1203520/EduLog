BEGIN;

CREATE TABLE public.web_extension_report_skip_decisions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_instance text NOT NULL CHECK (length(target_instance) BETWEEN 8 AND 300),
  source_origin text NOT NULL CHECK (source_origin = 'https://corp.orangeapple.co'),
  adapter_version text NOT NULL CHECK (adapter_version = 'orange-apple-v1'),
  source_admission_id text NOT NULL CHECK (source_admission_id ~ '^\d{1,40}$'),
  source_report_id text NOT NULL CHECK (source_report_id ~ '^\d{1,40}$'),
  content_fingerprint text NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  context_fingerprint text NOT NULL CHECK (context_fingerprint ~ '^[a-f0-9]{64}$'),
  field_fingerprints jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(field_fingerprints) = 'object'),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY (user_id,target_instance,source_origin,adapter_version,source_admission_id,source_report_id)
);

ALTER TABLE public.web_extension_report_skip_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY web_extension_report_skip_decisions_self ON public.web_extension_report_skip_decisions
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.web_extension_report_skip_decisions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.web_extension_report_decisions(p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_user uuid;
  v_row jsonb;
  v_saved public.web_extension_report_skip_decisions;
  v_items jsonb := '[]'::jsonb;
  v_item_count integer;
  v_action text;
  v_expected uuid;
  v_changed text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF p_operation='capabilities' THEN RETURN jsonb_build_object('report_skip_decisions',true); END IF;
  IF p_operation NOT IN ('resolve','confirm') OR jsonb_typeof(p_input->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  v_item_count:=jsonb_array_length(p_input->'items');
  IF v_item_count NOT BETWEEN 1 AND 50 OR p_input->>'source_origin'<>'https://corp.orangeapple.co' OR p_input->>'adapter_version'<>'orange-apple-v1' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_input->'items') LOOP
    IF v_row->>'source_admission_id' !~ '^\d{1,40}$' OR v_row->>'source_report_id' !~ '^\d{1,40}$'
      OR v_row->>'content_fingerprint' !~ '^[a-f0-9]{64}$' OR v_row->>'context_fingerprint' !~ '^[a-f0-9]{64}$'
      OR length(p_input->>'target_instance') NOT BETWEEN 8 AND 300
      OR jsonb_typeof(v_row->'field_fingerprints') IS DISTINCT FROM 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_row->'field_fingerprints') AS field(key)
        WHERE field.key <> ALL(ARRAY['attendance_status','absence_reason','lesson_id','progress_letter','is_completed','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link']::text[]))
      THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF p_operation='resolve' THEN
      SELECT * INTO v_saved FROM public.web_extension_report_skip_decisions d WHERE d.user_id=v_user
        AND d.target_instance=p_input->>'target_instance' AND d.source_origin=p_input->>'source_origin' AND d.adapter_version=p_input->>'adapter_version'
        AND d.source_admission_id=v_row->>'source_admission_id' AND d.source_report_id=v_row->>'source_report_id';
      IF v_saved.user_id IS NULL THEN
        v_items:=v_items||jsonb_build_array(jsonb_build_object('source_admission_id',v_row->>'source_admission_id','source_report_id',v_row->>'source_report_id','status','none','revision',NULL,'changed_fields','[]'::jsonb,'expired',false));
      ELSE
        v_changed:=ARRAY(SELECT key FROM jsonb_object_keys(COALESCE(v_row->'field_fingerprints','{}'::jsonb)) key
          WHERE v_saved.field_fingerprints->>key IS DISTINCT FROM v_row->'field_fingerprints'->>key);
        v_changed:=v_changed||ARRAY(SELECT key FROM jsonb_object_keys(v_saved.field_fingerprints) key WHERE key<>'class_notes' AND NOT (COALESCE(v_row->'field_fingerprints','{}'::jsonb)?key));
        v_items:=v_items||jsonb_build_array(jsonb_build_object(
          'source_admission_id',v_row->>'source_admission_id','source_report_id',v_row->>'source_report_id',
          'status',CASE WHEN v_saved.context_fingerprint<>v_row->>'context_fingerprint' OR v_saved.content_fingerprint<>v_row->>'content_fingerprint' OR cardinality(v_changed)>0 OR v_saved.expires_at<=now() THEN 'review' ELSE 'skipped' END,
          'reason',CASE WHEN v_saved.context_fingerprint<>v_row->>'context_fingerprint' THEN 'context_changed' WHEN v_saved.content_fingerprint<>v_row->>'content_fingerprint' OR cardinality(v_changed)>0 THEN 'content_changed' WHEN v_saved.expires_at<=now() THEN 'expired' ELSE 'unchanged' END,
          'revision',v_saved.revision,'confirmed_at',v_saved.confirmed_at,'expires_at',v_saved.expires_at,'changed_fields',to_jsonb(v_changed),'expired',v_saved.expires_at<=now()));
      END IF;
    ELSE
      v_action:=v_row->>'action'; v_expected:=NULLIF(v_row->>'expected_revision','')::uuid;
      SELECT * INTO v_saved FROM public.web_extension_report_skip_decisions d WHERE d.user_id=v_user
        AND d.target_instance=p_input->>'target_instance' AND d.source_origin=p_input->>'source_origin' AND d.adapter_version=p_input->>'adapter_version'
        AND d.source_admission_id=v_row->>'source_admission_id' AND d.source_report_id=v_row->>'source_report_id' FOR UPDATE;
      IF v_saved.revision IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
      IF v_action='clear' THEN
        DELETE FROM public.web_extension_report_skip_decisions WHERE user_id=v_user AND target_instance=p_input->>'target_instance' AND source_origin=p_input->>'source_origin' AND adapter_version=p_input->>'adapter_version' AND source_admission_id=v_row->>'source_admission_id' AND source_report_id=v_row->>'source_report_id';
        v_items:=v_items||jsonb_build_array(jsonb_build_object('source_admission_id',v_row->>'source_admission_id','source_report_id',v_row->>'source_report_id','status','cleared','revision',NULL));
      ELSIF v_action='skip' THEN
        INSERT INTO public.web_extension_report_skip_decisions(user_id,target_instance,source_origin,adapter_version,source_admission_id,source_report_id,content_fingerprint,context_fingerprint,field_fingerprints,confirmed_at,expires_at)
        VALUES(v_user,p_input->>'target_instance',p_input->>'source_origin',p_input->>'adapter_version',v_row->>'source_admission_id',v_row->>'source_report_id',v_row->>'content_fingerprint',v_row->>'context_fingerprint',v_row->'field_fingerprints',now(),now()+interval '30 days')
        ON CONFLICT(user_id,target_instance,source_origin,adapter_version,source_admission_id,source_report_id) DO UPDATE SET content_fingerprint=EXCLUDED.content_fingerprint,context_fingerprint=EXCLUDED.context_fingerprint,field_fingerprints=EXCLUDED.field_fingerprints,confirmed_at=now(),expires_at=now()+interval '30 days',revision=gen_random_uuid()
        RETURNING * INTO v_saved;
        v_items:=v_items||jsonb_build_array(jsonb_build_object('source_admission_id',v_row->>'source_admission_id','source_report_id',v_row->>'source_report_id','status','skipped','revision',v_saved.revision,'confirmed_at',v_saved.confirmed_at,'expires_at',v_saved.expires_at));
      ELSE RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('items',v_items);
END $$;

REVOKE ALL ON FUNCTION public.web_extension_report_decisions(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_report_decisions(uuid,text,text,jsonb) TO service_role;
COMMIT;
