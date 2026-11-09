-- Rollback-only fixture for 1000160: the de-identification language checks
-- accept every language the Presidio image ships and still reject unknown codes.
BEGIN;

DO $$
BEGIN
  UPDATE public.ai_settings SET deid_languages = '{zh,en,ja,ko,ca,da,de,el,es,fi,fr,hr,it,lt,mk,nb,nl,pl,pt,ro,ru,sl,sv,uk}';
  BEGIN
    UPDATE public.ai_settings SET deid_languages = '{pl,zz}';
    RAISE EXCEPTION 'unknown settings languages must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.ai_settings SET deid_languages = '{xx}';
    RAISE EXCEPTION 'the multi-language xx code is not a supported language';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.ai_settings SET deid_languages = '{}';
    RAISE EXCEPTION 'at least one language must stay enabled';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.ai_deid_rules(name, kind, pattern, placeholder_kind, languages)
  VALUES ('Nordic', 'regex', 'x+', 'person', ARRAY['sv', 'nb', 'da', 'fi']);
  BEGIN
    INSERT INTO public.ai_deid_rules(name, kind, pattern, placeholder_kind, languages)
    VALUES ('Unknown', 'regex', 'x+', 'person', ARRAY['de', 'zz']);
    RAISE EXCEPTION 'unknown rule languages must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
