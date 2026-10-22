BEGIN;

-- Source report identity backbone.
--   admissionId ↔ enrollments.id, reportId ↔ occurrence_reports.id (1:1),
--   /courses/dt/<id> ↔ class_sessions.id.
-- (source_origin, source_report_id) is globally unique for lesson reports and
-- for active history rows. Rows without a reportId are attendance evidence,
-- never reports. Existing duplicates are retired, never deleted; every
-- decision is written to source_report_identity_resolutions so the conflict
-- report can be reviewed after the upgrade (see
-- supabase/preflight/source_report_identity_report.sql for the read-only
-- pre-upgrade version of the same report).

-- 1. Lesson report source identity and last-sync baseline.
ALTER TABLE public.occurrence_reports
  ADD COLUMN IF NOT EXISTS source_origin text,
  ADD COLUMN IF NOT EXISTS source_admission_id text,
  ADD COLUMN IF NOT EXISTS source_report_id text,
  ADD COLUMN IF NOT EXISTS source_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_synced_version integer,
  ADD COLUMN IF NOT EXISTS source_synced_fields jsonb;
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='occurrence_reports_source_identity_check') THEN
    ALTER TABLE public.occurrence_reports ADD CONSTRAINT occurrence_reports_source_identity_check CHECK (
      (source_origin IS NULL AND source_admission_id IS NULL AND source_report_id IS NULL)
      OR (source_origin='https://corp.orangeapple.co' AND source_admission_id ~ '^[0-9]+$' AND source_report_id ~ '^[0-9]+$'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='occurrence_reports_source_synced_fields_check') THEN
    ALTER TABLE public.occurrence_reports ADD CONSTRAINT occurrence_reports_source_synced_fields_check CHECK (
      source_synced_fields IS NULL OR (jsonb_typeof(source_synced_fields)='object' AND octet_length(source_synced_fields::text)<=64000));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS occurrence_reports_source_report_unique
  ON public.occurrence_reports(source_origin,source_report_id) WHERE source_report_id IS NOT NULL;

-- 2. History rows can be retired. NULL means active; the column stays
-- nullable because the import RPC inserts through jsonb_populate_record.
ALTER TABLE public.enrollment_history_reports
  ADD COLUMN IF NOT EXISTS retired_as text,
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.enrollment_history_reports(id);
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='enrollment_history_reports_retired_check') THEN
    ALTER TABLE public.enrollment_history_reports ADD CONSTRAINT enrollment_history_reports_retired_check CHECK (
      (retired_as IS NULL AND retired_at IS NULL AND superseded_by IS NULL)
      OR (retired_as='superseded' AND retired_at IS NOT NULL AND superseded_by IS NOT NULL)
      OR (retired_as='archived' AND retired_at IS NOT NULL AND superseded_by IS NULL));
  END IF;
END $$;

-- 3. Attendance evidence: date, count and class for source rows that have no
-- reportId. Evidence never creates or binds an occurrence report.
CREATE TABLE IF NOT EXISTS public.enrollment_attendance_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  enrollment_id uuid NOT NULL REFERENCES public.enrollments(id),
  source_origin text NOT NULL CHECK (source_origin='https://corp.orangeapple.co'),
  source_admission_id text NOT NULL CHECK (source_admission_id ~ '^[0-9]+$'),
  source_class_id text CHECK (source_class_id ~ '^[0-9]+$'),
  evidence_date date NOT NULL,
  attendance_count integer NOT NULL CHECK (attendance_count BETWEEN 1 AND 20),
  present_count integer NOT NULL DEFAULT 0 CHECK (present_count>=0),
  absent_count integer NOT NULL DEFAULT 0 CHECK (absent_count>=0),
  migrated_history_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (present_count+absent_count<=attendance_count)
);
CREATE UNIQUE INDEX IF NOT EXISTS enrollment_attendance_evidence_identity
  ON public.enrollment_attendance_evidence(enrollment_id,source_origin,source_admission_id,evidence_date,(COALESCE(source_class_id,'')));
ALTER TABLE public.enrollment_attendance_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrollment_attendance_evidence FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.enrollment_attendance_evidence TO authenticated;
GRANT ALL ON public.enrollment_attendance_evidence TO service_role;
DROP POLICY IF EXISTS enrollment_attendance_evidence_read ON public.enrollment_attendance_evidence;
CREATE POLICY enrollment_attendance_evidence_read ON public.enrollment_attendance_evidence FOR SELECT TO authenticated
  USING(public.can_access_enrollment(enrollment_id,'teaching.enrollments.read') AND public.can_access_enrollment(enrollment_id,'teaching.reports.read'));

-- 4. Conflict report log. Private; read through the token-checked RPC below.
CREATE TABLE IF NOT EXISTS public.source_report_identity_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('kept','superseded','archived_evidence','occurrence_backfilled','occurrence_conflict','link_conflict')),
  history_id uuid REFERENCES public.enrollment_history_reports(id),
  occurrence_report_id uuid,
  enrollment_id uuid,
  source_origin text,
  source_report_id text,
  keeper_id uuid,
  detail jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS source_report_identity_resolutions_once
  ON public.source_report_identity_resolutions(action,(COALESCE(history_id,'00000000-0000-0000-0000-000000000000'::uuid)),(COALESCE(occurrence_report_id,'00000000-0000-0000-0000-000000000000'::uuid)));
ALTER TABLE public.source_report_identity_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.source_report_identity_resolutions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.source_report_identity_resolutions TO service_role;

-- 5. Existing data. Keep one canonical history row per reportId: verified,
-- then already linked, then most recently updated. The ordering is shared
-- with the preflight report.
WITH ranked AS (
  SELECT h.id,h.enrollment_id,h.source_origin,h.source_report_id,h.linked_report_id,
    first_value(h.id) OVER w AS keeper_id,
    first_value(h.linked_report_id) OVER w AS keeper_report_id,
    row_number() OVER w AS rank,
    count(*) OVER (PARTITION BY h.source_origin,h.source_report_id) AS group_size
  FROM public.enrollment_history_reports h
  WHERE h.source_report_id IS NOT NULL AND h.retired_as IS NULL
  WINDOW w AS (PARTITION BY h.source_origin,h.source_report_id
    ORDER BY (h.identity_status='verified') DESC,(h.linked_report_id IS NOT NULL) DESC,h.updated_at DESC,h.version DESC,h.id)
)
INSERT INTO public.source_report_identity_resolutions(action,history_id,occurrence_report_id,enrollment_id,source_origin,source_report_id,keeper_id,detail)
SELECT CASE WHEN rank=1 THEN 'kept' ELSE 'superseded' END,id,linked_report_id,enrollment_id,source_origin,source_report_id,keeper_id,
  jsonb_build_object('group_size',group_size,'linked_elsewhere',rank>1 AND linked_report_id IS NOT NULL AND linked_report_id IS DISTINCT FROM keeper_report_id)
FROM ranked WHERE group_size>1
ON CONFLICT DO NOTHING;

UPDATE public.enrollment_history_reports h
SET retired_as='superseded',retired_at=now(),superseded_by=r.keeper_id
FROM public.source_report_identity_resolutions r
WHERE r.action='superseded' AND r.history_id=h.id AND h.retired_as IS NULL;

-- Evidence-only history becomes attendance evidence and is archived.
INSERT INTO public.source_report_identity_resolutions(action,history_id,occurrence_report_id,enrollment_id,source_origin,detail)
SELECT 'archived_evidence',h.id,h.linked_report_id,h.enrollment_id,h.source_origin,
  jsonb_build_object('report_date',h.report_date,'source_admission_id',h.source_admission_id,'attendance_status',h.attendance_status,'had_content',COALESCE(h.content,'')<>'' OR COALESCE(h.contact_notes,'')<>'' OR COALESCE(h.class_notes,'')<>'')
FROM public.enrollment_history_reports h
WHERE h.identity_status='evidence_only' AND h.retired_as IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.enrollment_attendance_evidence(user_id,enrollment_id,source_origin,source_admission_id,source_class_id,evidence_date,attendance_count,present_count,absent_count,migrated_history_ids)
SELECT (array_agg(h.user_id ORDER BY h.created_at,h.id))[1],h.enrollment_id,h.source_origin,h.source_admission_id,NULL,h.report_date,
  LEAST(count(*),20)::integer,LEAST(count(*) FILTER (WHERE h.attendance_status='present'),20)::integer,
  LEAST(count(*) FILTER (WHERE h.attendance_status='absent'),20-LEAST(count(*) FILTER (WHERE h.attendance_status='present'),20))::integer,
  array_agg(h.id ORDER BY h.id)
FROM public.enrollment_history_reports h
WHERE h.identity_status='evidence_only' AND h.retired_as IS NULL
GROUP BY h.enrollment_id,h.source_origin,h.source_admission_id,h.report_date
ON CONFLICT(enrollment_id,source_origin,source_admission_id,evidence_date,(COALESCE(source_class_id,''))) DO UPDATE
SET migrated_history_ids=ARRAY(SELECT DISTINCT unnest(public.enrollment_attendance_evidence.migrated_history_ids||EXCLUDED.migrated_history_ids)),updated_at=now();

UPDATE public.enrollment_history_reports SET retired_as='archived',retired_at=now()
WHERE identity_status='evidence_only' AND retired_as IS NULL;

-- Backfill lesson report identity from canonical linked history. A lesson
-- report linked by more than one reportId stays unbound and is reported.
WITH links AS (
  SELECT h.id AS history_id,h.linked_report_id AS report_id,h.enrollment_id,h.source_origin,h.source_report_id,
    count(*) OVER (PARTITION BY h.linked_report_id) AS sources
  FROM public.enrollment_history_reports h
  WHERE h.retired_as IS NULL AND h.identity_status='verified' AND h.source_report_id IS NOT NULL AND h.linked_report_id IS NOT NULL
)
INSERT INTO public.source_report_identity_resolutions(action,history_id,occurrence_report_id,enrollment_id,source_origin,source_report_id,detail)
SELECT 'occurrence_conflict',history_id,report_id,enrollment_id,source_origin,source_report_id,jsonb_build_object('source_reports',sources)
FROM links WHERE sources>1
ON CONFLICT DO NOTHING;

-- The EduLog edit history since the original link is unknown, so the
-- baseline version stays NULL: a later sync never overwrites silently.
WITH links AS (
  SELECT h.id AS history_id,h.user_id,h.linked_report_id AS report_id,h.enrollment_id,h.source_origin,h.source_admission_id,h.source_report_id,h.updated_at,
    count(*) OVER (PARTITION BY h.linked_report_id) AS sources
  FROM public.enrollment_history_reports h
  WHERE h.retired_as IS NULL AND h.identity_status='verified' AND h.source_report_id IS NOT NULL AND h.linked_report_id IS NOT NULL
), updated AS (
  UPDATE public.occurrence_reports r
  SET source_origin=l.source_origin,source_admission_id=l.source_admission_id,source_report_id=l.source_report_id,source_synced_at=l.updated_at,source_synced_version=NULL
  FROM links l
  WHERE l.sources=1 AND r.id=l.report_id AND r.source_report_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.occurrence_reports other WHERE other.source_origin=l.source_origin AND other.source_report_id=l.source_report_id)
  RETURNING r.id,l.history_id,l.enrollment_id,l.source_origin,l.source_report_id
)
INSERT INTO public.source_report_identity_resolutions(action,history_id,occurrence_report_id,enrollment_id,source_origin,source_report_id)
SELECT 'occurrence_backfilled',history_id,id,enrollment_id,source_origin,source_report_id FROM updated
ON CONFLICT DO NOTHING;

INSERT INTO public.source_report_identity_resolutions(action,history_id,occurrence_report_id,enrollment_id,source_origin,source_report_id,detail)
SELECT 'link_conflict',h.id,r.id,h.enrollment_id,r.source_origin,r.source_report_id,jsonb_build_object('linked_to',l.edulog_id)
FROM public.occurrence_reports r
JOIN public.enrollment_history_reports h ON h.linked_report_id=r.id AND h.retired_as IS NULL AND h.source_report_id=r.source_report_id
JOIN public.web_extension_source_links l ON l.user_id=h.user_id AND l.source_origin=r.source_origin AND l.source_kind='report' AND l.source_id=r.source_report_id
WHERE l.edulog_id<>r.id
ON CONFLICT DO NOTHING;

INSERT INTO public.web_extension_source_links(user_id,source_origin,source_kind,source_id,edulog_id,target_version)
SELECT DISTINCT ON (h.user_id,r.source_origin,r.source_report_id) h.user_id,r.source_origin,'report',r.source_report_id,r.id,r.version::text
FROM public.occurrence_reports r
JOIN public.enrollment_history_reports h ON h.linked_report_id=r.id AND h.retired_as IS NULL AND h.source_report_id=r.source_report_id
ORDER BY h.user_id,r.source_origin,r.source_report_id,h.updated_at DESC
ON CONFLICT(user_id,source_origin,source_kind,source_id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS enrollment_history_reports_source_report_unique
  ON public.enrollment_history_reports(source_origin,source_report_id)
  WHERE source_report_id IS NOT NULL AND retired_as IS NULL;

-- 6. Retired history is invisible to listing and to same-day ambiguity checks.
DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$WHERE (p_input->>'enrollment_id' IS NULL OR h.enrollment_id=(p_input->>'enrollment_id')::uuid)$old$;
  v_new text := $new$WHERE h.retired_as IS NULL AND (p_input->>'enrollment_id' IS NULL OR h.enrollment_id=(p_input->>'enrollment_id')::uuid)$new$;
BEGIN
  SELECT pg_get_functiondef('public.enrollment_history_access(text,jsonb)'::regprocedure) INTO v_definition;
  IF position(v_new IN v_definition)>0 THEN RETURN; END IF;
  IF position(v_old IN v_definition)=0 THEN RAISE EXCEPTION 'SOURCE_REPORT_IDENTITY_HISTORY_LIST_PATCH_FAILED'; END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END
$migration$;

DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$h.report_date=(p_data->>'report_date')::date AND (p_data->>'identity_status'='evidence_only' OR h.identity_status='evidence_only')$old$;
  v_new text := $new$h.retired_as IS NULL AND h.report_date=(p_data->>'report_date')::date AND (p_data->>'identity_status'='evidence_only' OR h.identity_status='evidence_only')$new$;
BEGIN
  SELECT pg_get_functiondef('public.validate_enrollment_history(jsonb,jsonb,public.web_extension_import_jobs,jsonb)'::regprocedure) INTO v_definition;
  IF position(v_new IN v_definition)>0 THEN RETURN; END IF;
  IF position(v_old IN v_definition)=0 THEN RAISE EXCEPTION 'SOURCE_REPORT_IDENTITY_VALIDATION_PATCH_FAILED'; END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END
$migration$;

-- 7. Workspace RPC: reportId identity, global uniqueness, source links and
-- the re-sync rule. The delegated function keeps authentication, version
-- checks and the atomic history/occurrence reconciliation.
DO $$
BEGIN
  IF to_regprocedure('public.web_extension_workspace_before_source_identity(uuid,text,text,jsonb)') IS NULL THEN
    ALTER FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) RENAME TO web_extension_workspace_before_source_identity;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.web_extension_source_report_conflict(p_source_id text,p_reason text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION USING MESSAGE='SOURCE_MAPPING_CONFLICT',DETAIL=jsonb_build_object('kind','history_report','source_id',p_source_id,'field','source_report_id','reason',p_reason)::text;
END $$;
REVOKE ALL ON FUNCTION public.web_extension_source_report_conflict(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.web_extension_workspace(
  p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE
  v_user uuid; v_input jsonb; v_rows jsonb:='[]'; v_row jsonb; v_meta jsonb; v_data jsonb; v_rid text;
  v_report public.occurrence_reports; v_link public.web_extension_source_links; v_state text; v_states jsonb:='{}';
  v_result jsonb; v_item jsonb; v_items jsonb; v_previous_status text; v_synced jsonb;
BEGIN
  IF p_operation='capabilities' THEN
    RETURN public.web_extension_workspace_before_source_identity(p_token_id,p_token_hash,p_operation,p_input)
      ||jsonb_build_object('source_report_identity',true,'attendance_evidence',true);
  END IF;
  IF p_operation NOT IN ('preview','apply') OR jsonb_typeof(p_input->'rows') IS DISTINCT FROM 'array' THEN
    RETURN public.web_extension_workspace_before_source_identity(p_token_id,p_token_hash,p_operation,p_input);
  END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now();
  -- Authentication failures are raised by the delegated function.
  IF v_user IS NULL THEN RETURN public.web_extension_workspace_before_source_identity(p_token_id,p_token_hash,p_operation,p_input); END IF;
  SELECT b.status INTO v_previous_status FROM public.web_extension_import_batches b
    WHERE b.job_id=(p_input->>'job_id')::uuid AND b.batch_key=(p_input->>'key')::uuid;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_input->'rows') LOOP
    IF v_row->'record'->>'kind'='history_report' AND v_previous_status IS DISTINCT FROM 'applied' THEN
      v_data:=v_row->'record'->'data'; v_rid:=v_data->>'source_report_id';
      -- Rows without a reportId are attendance evidence, never new reports.
      IF v_rid IS NULL AND NOT EXISTS(SELECT 1 FROM public.enrollment_history_reports WHERE id=(v_row->>'target_id')::uuid) THEN
        RAISE EXCEPTION USING MESSAGE='INVALID_IMPORT',DETAIL=jsonb_build_object('kind','history_report','source_id',v_row->>'source_id','field','source_report_id','reason','REPORT_IDENTITY_REQUIRED')::text;
      END IF;
      IF v_rid IS NOT NULL THEN
        IF EXISTS(SELECT 1 FROM public.enrollment_history_reports h WHERE h.source_origin=v_data->>'source_origin' AND h.source_report_id=v_rid AND h.retired_as IS NULL AND h.id<>(v_row->>'target_id')::uuid) THEN
          PERFORM public.web_extension_source_report_conflict(v_row->>'source_id','SOURCE_REPORT_ALREADY_IMPORTED');
        END IF;
        IF v_row ? 'history_reconciliation' THEN
          v_meta:=v_row->'history_reconciliation';
          SELECT * INTO v_report FROM public.occurrence_reports
            WHERE enrollment_id=(v_data->>'enrollment_id')::uuid AND class_occurrence_id=(v_meta->>'class_occurrence_id')::uuid;
          IF EXISTS(SELECT 1 FROM public.occurrence_reports r WHERE r.source_origin=v_data->>'source_origin' AND r.source_report_id=v_rid AND r.id IS DISTINCT FROM v_report.id) THEN
            PERFORM public.web_extension_source_report_conflict(v_row->>'source_id','SOURCE_REPORT_BOUND_ELSEWHERE');
          END IF;
          IF v_report.source_report_id IS NOT NULL AND v_report.source_report_id<>v_rid THEN
            PERFORM public.web_extension_source_report_conflict(v_row->>'source_id','OCCURRENCE_REPORT_HAS_OTHER_SOURCE');
          END IF;
          SELECT * INTO v_link FROM public.web_extension_source_links
            WHERE user_id=v_user AND source_origin=v_data->>'source_origin' AND source_kind='report' AND source_id=v_rid;
          IF v_link.id IS NOT NULL AND v_link.edulog_id IS DISTINCT FROM v_report.id THEN
            PERFORM public.web_extension_source_report_conflict(v_row->>'source_id','SOURCE_LINK_CONFLICT');
          END IF;
          v_state:=CASE WHEN v_report.id IS NULL THEN 'new'
            WHEN v_report.source_report_id IS NULL THEN 'unbound'
            WHEN v_report.source_synced_version IS NOT NULL AND v_report.version=v_report.source_synced_version THEN 'untouched'
            ELSE 'edulog_changed' END;
          -- EduLog has not changed since the last sync: the source overwrites.
          IF v_state='untouched' THEN
            v_meta:=jsonb_set(v_meta,'{overwrite}',(SELECT COALESCE(jsonb_agg(DISTINCT f),'[]'::jsonb) FROM (
              SELECT jsonb_array_elements_text(v_meta->'overwrite') f UNION SELECT jsonb_array_elements_text(v_meta->'include_fields')) x));
            v_row:=jsonb_set(v_row,'{history_reconciliation}',v_meta);
          END IF;
          v_states:=v_states||jsonb_build_object(v_row->>'source_id',v_state);
        END IF;
      END IF;
    END IF;
    v_rows:=v_rows||jsonb_build_array(v_row);
  END LOOP;
  v_input:=jsonb_set(p_input,'{rows}',v_rows);
  v_result:=public.web_extension_workspace_before_source_identity(p_token_id,p_token_hash,p_operation,v_input);

  IF p_operation='preview' THEN
    v_items:='[]';
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_result->'rows','[]'::jsonb)) LOOP
      IF v_item ? 'history_reconciliation' AND v_states ? (v_item->>'source_id') THEN
        v_item:=jsonb_set(v_item,'{history_reconciliation,source_sync_state}',v_states->(v_item->>'source_id'));
      END IF;
      v_items:=v_items||jsonb_build_array(v_item);
    END LOOP;
    RETURN CASE WHEN v_result ? 'rows' THEN jsonb_set(v_result,'{rows}',v_items) ELSE v_result END;
  END IF;
  IF v_previous_status='applied' THEN RETURN v_result; END IF;

  -- Stamp the sync baseline on every linked lesson report.
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_result->'history_reconciliations','[]'::jsonb)) WHERE value->>'report_id' IS NOT NULL LOOP
    SELECT value INTO v_row FROM jsonb_array_elements(v_rows) WHERE value->>'source_id'=v_item->>'source_id' LIMIT 1;
    v_data:=v_row->'record'->'data'; v_meta:=v_row->'history_reconciliation'; v_rid:=v_data->>'source_report_id';
    IF v_rid IS NULL THEN CONTINUE; END IF;
    SELECT COALESCE(jsonb_object_agg(f,v_data->f),'{}'::jsonb) INTO v_synced
      FROM jsonb_array_elements_text(v_meta->'include_fields') f
      WHERE v_data ? f AND (f<>'class_notes' OR COALESCE((v_meta->>'include_internal')::boolean,false));
    UPDATE public.occurrence_reports
      SET source_origin=v_data->>'source_origin',source_admission_id=v_data->>'source_admission_id',source_report_id=v_rid,
        source_synced_at=now(),source_synced_version=version,source_synced_fields=COALESCE(source_synced_fields,'{}'::jsonb)||v_synced
      WHERE id=(v_item->>'report_id')::uuid
      RETURNING * INTO v_report;
    INSERT INTO public.web_extension_source_links(user_id,source_origin,source_kind,source_id,edulog_id,target_version)
      VALUES(v_user,v_report.source_origin,'report',v_rid,v_report.id,v_report.version::text)
      ON CONFLICT(user_id,source_origin,source_kind,source_id) DO UPDATE SET target_version=EXCLUDED.target_version,updated_at=now()
      WHERE public.web_extension_source_links.edulog_id=EXCLUDED.edulog_id;
  END LOOP;
  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) TO service_role;
COMMENT ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) IS
  'Extension workspace RPC with global source report identity, report source links and the re-sync overwrite rule.';

-- 8. Token-checked attendance evidence and conflict report RPCs.
CREATE OR REPLACE FUNCTION public.web_extension_attendance_evidence(
  p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE
  v_user uuid; v_item jsonb; v_saved public.enrollment_attendance_evidence; v_items jsonb:='[]';
  v_enrollment uuid; v_limit integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF p_operation='record' THEN
    IF p_input->>'source_origin' IS DISTINCT FROM 'https://corp.orangeapple.co' OR jsonb_typeof(p_input->'items') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_input->'items') LOOP
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k NOT IN ('enrollment_id','source_admission_id','source_class_id','evidence_date','attendance_count','present_count','absent_count'))
        OR v_item->>'source_admission_id' !~ '^[0-9]+$' OR (v_item ? 'source_class_id' AND v_item->>'source_class_id' !~ '^[0-9]+$') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
      v_enrollment:=(v_item->>'enrollment_id')::uuid;
      IF NOT public.can_access_enrollment(v_enrollment,'teaching.enrollments.read') OR NOT public.can_access_enrollment(v_enrollment,'teaching.reports.read')
        OR NOT public.can_access_enrollment(v_enrollment,'teaching.reports.create') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
      -- Evidence attaches only to an admission the teacher already mapped.
      IF NOT EXISTS(SELECT 1 FROM public.web_extension_mapping_memory m WHERE m.user_id=v_user AND m.source_origin=p_input->>'source_origin' AND m.kind='admission' AND m.source_key=v_item->>'source_admission_id' AND m.target_id=v_enrollment)
        AND NOT EXISTS(SELECT 1 FROM public.web_extension_source_links l WHERE l.user_id=v_user AND l.source_origin=p_input->>'source_origin' AND l.source_kind='enrollment' AND l.source_id=v_item->>'source_admission_id' AND l.edulog_id=v_enrollment) THEN
        RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT';
      END IF;
      INSERT INTO public.enrollment_attendance_evidence(user_id,enrollment_id,source_origin,source_admission_id,source_class_id,evidence_date,attendance_count,present_count,absent_count)
        VALUES(v_user,v_enrollment,p_input->>'source_origin',v_item->>'source_admission_id',v_item->>'source_class_id',(v_item->>'evidence_date')::date,
          (v_item->>'attendance_count')::integer,COALESCE((v_item->>'present_count')::integer,0),COALESCE((v_item->>'absent_count')::integer,0))
        ON CONFLICT(enrollment_id,source_origin,source_admission_id,evidence_date,(COALESCE(source_class_id,''))) DO UPDATE
        SET attendance_count=EXCLUDED.attendance_count,present_count=EXCLUDED.present_count,absent_count=EXCLUDED.absent_count,updated_at=now()
        RETURNING * INTO v_saved;
      v_items:=v_items||jsonb_build_array(to_jsonb(v_saved)-'user_id');
    END LOOP;
    RETURN jsonb_build_object('items',v_items);
  ELSIF p_operation='list' THEN
    v_enrollment:=(p_input->>'enrollment_id')::uuid; v_limit:=LEAST(100,GREATEST(1,COALESCE((p_input->>'limit')::integer,100)));
    IF NOT public.can_access_enrollment(v_enrollment,'teaching.enrollments.read') OR NOT public.can_access_enrollment(v_enrollment,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(e)-'user_id'-'migrated_history_ids' ORDER BY e.evidence_date DESC,e.id),'[]') INTO v_items FROM (
      SELECT * FROM public.enrollment_attendance_evidence e WHERE e.enrollment_id=v_enrollment
        AND (p_input->>'before_date' IS NULL OR e.evidence_date<(p_input->>'before_date')::date)
      ORDER BY e.evidence_date DESC,e.id LIMIT v_limit) e;
    RETURN jsonb_build_object('items',v_items);
  END IF;
  RAISE EXCEPTION 'INVALID_IMPORT';
END
$function$;
REVOKE ALL ON FUNCTION public.web_extension_attendance_evidence(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_attendance_evidence(uuid,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.web_extension_source_report_conflicts(
  p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE v_user uuid; v_items jsonb; v_summary jsonb; v_limit integer:=LEAST(50,GREATEST(1,COALESCE((p_input->>'limit')::integer,50)));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF p_operation<>'list' OR (p_input ? 'action' AND p_input->>'action' NOT IN ('kept','superseded','archived_evidence','occurrence_backfilled','occurrence_conflict','link_conflict')) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  WITH visible AS (
    SELECT r.* FROM public.source_report_identity_resolutions r
    WHERE r.enrollment_id IS NOT NULL AND public.can_access_enrollment(r.enrollment_id,'teaching.enrollments.read') AND public.can_access_enrollment(r.enrollment_id,'teaching.reports.read')
  )
  SELECT jsonb_build_object('kept',count(*) FILTER (WHERE action='kept'),'superseded',count(*) FILTER (WHERE action='superseded'),
      'archived_evidence',count(*) FILTER (WHERE action='archived_evidence'),'occurrence_backfilled',count(*) FILTER (WHERE action='occurrence_backfilled'),
      'occurrence_conflict',count(*) FILTER (WHERE action='occurrence_conflict'),'link_conflict',count(*) FILTER (WHERE action='link_conflict')),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM (
      SELECT v.id,v.action,v.history_id,v.occurrence_report_id,v.enrollment_id,v.source_report_id,v.keeper_id,v.detail,v.created_at FROM visible v
      WHERE (p_input->>'action' IS NULL OR v.action=p_input->>'action') AND (p_input->>'cursor' IS NULL OR v.id>(p_input->>'cursor')::uuid)
      ORDER BY v.id LIMIT v_limit+1) x),'[]')
  INTO v_summary,v_items FROM visible;
  RETURN jsonb_build_object('summary',v_summary,
    'items',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items-v_limit ELSE v_items END,
    'next_cursor',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items->(v_limit-1)->>'id' END);
END
$function$;
REVOKE ALL ON FUNCTION public.web_extension_source_report_conflicts(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_source_report_conflicts(uuid,text,text,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
