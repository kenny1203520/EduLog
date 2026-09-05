# EduLog Database Migration Guide

本資料夾包含 EduLog 專案的自定義資料庫 schema migration。  
請依照檔名順序執行，避免外鍵或 trigger 依賴錯誤。

## Migration 執行順序

1. `1000001_core_schema.sql`
2. `1000002_academics.sql`
3. `1000003_operations.sql`
4. `1000004_enhance_report_versions.sql`
5. `1000005_user_visibility_preferences.sql`
6. `1000006_copy_templates.sql`
7. `1000007_user_preferences.sql`
8. `1000008_session_time_zones.sql`
9. `1000009_date_record_time_zones.sql`
10. `1000011_create_profiles_table.sql`
11. `1000012_debug_report_access.sql`
12. `1000013_fix_rpc_authorization.sql`
13. `1000014_yjs_collab.sql`
14. `1000017_cleanup_deprecated_collab.sql`
15. `1000018_generic_yjs_documents.sql`
16. `1000019_koding_code_check.sql`
17. `1000020_merge_orange_apple_koding_credentials.sql`
18. `1000021_teacher_leave_and_safe_report_versions.sql`
19. `1000022_report_collab_snapshot_versioning.sql`
20. `1000023_rich_text_documents.sql`
21. `1000024_recurring_and_camp_sessions.sql`

## 各檔案重點

### 1) `1000001_core_schema.sql`

- 建立核心 helper function（如 `update_updated_at_column`）
- 建立學生相關核心資料表（students、contacts、schools、credentials）
- 啟用 RLS 與對應 policy / trigger

### 2) `1000002_academics.sql`

- 建立學術與排程相關資料表（courses、lessons、classrooms、class_sessions、holidays）
- 啟用 RLS 與 trigger

### 3) `1000003_operations.sql`

- 建立營運資料表（enrollments、class_occurrences、occurrence_reports、report_versions、suspensions）
- 建立報告版本快照 trigger
- 啟用 RLS 與必要約束

### 4) `1000004_enhance_report_versions.sql`

- 強化 `report_versions`，新增 `snapshot` 欄位（JSONB）
- 更新版本快照邏輯，記錄更完整的歷史資料

### 5) `1000005_user_visibility_preferences.sql`

- 新增 `user_entity_visibility_preferences`
- 支援使用者對 `classroom` / `class_session` 的隱藏偏好設定
- 啟用 RLS 與使用者自有資料存取策略

### 19) `1000022_report_collab_snapshot_versioning.sql`

- 為 `report_collab_docs` 加入 canonical report 版本欄位
- 新增原子化 `save_report_collab_snapshot` RPC，拒絕過期版本的 Yjs 快照
- 舊有未標記版本的快照會保留，但新版前端不會直接載入

### 20) `1000023_rich_text_documents.sql`

- 為報告、範本、課程描述、學生備註及教師簡介加入版本化 TipTap JSONB 欄位
- 保留既有純文字欄位作為搜尋、摘要、匯出及舊版相容的文字投影
- 使用者編輯器預設以 `user_preferences.editor_settings` 跨裝置保存
- 更新報告版本快照 trigger，使富文字與外觀變更可恢復

### 21) `1000024_recurring_and_camp_sessions.sql`

- 新增一般班級與營隊類型，以及每週、每月、指定日期排程模式
- 建立正規化班級排程規則、單日唯一限制與舊班級週排程回填
- 新增原子化儲存班級與排程規則的 `save_class_session_with_schedule` RPC
- 保留原有單日排程欄位作為部署期間的相容投影

### 22) `1000025_enrollment_classroom_consistency.sql`

- 依班級回填既有報名資料的教室欄位
- 驗證報名與轉班的目標班級能教授指定課程
- 在報名換班或班級變更教室時持續同步教室欄位

## 執行方式

### 方法 A: Supabase Studio（建議）

1. 啟動 `supabase` stack
2. 開啟 Studio SQL Editor
3. 依序貼上並執行上述 migration

### 方法 B: PowerShell + Docker（Windows）

在 `supabase/` 目錄執行：

```powershell
Get-ChildItem ./migrations/*.sql | Sort-Object Name | ForEach-Object {
    Get-Content -Raw $_.FullName | docker exec -i supabase-db psql -U postgres -d postgres
}
```

## 驗證

### 驗證 RLS 啟用狀態

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

### 驗證 Policy

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

## 注意事項

- migration 需按順序執行，不建議跳號執行。
- 若開發環境 schema 已偏離，建議重建資料庫後重新套用 migration。
- 正式環境變更前請先備份資料庫。
- 部署使用版本化報告協作快照的前端前，必須先套用 `1000022_report_collab_snapshot_versioning.sql`。
- 部署讀寫富文字文件的前端前，必須先套用 `1000023_rich_text_documents.sql`。
- 部署週期班與營隊排程前，必須先套用 `1000024_recurring_and_camp_sessions.sql`。
- 部署課程相容性篩選與教室同步前，必須先套用 `1000025_enrollment_classroom_consistency.sql`。
- 部署報告編輯器的 scoped RLS 與班級頁 placeholder provisioning 修正前，必須先套用 `1000036_editor_collaboration_reliability.sql`、`1000037_editor_security_hardening.sql`、`1000038_editor_rbac_boundary_hardening.sql`，最後套用 `1000039_editor_report_insert_rls_fix.sql`。
- `1000039_editor_report_insert_rls_fix.sql` 修正 occurrence_reports INSERT policy；請先在 staging 驗證授權教師、轉課 enrollment 與未授權使用者，再部署 production。

## Migration chain and reconciliation

The deployed history is intentionally immutable:

- 1000001-1000009: core schema, academics, operations and user preferences.
- 1000010, 1000015, 1000016: intentionally unused historical version numbers.
- 1000011-1000024: profiles, collaboration, credentials, recurring and reporting patches.
- 1000025-1000036: scheduling, role, collaboration and reliability patches.
- 1000037-1000042: editor security, scoped RLS, RBAC hardening and API foundation.
- 1000043_teaching_scope_reconciliation.sql: the canonical reconciliation entry point.

Do not edit or renumber 1000001-1000042. 1000043 is idempotent and is designed to converge a clean install or a database that received only part of the historical patches. It creates the teaching/member domain, performs owner-based backfill, installs canonical permissions and replaces core authenticated-wide policies with teaching-scoped RLS. Rows whose owner cannot be inferred are assigned only to the admin quarantine teaching.

### Operational procedure

1. Take a database backup and run the migration in staging first.
2. Apply the complete chain with supabase db push (or the configured deployment runner).
3. Re-run the deployment command to verify the migration is a no-op.
4. Verify that teachings and teaching_members exist and that classrooms, courses, and class_sessions have no NULL teaching_id.
5. Verify policy coverage with:
   select schemaname, tablename, policyname from pg_policies where schemaname = 'public' order by tablename, policyname;
6. Run API/RLS integration and frontend smoke tests before merging PR #7.

Rollback is restore-from-backup or a forward corrective migration. Do not delete migration history or manually undo deployed policies in production.