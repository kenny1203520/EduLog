\set ON_ERROR_STOP on

-- Represents rows already present before the teaching-domain reconciliation.
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000aa', 'legacy-owner@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.classrooms(id, name, user_id) VALUES
  ('30000000-0000-0000-0000-0000000000aa', 'Legacy classroom', '00000000-0000-0000-0000-0000000000aa')
ON CONFLICT (id) DO NOTHING;
