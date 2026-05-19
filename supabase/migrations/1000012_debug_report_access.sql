-- ==========================================
-- Diagnostic and Debugging Functions for Report Editor
-- ==========================================
-- Date: 2026-05-20

-- Function to debug why a user can't access a report
CREATE OR REPLACE FUNCTION public.debug_report_access(p_report_id uuid)
RETURNS TABLE(
    step text,
    result boolean,
    detail text
)
SET search_path = public AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_report_exists boolean;
    v_teacher_exists boolean;
    v_teacher_has_access boolean;
BEGIN
    -- Step 1: Check if UID is available
    RETURN QUERY SELECT 'Auth UID Available'::text, (v_uid IS NOT NULL)::boolean, v_uid::text;
    
    -- Step 2: Check if report exists
    v_report_exists := EXISTS(SELECT 1 FROM public.occurrence_reports WHERE id = p_report_id);
    RETURN QUERY SELECT 'Report Exists'::text, v_report_exists::boolean, p_report_id::text;
    
    -- Step 3: Check if user is a teacher
    v_teacher_exists := EXISTS(
        SELECT 1 FROM public.teachers WHERE user_id = v_uid
    );
    RETURN QUERY SELECT 'User is Teacher'::text, v_teacher_exists::boolean, (SELECT name FROM public.teachers WHERE user_id = v_uid LIMIT 1)::text;
    
    -- Step 4: Check if teacher has access to report's class session
    v_teacher_has_access := EXISTS(
        SELECT 1 FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE orpt.id = p_report_id
        AND t.user_id = v_uid
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    );
    RETURN QUERY SELECT 'Teacher Has Access to Report'::text, v_teacher_has_access::boolean, 'Check joins above'::text;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.debug_report_access(uuid) TO authenticated;
