# EduLog 目前資料庫架構

> 本文件依目前 repository 的實際 migration 與程式碼整理。資料庫變更前，請先確認目標環境已套用的 migration history；不要只依文件推測 production 狀態。

## 1. 目前版本與執行順序

目前 migration 目錄的實際狀態如下：

```text
1000001–1000009  核心、人員、學術與時間欄位
1000010          歷史未使用編號
1000011–1000014  profile、診斷與 collaboration
1000015–1000016  歷史未使用編號
1000017–1000039  collaboration、credential、報表、轉課與 editor patch
1000040          consolidated backend security reconciliation
1000041          legacy upgrade consistency bridge
```

重要事項：

- `1000001–1000039` 視為歷史 migration，不應重寫。
- 既有 `1000040`–`1000064` 保留為逐檔、append-only 的 migration history；新增 `1000057a` 僅供 clean/upgrade chain 在 `1000058` 前替換舊 RBAC scope checks，`1000065` 修復已套用 `1000058` 的資料庫，`1000066` 修復 RBAC policy replacement RPC 的原子寫入/RLS 自我阻擋問題。
- `1000041a_has_api_permission_compatibility.sql` 是排序於 `1000041` 與 `1000042` 之間的相容 migration；不存在 consolidated security migration。
- `1000010`、`1000015`、`1000016` 是歷史未使用編號，不是待補的 migration。
- 需要修正已套用資料庫時，新增 forward migration，不修改已部署檔案；已套用 `1000058` 的資料庫依序執行 `1000065`、`1000066`，不可倒序套用 `1000057a`。
- `1000066` 僅讓 RBAC policy replacement RPC 在完成 canonical scope/permission 驗證後以單一交易執行；直接對 `role_permission_policies` 的讀寫仍受 RLS 限制，匿名角色不可呼叫該 RPC。

推薦流程：

```text
bootstrap Supabase/Postgres
  → 依檔名順序執行所有 migrations
  → 1000040 reconciliation
  → 1000041 legacy upgrade consistency
  → migration/RLS assertions
```

## 2. 邏輯分層

### Identity 與使用者設定

`auth.users` 是 Supabase Auth 管理的外部基礎表，`public` 表透過 foreign key 連結使用者：

- `profiles`：使用者公開/應用 profile。
- `user_preferences`：使用者偏好。
- `user_entity_visibility_preferences`：使用者對實體的可見性偏好。

### 人員與敏感資料

- `students`：學生主檔，`user_id` 表示建立/擁有者。
- `student_contacts`：學生聯絡人，透過 `student_id` 連結學生。
- `student_schools`：學生學校資料，透過 `student_id` 連結學生。
- `student_credentials`：學生外部平台帳密，屬敏感資料。
- `teachers`：教師主檔，`user_id` 可連結 Auth 使用者，`email` 為必填。
- `teacher_credentials`：教師外部平台帳密，屬敏感資料。

敏感資料不可用一般 authenticated-wide policy 保護；有效存取應由 owner、teaching scope 或明確 permission 決定，API 也只能回傳 allowlist 欄位。

### Teaching 與學術資源

`teachings` 是目前的 scope root：

- `teachings`：教學/租戶邊界，含 `owner_user_id` 與 quarantine 標記。
- `teaching_members`：使用者加入 teaching 的 membership、狀態、有效日期與角色。
- `classrooms`：教室，透過 `teaching_id` 歸屬 teaching。
- `classroom_schedules`：教室固定時間表，透過 `classroom_id` 歸屬 teaching。
- `courses`：課程，透過 `teaching_id` 歸屬 teaching。
- `lessons`：課程單元，透過 `course_id` 間接歸屬 teaching。
- `class_sessions`：課堂場次，透過 `teaching_id` 及 `classroom_id/course_ids` 歸屬 teaching。
- `class_session_schedule_rules`：課堂週期/營隊排程規則，透過 `class_session_id` 歸屬 teaching。
- `class_session_teachers`：場次與教師 assignment，透過 `class_session_id` 歸屬 teaching，另有 effective date。
- `holidays`：假日，可用 classroom/session UUID 陣列指定作用範圍。

核心關係：

```text
teaching
├── teaching_members ── user / role
├── classrooms
│   └── classroom_schedules
├── courses
│   └── lessons
├── class_sessions
│   ├── class_session_schedule_rules
│   └── class_session_teachers ── teachers
└── holidays
```

### 教學運作與報表

- `enrollments`：student 加入 course/classroom/session 的紀錄。
- `class_occurrences`：class session 的實際發生日期與出席/教師資訊。
- `occurrence_reports`：學生在 occurrence 的教學報告；具唯一 enrollment/occurrence 組合。
- `report_versions`：報告歷史版本，由報告更新 trigger 建立 snapshot。
- `report_templates`：教學報告模板，透過 `teaching_id` 與 instructor scope 連結。
- `student_suspensions`：enrollment 的暫停期間。

```text
students ──< enrollments >── courses
                         ├── classrooms
                         └── class_sessions ──< class_occurrences
                                                   └──< occurrence_reports
                                                         └──< report_versions
```

`occurrence_reports` 的 teaching scope 應由 occurrence → class session → teaching 解析；enrollment 則由 session 或 classroom 解析，不能只看任意 `user_id`。

### Collaboration、文件與轉課

- `report_collab_docs`：報告 collaboration 文件與 snapshot 相關資料。
- `documents`：通用 Yjs/文件資料。
- `copy_templates`：複製用模板。
- `rich_text_documents` 相關欄位/功能：由後續歷史 patch 維護。
- `single_lesson_transfers`：單堂課轉移。
- `single_lesson_transfer_report_archives`：轉課時的報告封存。
- 轉課後續的 effective targets、history、conflict resolution 與 repair 邏輯主要以 RPC 維護資料一致性。

## 3. RBAC 資料模型

RBAC 分成 system 與 teaching 兩個 domain，permission canonical key 格式為：

```text
domain.resource.action
```

主要資料表：

- `roles`：角色定義；system role 與 custom role 由 `is_system` 區分。
- `permissions`：permission catalogue，含 `domain`、`resource`、`action`、`conditions`。
- `role_permission_policies`：role 在 system/teaching/classroom/class_session scope 下的 allow/deny。
- `user_role_assignments`：使用者直接角色指派與有效日期。
- `teaching_members`：teaching membership 及預設 teaching role。
- `role_inheritance`：角色繼承圖，禁止 self-loop 與循環。
- `rbac_policy_epoch`：RBAC 變更版本；角色、繼承、policy、assignment、membership 變更會遞增 epoch。

system 資源主要包括：

```text
users, roles, permissions, audit, settings
```

teaching 資源主要包括：

```text
teachings, members, courses, lessons, classrooms, class_sessions,
students, enrollments, occurrences, reports, templates, holidays
```

解析規則：

1. 先取得使用者在 system/teaching/classroom/class_session 的有效角色。
2. 遞迴展開 `role_inheritance`。
3. 依 permission 與 scope 找出 policy。
4. deny 優先於 allow。
5. API 應先呼叫 canonical permission RPC，再以 user-JWT client 執行資料查詢，讓 PostgreSQL RLS 再驗證一次。

## 4. RLS 與安全邊界

`1000040` 建立/重建下列共用 helper：

```text
is_teaching_member
can_access_teaching
can_access_classroom
can_access_class_session
can_access_student
can_access_enrollment
can_access_report
```

一般資料存取邊界：

- browser 不應直接持有 service-role key。
- Express/Edge API 的一般資料查詢使用帶 user JWT 的 Supabase client。
- service-role 僅用於 user validation、audit、idempotency、rate-limit 與明確管理任務。
- `api_idempotency_keys` 與 `api_rate_limit_buckets` 僅供 server-side service-role RPC 使用。
- `audit_events` 由 server-side 寫入；使用者只可讀取自己的事件，管理者依 system permission 讀取。
- `student_credentials`、`teacher_credentials` 與 contact 資料不能因 authenticated 身份而全域可見。

目前需要持續以 catalog assertion 追蹤的高風險項目：

- 歷史 migration source 仍包含 authenticated-wide policy；只能以最後有效 catalog 狀態判定是否已移除。
- `class_session_schedule_rules` 等歷史表的 policy 必須確認沒有殘留全域存取；若 production catalog 仍存在，使用 forward migration 補 canonical CRUD policies。
- RLS 不取代 table privilege；authenticated 必須有必要 SQL privilege，但 row access 仍由 policy 限制。
- 凡是 `SECURITY DEFINER` function 都必須固定 `search_path`、明確 revoke/grant，並避免把它變成跨 teaching existence oracle。

## 5. 平台控制資料

- `audit_events`：操作者、domain、resource、resource_id、scope、request_id、outcome、metadata。
- `api_idempotency_keys`：以 `(user_id, idempotency_key)` 去重，保存 mutation route、status、response body 與 expiry。
- `api_rate_limit_buckets`：只保存 hashed bucket key、計數與 reset 時間，不保存原始 IP。
- `rbac_policy_epoch`：供 permission cache invalidation 使用。

## 6. API 對照

目前 Express API 的主要 resource 對照如下：

| API resource | DB table | scope 解析 | 備註 |
| --- | --- | --- | --- |
| `teachings` | `teachings` | teaching | owner/member scope |
| `classrooms` | `classrooms` | `teaching_id` | teaching CRUD |
| `courses` | `courses` | `teaching_id` | teaching CRUD |
| `lessons` | `lessons` | `course_id → teaching` | 不可只以 lesson id 當 scope |
| `class-sessions` | `class_sessions` | `teaching_id`/classroom | 同時保留 `class_sessions` alias |
| `students` | `students` | owner/enrollment → teaching | 敏感欄位需 projection |
| `teachers` | `teachers` | session assignment → teaching | credentials 分離 |
| `enrollments` | `enrollments` | session/classroom | 需一致的 session/classroom scope |
| `occurrences` | `class_occurrences` | session → teaching | occurrence CRUD |
| `reports` | `occurrence_reports` | occurrence → session → teaching | lifecycle RPC 優先 |
| `report-templates` | `report_templates` | `teaching_id` | template scope |
| `holidays` | `holidays` | classroom/session arrays | 空 scope 需 system permission |
| `roles` | `roles` | system | custom role 才可修改 |
| `permissions` | `permissions` | system | read-only catalogue |
| `audit-events` | `audit_events` | actor/system audit permission | read-only API |

所有 API query 應使用 registry 的明確欄位 allowlist；不得使用 `select('*')`。collection 的 `limit`、`offset`、sort、filter 與 total 應由 server-side query 統一處理。

## 7. 目前驗證狀態

截至目前工作目錄的 latest commit `824c73e`：

- GitHub required checks：`server`、`deno`、`deno-api-contract`、`migration-and-rls`、`deployment-contract`、`frontend-regression` 全部通過。
- PR #7 狀態仍為 `OPEN`，merge state 為 `CLEAN`。
- 本機未提供完整 PostgreSQL/Supabase runtime；production migration 狀態仍應以實際部署 catalog 與 backup/upgrade 驗證為準。

## 8. 前端/後端實作時的使用規則

1. 先判定 resource 的 teaching scope，再呼叫 permission RPC。
2. 使用 user-JWT Supabase client 查詢或 mutation，保留 RLS enforcement。
3. 回應只投影 API allowlist 欄位，credentials 與 contact 欄位不可混入一般 projection。
4. mutation 必須帶 `Idempotency-Key`，重試只重放原 status/body。
5. 寫入/拒絕/失敗都建立 audit event，並關聯 request/trace ID。
6. schema、permission、RLS 或 migration 變更必須同步更新 static、integration 與 API contract tests。
