# Database Migration Guide

## 📋 Overview

This directory contains reorganized, consolidated database migrations for the EduLog system. All migrations have been reorganized by domain and include proper **Row Level Security (RLS)** policies.

---

## 🔢 Migration Files (Execution Order)

### For Fresh Installations

Run migrations in numerical order:

1. **`00001_foundation_student_management.sql`**
   - Core functions (update_updated_at_column)
   - Students, Contacts, Schools, Credentials
   - Reports (legacy)
   - **Complete RLS policies**

2. **`00002_course_lesson_system.sql`**
   - Courses, Lessons
   - Classrooms, Classroom Schedules
   - **Complete RLS policies**

3. **`00003_class_session_enrollment.sql`**
   - Class Sessions
   - Enrollments (linking students to courses)
   - Lesson Reports (legacy)
   - **Complete RLS policies**

4. **`00004_occurrence_reporting_with_rls.sql`**
   - Class Occurrences (individual class sessions)
   - Occurrence Reports (detailed progress tracking)
   - Report Versions (version history)
   - **Complete RLS policies** ✅ SECURITY FIX

---

### For Existing Databases (Patch)

If you have an existing database with missing RLS policies:

1. **`20260202_security_patch_rls.sql`** ⚠️ **CRITICAL SECURITY PATCH**
   - Adds RLS to `class_occurrences`
   - Adds RLS to `occurrence_reports`
   - Adds RLS to `report_versions`
   - Fixes `progress_letter` constraint (A-H → A-Z range support)

---

## 🔐 Security Issues Fixed

The following tables were **publicly accessible** without RLS:

| Table | Issue | Fix |
|-------|-------|-----|
| `class_occurrences` | No RLS | ✅ Policy: Users manage occurrences for their class sessions |
| `occurrence_reports` | No RLS | ✅ Policy: Users manage reports for their enrollments |
| `report_versions` | No RLS | ✅ Policy: Users view versions for their reports |

### Why This Matters

Without RLS, these tables were exposed via PostgREST, allowing potential unauthorized access. **All tables are now secured.**

---

## 🐛 Bug Fixes

### Progress Letter Constraint

**Before**: `CHECK (progress_letter ~ '^[A-H]$')`
- Only supported single letters A-H
- Did not support ranges (A-Z)

**After**: `CHECK (progress_letter ~ '^[A-Z](-[A-Z])?$')`
- ✅ Supports single letters: `A`, `B`, ..., `Z`
- ✅ Supports ranges: `A-Z`, `A-C`, `D-F`, etc.

---

## 📂 Schema Overview

### Core Entities

```
students
├── student_contacts (1:N)
├── student_schools (1:N)
├── student_credentials (1:N)
└── enrollments (1:N)
    └── occurrence_reports (1:N)

courses
├── lessons (1:N)
└── enrollments (1:N)

classrooms
├── classroom_schedules (1:N)
└── class_sessions (1:N)
    └── class_occurrences (1:N)
        └── occurrence_reports (1:N)
            └── report_versions (1:N)
```

### Key Relationships

- **Student** enrolls in **Courses**
- **Enrollments** link students to courses, sessions, and classrooms
- **Class Sessions** create **Class Occurrences** (actual class instances)
- **Occurrence Reports** track student progress per class occurrence
- **Report Versions** maintain version history for conflict resolution

---

## 🚀 Running Migrations

### Using Supabase CLI

```bash
# Fresh installation
cd supabase
supabase db push

# Or run individually
psql -h <host> -U <user> -d <database> -f migrations/00001_foundation_student_management.sql
psql -h <host> -U <user> -d <database> -f migrations/00002_course_lesson_system.sql
psql -h <host> -U <user> -d <database> -f migrations/00003_class_session_enrollment.sql
psql -h <host> -U <user> -d <database> -f migrations/00004_occurrence_reporting_with_rls.sql
```

### Using Supabase Dashboard

1. Navigate to **SQL Editor**
2. Copy and paste migration contents
3. Execute in order (00001 → 00002 → 00003 → 00004)

### For Existing Databases (Security Patch)

```bash
# Apply security patch
psql -h <host> -U <user> -d <database> -f migrations/20260202_security_patch_rls.sql
```

Or via Dashboard:
1. Go to SQL Editor
2. Copy `20260202_security_patch_rls.sql`
3. Execute

---

## ✅ Verification

### Verify RLS is Enabled

```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;
```

All tables should have `rowsecurity = true`.

### Verify Policies Exist

```sql
SELECT tablename, policyname, cmd
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### Test Progress Letter Constraint

```sql
-- These should work:
INSERT INTO occurrence_reports (enrollment_id, class_occurrence_id, progress_letter) 
VALUES ('<uuid>', '<uuid>', 'A');  -- ✅

INSERT INTO occurrence_reports (enrollment_id, class_occurrence_id, progress_letter) 
VALUES ('<uuid>', '<uuid>', 'A-Z');  -- ✅

-- This should fail:
INSERT INTO occurrence_reports (enrollment_id, class_occurrence_id, progress_letter) 
VALUES ('<uuid>', '<uuid>', 'A-H-Z');  -- ❌ Invalid format
```

---

## 📝 Notes

### Deprecated Files (supabase_docker/migrations)

The old `supabase_docker/migrations` directory contained fragmented migrations. These have been **consolidated and reorganized** into the new structure.

**Old files** (reference only):
- `20260201_consolidated_schema.sql` → Split into 00001, 00002
- `20260201_create_course_system.sql` → Merged into 00002
- `20260201_refine_class_system.sql` → Merged into 00003
- `20260201_session_occurrences.sql` → Reorganized into 00004
- `20260202_add_lesson_tracking_to_reports.sql` → Merged into 00004

### What Changed

1. ✅ **Proper Sequencing**: Migrations now have clear dependencies
2. ✅ **Complete RLS**: Every table has proper security policies
3. ✅ **Bug Fixes**: Progress letter constraint fixed
4. ✅ **Documentation**: Comments and schema descriptions
5. ✅ **Indexes**: Performance indexes added

---

## 🔗 Related Documentation

- [Supabase RLS Guide](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Database Linter](https://supabase.com/docs/guides/database/database-linter)
- [Migration Best Practices](https://supabase.com/docs/guides/cli/managing-environments)

---

**Last Updated**: 2026-02-02  
**Version**: 1.0.0  
**Status**: ✅ Production Ready
