-- Read-only preflight for 1000148_source_report_identity.sql.
-- Run this against the target database before the upgrade, export the result
-- sets, and take a restorable backup. The migration applies exactly these
-- decisions and records them in public.source_report_identity_resolutions.
-- The queries return IDs, dates and counts only; no report text is returned.

-- 1. Summary of what the migration will do.
WITH ranked AS (
  SELECT h.id,h.linked_report_id,h.identity_status,
    row_number() OVER w AS rank,
    first_value(h.linked_report_id) OVER w AS keeper_report_id,
    count(*) OVER (PARTITION BY h.source_origin,h.source_report_id) AS group_size
  FROM public.enrollment_history_reports h
  WHERE h.source_report_id IS NOT NULL
  WINDOW w AS (PARTITION BY h.source_origin,h.source_report_id
    ORDER BY (h.identity_status='verified') DESC,(h.linked_report_id IS NOT NULL) DESC,h.updated_at DESC,h.version DESC,h.id)
), linked AS (
  -- Only the rows that stay active after supersession can bind a lesson report.
  SELECT linked_report_id,count(*) AS sources FROM ranked
  WHERE rank=1 AND identity_status='verified' AND linked_report_id IS NOT NULL
  GROUP BY linked_report_id
)
SELECT 'report_ids_with_duplicates' AS item,count(DISTINCT id) FILTER (WHERE rank=1 AND group_size>1) AS row_count FROM ranked
UNION ALL SELECT 'history_rows_superseded',count(*) FILTER (WHERE rank>1) FROM ranked
UNION ALL SELECT 'superseded_rows_linked_elsewhere',count(*) FILTER (WHERE rank>1 AND linked_report_id IS NOT NULL AND linked_report_id IS DISTINCT FROM keeper_report_id) FROM ranked
UNION ALL SELECT 'evidence_only_rows_archived',count(*) FROM public.enrollment_history_reports WHERE identity_status='evidence_only'
UNION ALL SELECT 'evidence_only_rows_with_linked_report',count(*) FROM public.enrollment_history_reports WHERE identity_status='evidence_only' AND linked_report_id IS NOT NULL
UNION ALL SELECT 'attendance_evidence_rows_created',count(*) FROM (SELECT 1 FROM public.enrollment_history_reports WHERE identity_status='evidence_only' GROUP BY enrollment_id,source_origin,source_admission_id,report_date) e
UNION ALL SELECT 'lesson_reports_linked_by_several_report_ids',count(*) FROM linked WHERE sources>1;

-- 2. Every duplicated reportId, the row that is kept and the rows that are
-- superseded. Review rows where linked_elsewhere is true: their lesson report
-- will stay in EduLog but will no longer be tied to the source report.
WITH ranked AS (
  SELECT h.source_report_id,h.id,h.enrollment_id,h.source_admission_id,h.report_date,h.identity_status,h.linked_report_id,h.updated_at,
    row_number() OVER w AS rank,
    first_value(h.id) OVER w AS keeper_id,
    first_value(h.linked_report_id) OVER w AS keeper_report_id,
    count(*) OVER (PARTITION BY h.source_origin,h.source_report_id) AS group_size
  FROM public.enrollment_history_reports h
  WHERE h.source_report_id IS NOT NULL
  WINDOW w AS (PARTITION BY h.source_origin,h.source_report_id
    ORDER BY (h.identity_status='verified') DESC,(h.linked_report_id IS NOT NULL) DESC,h.updated_at DESC,h.version DESC,h.id)
)
SELECT source_report_id,CASE WHEN rank=1 THEN 'kept' ELSE 'superseded' END AS decision,id AS history_id,keeper_id,
  enrollment_id,source_admission_id,report_date,identity_status,linked_report_id,
  rank>1 AND linked_report_id IS NOT NULL AND linked_report_id IS DISTINCT FROM keeper_report_id AS linked_elsewhere,updated_at
FROM ranked WHERE group_size>1
ORDER BY source_report_id,rank;

-- 3. Evidence-only rows grouped into attendance evidence (date and count).
SELECT h.enrollment_id,h.source_admission_id,h.report_date AS evidence_date,count(*) AS attendance_count,
  count(*) FILTER (WHERE h.attendance_status='present') AS present_count,
  count(*) FILTER (WHERE h.attendance_status='absent') AS absent_count,
  count(*) FILTER (WHERE h.linked_report_id IS NOT NULL) AS rows_with_linked_report,
  array_agg(h.id ORDER BY h.id) AS history_ids
FROM public.enrollment_history_reports h
WHERE h.identity_status='evidence_only'
GROUP BY h.enrollment_id,h.source_admission_id,h.report_date
ORDER BY h.enrollment_id,h.report_date;

-- 4. Lesson reports linked by more than one kept reportId. These stay
-- unbound and appear as occurrence_conflict in the post-upgrade report.
WITH kept AS (
  SELECT DISTINCT ON (h.source_origin,h.source_report_id) h.id,h.source_report_id,h.linked_report_id,h.identity_status
  FROM public.enrollment_history_reports h
  WHERE h.source_report_id IS NOT NULL
  ORDER BY h.source_origin,h.source_report_id,(h.identity_status='verified') DESC,(h.linked_report_id IS NOT NULL) DESC,h.updated_at DESC,h.version DESC,h.id
)
SELECT linked_report_id AS occurrence_report_id,array_agg(source_report_id ORDER BY source_report_id) AS source_report_ids,
  array_agg(id ORDER BY id) AS history_ids
FROM kept
WHERE identity_status='verified' AND linked_report_id IS NOT NULL
GROUP BY linked_report_id HAVING count(*)>1
ORDER BY linked_report_id;
