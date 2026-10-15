-- Run after migrations 1000116 and 1000117 on a disposable database.
BEGIN;
DO $$
DECLARE
  account_id uuid := gen_random_uuid();
  browser_a uuid := gen_random_uuid();
  browser_b uuid := gen_random_uuid();
  browser_legacy uuid := gen_random_uuid();
  origin text := 'chrome-extension://' || repeat('a', 32);
  request_id uuid;
  old_id uuid;
  issued_id uuid;
  legacy_id uuid;
  unknown_id uuid;
  failed boolean;
BEGIN
  INSERT INTO auth.users(id) VALUES(account_id);
  INSERT INTO public.web_extension_pairing_requests(user_id,extension_origin,code_challenge,status,installation_id,device_name)
    VALUES(account_id,origin,repeat('a',64),'approved',browser_a,'Laptop') RETURNING id INTO request_id;
  SELECT token_id INTO old_id FROM public.claim_web_extension_pairing(request_id,origin,repeat('a',64),repeat('b',64));
  IF NOT EXISTS(SELECT 1 FROM public.web_extension_pairing_requests WHERE id=request_id AND status='claimed' AND token_id=old_id) THEN RAISE EXCEPTION 'Claim was not recorded'; END IF;
  failed := false;
  BEGIN PERFORM public.claim_web_extension_pairing(request_id,origin,repeat('a',64),repeat('c',64)); EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PAIRING_ALREADY_CLAIMED' THEN RAISE; END IF; failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Duplicate claim accepted'; END IF;
  INSERT INTO public.web_extension_tokens(user_id,extension_origin,token_hash,installation_id) VALUES(account_id,origin,repeat('d',64),browser_b);
  INSERT INTO public.web_extension_pairing_requests(user_id,extension_origin,code_challenge,status,installation_id,device_name)
    VALUES(account_id,origin,repeat('a',64),'approved',browser_a,'Renamed laptop') RETURNING id INTO request_id;
  failed := false;
  BEGIN PERFORM public.claim_web_extension_pairing(request_id,origin,repeat('f',64),repeat('e',64)); EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PAIRING_PROOF_INVALID' THEN RAISE; END IF; failed := true;
  END;
  IF NOT failed OR EXISTS(SELECT 1 FROM public.web_extension_tokens WHERE id=old_id AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'Bad proof altered the existing authorization'; END IF;
  -- Force an insert failure after revocation to verify transaction rollback.
  failed := false;
  BEGIN PERFORM public.claim_web_extension_pairing(request_id,origin,repeat('a',64),repeat('d',64)); EXCEPTION WHEN unique_violation THEN failed := true; END;
  IF NOT failed OR EXISTS(SELECT 1 FROM public.web_extension_tokens WHERE id=old_id AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'Failed claim revoked the old token'; END IF;
  SELECT token_id INTO issued_id FROM public.claim_web_extension_pairing(request_id,origin,repeat('a',64),repeat('e',64));
  IF NOT EXISTS(SELECT 1 FROM public.web_extension_tokens WHERE id=old_id AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'Old installation token still active'; END IF;
  IF (SELECT count(*) FROM public.web_extension_tokens WHERE user_id=account_id AND revoked_at IS NULL) <> 2 THEN RAISE EXCEPTION 'Another installation was revoked'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.web_extension_tokens WHERE id=issued_id AND device_name='Renamed laptop') THEN RAISE EXCEPTION 'Device metadata missing'; END IF;
  INSERT INTO public.web_extension_tokens(user_id,extension_origin,token_hash) VALUES(account_id,origin,repeat('1',64)) RETURNING id INTO legacy_id;
  INSERT INTO public.web_extension_tokens(user_id,extension_origin,token_hash) VALUES(account_id,origin,repeat('2',64)) RETURNING id INTO unknown_id;
  failed := false;
  BEGIN PERFORM public.bind_web_extension_installation(legacy_id,browser_a,'Current browser','Chrome','Windows','0.1.0'); EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'INSTALLATION_ALREADY_AUTHORIZED' THEN RAISE; END IF; failed := true;
  END;
  IF NOT failed OR NOT EXISTS(SELECT 1 FROM public.web_extension_tokens WHERE id=issued_id AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Legacy adoption superseded a new pairing'; END IF;
  PERFORM public.bind_web_extension_installation(legacy_id,browser_legacy,'Current browser','Chrome','Windows','0.1.0');
  IF NOT EXISTS(SELECT 1 FROM public.web_extension_tokens WHERE id=legacy_id AND installation_id=browser_legacy) THEN RAISE EXCEPTION 'Legacy token was not adopted'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.web_extension_tokens WHERE id=unknown_id AND revoked_at IS NULL AND installation_id IS NULL) THEN RAISE EXCEPTION 'Unknown legacy device was modified'; END IF;
  failed := false;
  BEGIN PERFORM public.bind_web_extension_installation(legacy_id,browser_b,'Other browser','Edge','Windows','0.1.0'); EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'INSTALLATION_MISMATCH' THEN RAISE; END IF; failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Installation identity was rewritten'; END IF;
  IF has_function_privilege('authenticated','public.claim_web_extension_pairing(uuid,text,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.bind_web_extension_installation(uuid,uuid,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Restricted function accessible to browser DB roles'; END IF;
END $$;
ROLLBACK;
