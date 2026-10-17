-- Read-only preflight for 1000097. Export results before applying the cutover.
SELECT 'account_profiles' AS category, count(*) AS row_count
FROM public.profiles;

SELECT 'person_profiles' AS category, count(*) AS row_count
FROM public.person_profiles;

SELECT 'teacher_records' AS category, count(*) AS row_count
FROM public.teachers;

SELECT 'linked_account_teachers' AS category, count(*) AS row_count
FROM public.teachers teacher
JOIN public.profiles account ON account.id = teacher.user_id;

SELECT 'profile_field_conflicts' AS category,
       teacher.id AS teacher_id,
       account.id AS account_id,
       person.id AS person_profile_id,
       fields.field_name
FROM public.teachers teacher
JOIN public.profiles account ON account.id = teacher.user_id
JOIN public.person_profiles person ON person.id = teacher.person_profile_id
CROSS JOIN LATERAL (VALUES
  ('display_name', account.display_name, person.display_name),
  ('contact_email', person.contact_email, teacher.email),
  ('phone', person.phone, teacher.phone),
  ('government_id', person.government_id, teacher.gov_id),
  ('address', person.address, teacher.address),
  ('birthday', person.birthday::text, teacher.birthday::text),
  ('bio', person.bio, teacher.bio)
) AS fields(field_name, account_value, teacher_value)
WHERE NULLIF(btrim(fields.account_value), '') IS NOT NULL
  AND NULLIF(btrim(fields.teacher_value), '') IS NOT NULL
  AND fields.account_value IS DISTINCT FROM fields.teacher_value
ORDER BY teacher.id, fields.field_name;

-- Account display names are authoritative unless the old UI had copied the
-- login email into the display-name field. Report only the conflicting IDs
-- and field names; never export personal values into the preflight report.
SELECT 'account_person_field_conflicts' AS category,
       account.id AS account_id,
       person.id AS person_profile_id,
       'display_name' AS field_name
FROM public.profiles account
JOIN public.person_profiles person ON person.id = account.person_profile_id
WHERE NULLIF(btrim(account.display_name), '') IS NOT NULL
  AND lower(btrim(account.display_name)) <> lower(btrim(account.email))
  AND NULLIF(btrim(person.display_name), '') IS NOT NULL
  AND account.display_name IS DISTINCT FROM person.display_name
ORDER BY account.auth_user_id;

SELECT 'person_profile_rows_without_teacher_or_account' AS category,
       count(*) AS row_count
FROM public.person_profiles person
WHERE NOT EXISTS (SELECT 1 FROM public.profiles account WHERE account.person_profile_id = person.id)
  AND NOT EXISTS (SELECT 1 FROM public.teachers teacher WHERE teacher.person_profile_id = person.id);

SELECT 'unlinked_teachers' AS category, count(*) AS row_count
FROM public.teachers
WHERE user_id IS NULL;
