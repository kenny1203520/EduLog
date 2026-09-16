-- Reconcile legacy templates that received teaching_id in 1000043 but were
-- not included in its owner-based teaching backfill.
DO $$
BEGIN
  IF to_regclass('public.teachings') IS NULL
     OR to_regclass('public.teaching_members') IS NULL
     OR to_regclass('public.report_templates') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.teachings WHERE is_quarantine = true)
     OR NOT EXISTS (SELECT 1 FROM public.roles WHERE code = 'teaching_owner')
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'report_templates'
         AND column_name = 'instructor_id'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'report_templates'
         AND column_name = 'teaching_id'
     ) THEN
    RAISE EXCEPTION '1000069 prerequisites missing; apply teaching and report-template migrations first';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS report_templates_teaching_id_idx
  ON public.report_templates(teaching_id);

-- Reuse the canonical owner teaching if one already exists; otherwise create
-- a private teaching for this template owner. Never create a shared legacy
-- teaching across unrelated owners.
INSERT INTO public.teachings(name, owner_user_id)
SELECT 'Legacy teaching ' || left(template.instructor_id::text, 8), template.instructor_id
FROM public.report_templates AS template
WHERE template.instructor_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = template.instructor_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.teachings AS teaching
    WHERE teaching.owner_user_id = template.instructor_id
      AND teaching.is_quarantine = false
  )
GROUP BY template.instructor_id
ON CONFLICT DO NOTHING;

UPDATE public.report_templates AS template
SET teaching_id = teaching.id
FROM public.teachings AS teaching
WHERE template.teaching_id IS NULL
  AND template.instructor_id IS NOT NULL
  AND teaching.owner_user_id = template.instructor_id
  AND teaching.is_quarantine = false;

-- Any template that cannot be assigned to a valid owner teaching stays
-- isolated in the admin-only quarantine scope rather than becoming global.
UPDATE public.report_templates AS template
SET teaching_id = quarantine.id
FROM public.teachings AS quarantine
WHERE template.teaching_id IS NULL
  AND quarantine.is_quarantine = true;

INSERT INTO public.teaching_members(teaching_id, user_id, role_id)
SELECT teaching.id, teaching.owner_user_id, owner_role.id
FROM public.teachings AS teaching
JOIN public.roles AS owner_role ON owner_role.code = 'teaching_owner'
WHERE teaching.owner_user_id IS NOT NULL
  AND teaching.is_quarantine = false
  AND EXISTS (
    SELECT 1 FROM public.report_templates AS template
    WHERE template.instructor_id = teaching.owner_user_id
  )
ON CONFLICT (teaching_id, user_id) DO UPDATE
SET role_id = COALESCE(teaching_members.role_id, EXCLUDED.role_id),
    status = 'active';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.report_templates WHERE teaching_id IS NULL) THEN
    RAISE EXCEPTION '1000069 left report templates without a teaching scope';
  END IF;
END;
$$;
