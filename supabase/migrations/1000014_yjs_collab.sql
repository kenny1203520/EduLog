-- Yjs collaboration persistence for reports
-- Adds tables to store Yjs operation records and snapshots

CREATE TABLE IF NOT EXISTS public.report_collab_docs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    occurrence_report_id uuid NOT NULL,
    snapshot_base64 text NOT NULL,
    last_updated_by uuid,
    last_updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT report_collab_docs_pkey PRIMARY KEY (id),
    CONSTRAINT report_collab_docs_report_fkey FOREIGN KEY (occurrence_report_id) REFERENCES public.occurrence_reports(id) ON DELETE CASCADE,
    CONSTRAINT report_collab_docs_unique_report UNIQUE (occurrence_report_id)
);

ALTER TABLE public.report_collab_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read/write via functions or owners" ON public.report_collab_docs FOR ALL USING (
    occurrence_report_id IN (
        SELECT orpt.id FROM public.occurrence_reports orpt
        JOIN public.enrollments e ON orpt.enrollment_id = e.id
        JOIN public.class_sessions cs ON e.class_session_id = cs.id
        JOIN public.class_session_teachers cst ON cs.id = cst.class_session_id
        JOIN public.teachers t ON cst.teacher_id = t.id
        WHERE t.user_id = (SELECT auth.uid())
        AND (cst.effective_to IS NULL OR cst.effective_to >= CURRENT_DATE)
    )
);
