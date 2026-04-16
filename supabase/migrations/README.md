# EduLog Database Migration Guide

本資料夾包含 EduLog 專案的自定義資料庫 schema migration。  
請依照檔名順序執行，避免外鍵或 trigger 依賴錯誤。

## Migration 執行順序

1. `1000001_core_schema.sql`
2. `1000002_academics.sql`
3. `1000003_operations.sql`
4. `1000004_enhance_report_versions.sql`
5. `1000005_user_visibility_preferences.sql`

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

## 執行方式

### 方法 A: Supabase Studio（建議）

1. 啟動 `supabase` stack
2. 開啟 Studio SQL Editor
3. 依序貼上並執行上述 5 個 migration

### 方法 B: PowerShell + Docker（Windows）

在 `supabase/` 目錄執行：

```powershell
Get-Content -Raw ./migrations/1000001_core_schema.sql | docker exec -i supabase-db psql -U postgres -d postgres
Get-Content -Raw ./migrations/1000002_academics.sql | docker exec -i supabase-db psql -U postgres -d postgres
Get-Content -Raw ./migrations/1000003_operations.sql | docker exec -i supabase-db psql -U postgres -d postgres
Get-Content -Raw ./migrations/1000004_enhance_report_versions.sql | docker exec -i supabase-db psql -U postgres -d postgres
Get-Content -Raw ./migrations/1000005_user_visibility_preferences.sql | docker exec -i supabase-db psql -U postgres -d postgres
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
