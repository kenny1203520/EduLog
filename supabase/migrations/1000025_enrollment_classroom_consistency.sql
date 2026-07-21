-- Keep enrollment course, class session, and classroom references consistent.

UPDATE public.enrollments AS enrollment
SET classroom_id = session.classroom_id
FROM public.class_sessions AS session
WHERE enrollment.class_session_id = session.id
  AND enrollment.classroom_id IS DISTINCT FROM session.classroom_id;

CREATE OR REPLACE FUNCTION public.align_enrollment_session_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    target_classroom_id uuid;
    target_course_ids uuid[];
BEGIN
    IF NEW.class_session_id IS NULL THEN
        NEW.classroom_id := NULL;
        RETURN NEW;
    END IF;

    SELECT classroom_id, COALESCE(course_ids, ARRAY[]::uuid[])
    INTO target_classroom_id, target_course_ids
    FROM public.class_sessions
    WHERE id = NEW.class_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TARGET_SESSION_NOT_FOUND';
    END IF;

    IF NEW.course_id IS NULL OR NOT (NEW.course_id = ANY(target_course_ids)) THEN
        RAISE EXCEPTION 'TARGET_SESSION_COURSE_MISMATCH';
    END IF;

    NEW.classroom_id := target_classroom_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS align_enrollment_session_context_trigger ON public.enrollments;
CREATE TRIGGER align_enrollment_session_context_trigger
BEFORE INSERT OR UPDATE OF class_session_id, course_id
ON public.enrollments
FOR EACH ROW
EXECUTE FUNCTION public.align_enrollment_session_context();

CREATE OR REPLACE FUNCTION public.sync_session_classroom_to_enrollments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    UPDATE public.enrollments
    SET classroom_id = NEW.classroom_id
    WHERE class_session_id = NEW.id
      AND classroom_id IS DISTINCT FROM NEW.classroom_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_session_classroom_to_enrollments_trigger ON public.class_sessions;
CREATE TRIGGER sync_session_classroom_to_enrollments_trigger
AFTER UPDATE OF classroom_id
ON public.class_sessions
FOR EACH ROW
WHEN (OLD.classroom_id IS DISTINCT FROM NEW.classroom_id)
EXECUTE FUNCTION public.sync_session_classroom_to_enrollments();
