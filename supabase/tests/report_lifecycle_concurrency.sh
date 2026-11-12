#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp_dir="$(mktemp -d)"
save_pid=""
identity_pid=""

cleanup() {
  local status=$?
  if [[ -n "$save_pid" ]]; then kill "$save_pid" 2>/dev/null || true; wait "$save_pid" 2>/dev/null || true; fi
  if [[ -n "$identity_pid" ]]; then kill "$identity_pid" 2>/dev/null || true; wait "$identity_pid" 2>/dev/null || true; fi
  if ! psql -v ON_ERROR_STOP=1 -f "$script_dir/report_lifecycle_concurrency_cleanup.sql" >/dev/null; then
    echo 'Failed to clean report lifecycle concurrency fixture' >&2
    status=1
  fi
  rm -rf "$tmp_dir"
  exit "$status"
}
trap cleanup EXIT

wait_for_event() {
  local app_name="$1"
  local wait_event_type="$2"
  local wait_event="$3"
  for _ in $(seq 1 150); do
    if psql -Atqc "SELECT 1 FROM pg_stat_activity WHERE application_name = '$app_name' AND wait_event_type = '$wait_event_type' AND ('$wait_event' = '' OR wait_event = '$wait_event') LIMIT 1" | grep -q '^1$'; then
      return 0
    fi
    sleep 0.1
  done
  echo "Timed out waiting for $app_name to enter $wait_event_type/$wait_event" >&2
  return 1
}

assert_log_contains() {
  local expected="$1"
  local log_file="$2"
  if ! grep -q "$expected" "$log_file"; then
    cat "$log_file" >&2
    echo "Expected database error $expected" >&2
    return 1
  fi
}

psql -v ON_ERROR_STOP=1 -f "$script_dir/report_lifecycle_concurrency_setup.sql"

# A save first takes FOR SHARE on the linked enrollment and pauses after writing
# the report. Identity update must wait, then fail after seeing the committed
# lesson_entries reference.
PGAPPNAME=edulog_report_save_lock_first psql -v ON_ERROR_STOP=1 >"$tmp_dir/save-first.log" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000001', true);
SELECT public.apply_occurrence_report_lifecycle(
  'a1b00000-0000-4000-8000-000000000001', 1,
  jsonb_build_object(
    'content', 'race-one-save',
    'lesson_entries', jsonb_build_array(jsonb_build_object(
      'id', 'a1900000-0000-4000-8000-000000000001',
      'enrollment_id', 'a1800000-0000-4000-8000-000000000002',
      'course_id', 'a1400000-0000-4000-8000-000000000002',
      'lesson_id', 'a1500000-0000-4000-8000-000000000002',
      'is_completed', false, 'progress_letter', 'A'
    )),
    'primary_lesson_entry_id', 'a1900000-0000-4000-8000-000000000001'
  ),
  'a1100000-0000-4000-8000-000000000001', 'update'
);
COMMIT;
SQL
save_pid=$!
wait_for_event edulog_report_save_lock_first Timeout PgSleep

PGAPPNAME=edulog_identity_after_save psql -v ON_ERROR_STOP=1 -c "UPDATE public.enrollments SET student_id = 'a1700000-0000-4000-8000-000000000002' WHERE id = 'a1800000-0000-4000-8000-000000000002'" >"$tmp_dir/identity-after-save.log" 2>&1 &
identity_pid=$!
wait_for_event edulog_identity_after_save Lock ''

wait "$save_pid"
save_pid=""
if wait "$identity_pid"; then
  identity_pid=""
  echo 'Identity update unexpectedly succeeded after linked progress committed' >&2
  exit 1
else
  identity_pid=""
fi
assert_log_contains ENROLLMENT_HAS_LINKED_REPORT_PROGRESS "$tmp_dir/identity-after-save.log"
if [[ "$(psql -Atqc "SELECT jsonb_array_length(lesson_entries) FROM public.occurrence_reports WHERE id = 'a1b00000-0000-4000-8000-000000000001'")" != '1' ]]; then
  echo 'Save-first race did not commit exactly one linked lesson entry' >&2
  exit 1
fi

# An identity update first holds its NO KEY UPDATE row lock and pauses in a
# test-only trigger. The save blocks on FOR SHARE, then reads the new student
# id and rejects the now-mismatched lesson entry.
PGAPPNAME=edulog_identity_lock_first psql -v ON_ERROR_STOP=1 -c "UPDATE public.enrollments SET student_id = 'a1700000-0000-4000-8000-000000000002' WHERE id = 'a1800000-0000-4000-8000-000000000003'" >"$tmp_dir/identity-first.log" 2>&1 &
identity_pid=$!
wait_for_event edulog_identity_lock_first Timeout PgSleep

PGAPPNAME=edulog_report_save_after_identity psql -v ON_ERROR_STOP=1 >"$tmp_dir/save-after-identity.log" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000001', true);
SELECT public.apply_occurrence_report_lifecycle(
  'a1b00000-0000-4000-8000-000000000002', 1,
  jsonb_build_object(
    'content', 'race-two-save',
    'lesson_entries', jsonb_build_array(jsonb_build_object(
      'id', 'a1900000-0000-4000-8000-000000000002',
      'enrollment_id', 'a1800000-0000-4000-8000-000000000003',
      'course_id', 'a1400000-0000-4000-8000-000000000003',
      'lesson_id', 'a1500000-0000-4000-8000-000000000003',
      'is_completed', false, 'progress_letter', 'B'
    )),
    'primary_lesson_entry_id', 'a1900000-0000-4000-8000-000000000002'
  ),
  'a1100000-0000-4000-8000-000000000001', 'update'
);
COMMIT;
SQL
save_pid=$!
wait_for_event edulog_report_save_after_identity Lock ''

wait "$identity_pid"
identity_pid=""
if wait "$save_pid"; then
  save_pid=""
  echo 'Report save unexpectedly succeeded after the linked enrollment identity changed' >&2
  exit 1
else
  save_pid=""
fi
assert_log_contains REPORT_LESSON_ENROLLMENT_MISMATCH "$tmp_dir/save-after-identity.log"
if [[ "$(psql -Atqc "SELECT student_id FROM public.enrollments WHERE id = 'a1800000-0000-4000-8000-000000000003'")" != 'a1700000-0000-4000-8000-000000000002' ]]; then
  echo 'Identity-first race did not commit the identity change' >&2
  exit 1
fi
if [[ "$(psql -Atqc "SELECT version || ':' || jsonb_array_length(lesson_entries) FROM public.occurrence_reports WHERE id = 'a1b00000-0000-4000-8000-000000000002'")" != '1:0' ]]; then
  echo 'Rejected report save mutated the report after the identity change' >&2
  exit 1
fi

echo 'Report save/enrollment identity concurrency interleavings passed.'
