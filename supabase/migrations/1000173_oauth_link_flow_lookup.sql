-- Read only the OAuth flow context required by the API callback bridge.
CREATE OR REPLACE FUNCTION public.get_oauth_link_flow(p_state uuid DEFAULT NULL, p_challenge text DEFAULT NULL)
RETURNS TABLE(state uuid, user_id uuid, provider text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.id, f.linking_target_id, f.provider_type
  FROM auth.flow_state f
  WHERE f.linking_target_id IS NOT NULL
    AND ((p_state IS NOT NULL AND p_challenge IS NULL AND f.id = p_state)
      OR (p_state IS NULL AND p_challenge IS NOT NULL AND f.code_challenge = p_challenge
        AND f.created_at >= now() - interval '10 minutes'))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_oauth_link_flow(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_oauth_link_flow(uuid,text) TO service_role;
NOTIFY pgrst, 'reload schema';
