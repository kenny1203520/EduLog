-- Read-only preflight for 1000096_global_teaching_scope_and_person_profiles.sql.
-- Run this against the target database, export the result sets, resolve any
-- blocking counts, and take a restorable backup before applying the migration.
-- The queries report IDs and field names only; they do not return personal data.

-- Source row counts and class sessions that need the virtual classroom.
SELECT 'students' AS entity, count(*) AS row_count FROM public.students
UNION ALL SELECT 'teachers', count(*) FROM public.teachers
UNION ALL SELECT 'classrooms', count(*) FROM public.classrooms
UNION ALL SELECT 'courses', count(*) FROM public.courses
UNION ALL SELECT 'lessons', count(*) FROM public.lessons
UNION ALL SELECT 'class_sessions', count(*) FROM public.class_sessions
UNION ALL SELECT 'enrollments', count(*) FROM public.enrollments
UNION ALL SELECT 'class_occurrences', count(*) FROM public.class_occurrences
UNION ALL SELECT 'occurrence_reports', count(*) FROM public.occurrence_reports
UNION ALL SELECT 'report_templates', count(*) FROM public.report_templates
UNION ALL SELECT 'sessions_missing_classroom', count(*) FROM public.class_sessions WHERE classroom_id IS NULL;

-- Former account-owner values that will be cleared. Details identify the
-- table and column, not the users or their personal data.
SELECT 'students' AS table_name, count(*) AS rows_with_owner FROM public.students WHERE user_id IS NOT NULL
UNION ALL SELECT 'student_contacts', count(*) FROM public.student_contacts WHERE user_id IS NOT NULL
UNION ALL SELECT 'student_schools', count(*) FROM public.student_schools WHERE user_id IS NOT NULL
UNION ALL SELECT 'student_credentials', count(*) FROM public.student_credentials WHERE user_id IS NOT NULL
UNION ALL SELECT 'courses', count(*) FROM public.courses WHERE user_id IS NOT NULL
UNION ALL SELECT 'lessons', count(*) FROM public.lessons WHERE user_id IS NOT NULL
UNION ALL SELECT 'classrooms', count(*) FROM public.classrooms WHERE user_id IS NOT NULL
UNION ALL SELECT 'classroom_schedules', count(*) FROM public.classroom_schedules WHERE user_id IS NOT NULL
UNION ALL SELECT 'class_sessions', count(*) FROM public.class_sessions WHERE user_id IS NOT NULL
UNION ALL SELECT 'enrollments', count(*) FROM public.enrollments WHERE user_id IS NOT NULL
UNION ALL SELECT 'class_occurrences', count(*) FROM public.class_occurrences WHERE user_id IS NOT NULL
UNION ALL SELECT 'occurrence_reports', count(*) FROM public.occurrence_reports WHERE user_id IS NOT NULL
UNION ALL SELECT 'report_versions', count(*) FROM public.report_versions WHERE user_id IS NOT NULL
UNION ALL SELECT 'teacher_credentials', count(*) FROM public.teacher_credentials WHERE user_id IS NOT NULL;

-- Legacy root permissions are left at their original scope IDs and will not
-- automatically grant access to the global teaching scope.
SELECT assignment.scope_id AS source_scope_id, assignment.id AS assignment_id,
       assignment.user_id, assignment.role_id, assignment.effective_from, assignment.effective_to
FROM public.user_role_assignments assignment
WHERE assignment.scope_type = 'teaching'
ORDER BY assignment.scope_id, assignment.user_id, assignment.effective_from;

SELECT policy.scope_id AS source_scope_id, policy.role_id, permission.key AS permission_key, policy.effect
FROM public.role_permission_policies policy
JOIN public.permissions permission ON permission.id = policy.permission_id
WHERE policy.scope_type = 'teaching'
ORDER BY policy.scope_id, policy.role_id, permission.key;

-- Potential identity conflicts are listed for human review only. No rows are
-- combined by name, and no personal values are included in the output.
SELECT teacher.user_id AS account_id,
       array_agg(teacher.id ORDER BY teacher.created_at NULLS LAST, teacher.id) AS teacher_ids,
       count(*) AS teacher_count
FROM public.teachers teacher
WHERE teacher.user_id IS NOT NULL
GROUP BY teacher.user_id
HAVING count(*) > 1;

SELECT lower(btrim(name)) AS normalized_name,
       array_agg(id ORDER BY id) AS record_ids,
       count(*) AS record_count,
       'teachers' AS entity,
       ARRAY['name']::text[] AS fields
FROM public.teachers
WHERE NULLIF(btrim(name), '') IS NOT NULL
GROUP BY lower(btrim(name))
HAVING count(*) > 1
UNION ALL
SELECT lower(btrim(name)), array_agg(id ORDER BY id), count(*), 'students', ARRAY['name']::text[]
FROM public.students
WHERE NULLIF(btrim(name), '') IS NOT NULL
GROUP BY lower(btrim(name))
HAVING count(*) > 1;

SELECT teacher.id AS teacher_id, account.id AS account_id, ARRAY['display_name']::text[] AS conflicting_fields
FROM public.teachers teacher
JOIN public.profiles account ON account.id = teacher.user_id
WHERE NULLIF(btrim(account.display_name), '') IS NOT NULL
  AND lower(btrim(account.display_name)) <> lower(btrim(COALESCE(account.email, '')))
  AND lower(btrim(account.display_name)) <> lower(btrim(teacher.name));
