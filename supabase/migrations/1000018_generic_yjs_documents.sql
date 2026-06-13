-- Generic Yjs document persistence for Supabase Realtime collaboration
-- Stores full Yjs document snapshots as base64-encoded updates.

CREATE TABLE IF NOT EXISTS public.documents (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    room_id text NOT NULL,
    content text NOT NULL DEFAULT '',
    created_by uuid NOT NULL DEFAULT auth.uid(),
    updated_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT documents_pkey PRIMARY KEY (id),
    CONSTRAINT documents_room_id_key UNIQUE (room_id),
    CONSTRAINT documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
    CONSTRAINT documents_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id)
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.documents;
CREATE POLICY "Enable all access for authenticated users" ON public.documents FOR ALL
USING (
    (
        SELECT auth.role()
    ) = 'authenticated'
)
WITH CHECK (
    (
        SELECT auth.role()
    ) = 'authenticated'
);

DROP TRIGGER IF EXISTS update_documents_updated_at ON public.documents;
CREATE TRIGGER update_documents_updated_at BEFORE
UPDATE ON public.documents FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
