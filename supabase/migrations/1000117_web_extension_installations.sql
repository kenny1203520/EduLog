-- Installation identity is a random browser-profile identifier, not a device fingerprint.
ALTER TABLE public.web_extension_pairing_requests
  ADD COLUMN installation_id uuid,
  ADD COLUMN device_name text CHECK (device_name IS NULL OR length(device_name) BETWEEN 1 AND 80),
  ADD COLUMN browser_name text CHECK (browser_name IS NULL OR length(browser_name) <= 40),
  ADD COLUMN platform_name text CHECK (platform_name IS NULL OR length(platform_name) <= 40),
  ADD COLUMN extension_version text CHECK (extension_version IS NULL OR length(extension_version) <= 40),
  ADD COLUMN token_id uuid REFERENCES public.web_extension_tokens(id) ON DELETE SET NULL;
ALTER TABLE public.web_extension_tokens
  ADD COLUMN installation_id uuid,
  ADD COLUMN device_name text CHECK (device_name IS NULL OR length(device_name) BETWEEN 1 AND 80),
  ADD COLUMN browser_name text CHECK (browser_name IS NULL OR length(browser_name) <= 40),
  ADD COLUMN platform_name text CHECK (platform_name IS NULL OR length(platform_name) <= 40),
  ADD COLUMN extension_version text CHECK (extension_version IS NULL OR length(extension_version) <= 40);

CREATE UNIQUE INDEX web_extension_one_active_installation_idx
  ON public.web_extension_tokens (user_id, extension_origin, installation_id)
  WHERE installation_id IS NOT NULL AND revoked_at IS NULL;

CREATE FUNCTION public.claim_web_extension_pairing(
  p_request_id uuid, p_origin text, p_verifier_hash text, p_token_hash text
) RETURNS TABLE(token_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pairing public.web_extension_pairing_requests%ROWTYPE;
DECLARE issued public.web_extension_tokens%ROWTYPE;
BEGIN
  SELECT * INTO pairing FROM public.web_extension_pairing_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND OR pairing.extension_origin <> p_origin OR pairing.expires_at <= now() THEN
    RAISE EXCEPTION 'PAIRING_REQUEST_EXPIRED';
  END IF;
  IF pairing.status = 'claimed' THEN RAISE EXCEPTION 'PAIRING_ALREADY_CLAIMED'; END IF;
  IF pairing.status <> 'approved' OR pairing.user_id IS NULL THEN RAISE EXCEPTION 'PAIRING_NOT_APPROVED'; END IF;
  IF pairing.code_challenge <> p_verifier_hash THEN RAISE EXCEPTION 'PAIRING_PROOF_INVALID'; END IF;
  IF pairing.installation_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(pairing.user_id::text || p_origin || pairing.installation_id::text, 0));
    UPDATE public.web_extension_tokens t SET revoked_at = now()
      WHERE t.user_id = pairing.user_id AND t.extension_origin = p_origin
        AND t.installation_id = pairing.installation_id AND t.revoked_at IS NULL;
  END IF;
  INSERT INTO public.web_extension_tokens(user_id, extension_origin, token_hash, installation_id, device_name, browser_name, platform_name, extension_version)
    VALUES(pairing.user_id, p_origin, p_token_hash, pairing.installation_id, pairing.device_name, pairing.browser_name, pairing.platform_name, pairing.extension_version)
    RETURNING * INTO issued;
  UPDATE public.web_extension_pairing_requests r SET status = 'claimed', claimed_at = now(), token_id = issued.id WHERE r.id = pairing.id;
  RETURN QUERY SELECT issued.id, issued.expires_at;
END;
$$;

CREATE FUNCTION public.bind_web_extension_installation(
  p_token_id uuid, p_installation_id uuid, p_device_name text,
  p_browser_name text, p_platform_name text, p_extension_version text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE connection public.web_extension_tokens%ROWTYPE;
BEGIN
  -- Use the same lock order as claim before taking a token row lock.
  SELECT * INTO connection FROM public.web_extension_tokens t WHERE t.id = p_token_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(connection.user_id::text || connection.extension_origin || p_installation_id::text, 0));
  SELECT * INTO connection FROM public.web_extension_tokens t WHERE t.id = p_token_id FOR UPDATE;
  IF NOT FOUND OR connection.revoked_at IS NOT NULL OR connection.expires_at <= now() THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  IF connection.installation_id IS NOT NULL AND connection.installation_id <> p_installation_id THEN
    RAISE EXCEPTION 'INSTALLATION_MISMATCH';
  END IF;
  IF connection.installation_id IS NULL THEN
    -- Adoption must not supersede a credential just issued by a concurrent claim.
    IF EXISTS(SELECT 1 FROM public.web_extension_tokens t
      WHERE t.user_id = connection.user_id AND t.extension_origin = connection.extension_origin
        AND t.installation_id = p_installation_id AND t.id <> connection.id
        AND t.revoked_at IS NULL AND t.expires_at > now()) THEN
      RAISE EXCEPTION 'INSTALLATION_ALREADY_AUTHORIZED';
    END IF;
    UPDATE public.web_extension_tokens t SET revoked_at = now()
      WHERE t.user_id = connection.user_id AND t.extension_origin = connection.extension_origin
        AND t.installation_id = p_installation_id AND t.id <> connection.id AND t.revoked_at IS NULL AND t.expires_at <= now();
    UPDATE public.web_extension_tokens t SET installation_id = p_installation_id,
      device_name = coalesce(t.device_name, p_device_name), browser_name = p_browser_name,
      platform_name = p_platform_name, extension_version = p_extension_version WHERE t.id = connection.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_web_extension_pairing(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bind_web_extension_installation(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_web_extension_pairing(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_web_extension_installation(uuid, uuid, text, text, text, text) TO service_role;
