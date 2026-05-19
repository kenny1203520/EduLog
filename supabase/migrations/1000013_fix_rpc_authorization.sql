-- ==========================================
-- RLS and Admin Access Fix
-- ==========================================
-- Fixes authorization issues with report editing RPCs
-- - Adds admin user as teacher with access to all class sessions
-- - Provides helper function to grant/revoke admin access
-- Date: 2026-05-20


-- ==========================================
-- 1. Helper Function: Grant Admin Access
-- ==========================================
-- Allows granting admin/super-user access to specific users
CREATE OR REPLACE FUNCTION public.grant_admin_access(p_email text)
RETURNS TABLE(
    user_id uuid,
    email text,
    teacher_id uuid,
    class_sessions_count int
)
SET search_path = public AS $$
DECLARE
    v_user_id uuid;
    v_teacher_id uuid;
    cs_id uuid;
    v_count int := 0;
BEGIN
    -- Find user by email
    SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User with email % not found', p_email;
    END IF;
    
    -- Create teacher record if not exists
    INSERT INTO public.teachers (name, email, user_id)
    VALUES (SPLIT_PART(p_email, '@', 1), p_email, v_user_id)
    ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
    RETURNING id INTO v_teacher_id;
    
    -- Add to all class sessions
    FOR cs_id IN SELECT id FROM public.class_sessions LOOP
        INSERT INTO public.class_session_teachers (class_session_id, teacher_id, effective_from, effective_to)
        VALUES (cs_id, v_teacher_id, CURRENT_DATE, NULL)
        ON CONFLICT (class_session_id, teacher_id, effective_from) DO NOTHING;
        v_count := v_count + 1;
    END LOOP;
    
    RETURN QUERY SELECT v_user_id, p_email, v_teacher_id, v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to this function
GRANT EXECUTE ON FUNCTION public.grant_admin_access(text) TO authenticated;

-- ==========================================
-- 2. Ensure Proper RLS and Permissions
-- ==========================================
-- Grant necessary permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.update_editor_heartbeat(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_editors(uuid) TO authenticated;
