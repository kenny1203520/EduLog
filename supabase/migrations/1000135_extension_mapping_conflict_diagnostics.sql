BEGIN;

-- Keep the existing RPC and strict revision checks. Only add bounded diagnostics
-- so the extension can identify the affected source item without exposing targets.
DO $migration$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.web_extension_memory(text,jsonb)'::regprocedure)
    INTO v_definition;

  v_definition := replace(
    v_definition,
    $old$IF v_item->>'expected_revision' IS DISTINCT FROM v_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;$old$,
    $new$IF v_item->>'expected_revision' IS DISTINCT FROM v_revision THEN
      RAISE EXCEPTION USING MESSAGE='VERSION_CONFLICT', DETAIL=jsonb_build_object(
        'kind',v_kind,'key',v_key,'field','expected_revision','reason','MEMORY_REVISION_CHANGED'
      )::text;
    END IF;$new$
  );
  v_definition := replace(
    v_definition,
    $old$IF v_versions->>v_id::text IS DISTINCT FROM v_target->>'target_version' THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;$old$,
    $new$IF v_versions->>v_id::text IS DISTINCT FROM v_target->>'target_version' THEN
        RAISE EXCEPTION USING MESSAGE='VERSION_CONFLICT', DETAIL=jsonb_build_object(
          'kind',v_kind,'key',v_key,'field','target_version','reason','TARGET_VERSION_CHANGED'
        )::text;
      END IF;$new$
  );

  IF position('MEMORY_REVISION_CHANGED' in v_definition)=0
     OR position('TARGET_VERSION_CHANGED' in v_definition)=0 THEN
    RAISE EXCEPTION 'MAPPING_CONFLICT_DIAGNOSTIC_PATCH_FAILED';
  END IF;
  EXECUTE v_definition;
END
$migration$;

COMMIT;
