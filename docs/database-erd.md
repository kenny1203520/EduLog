# EduLog Database ERD

本文件依目前 `supabase/migrations/1000001` 至 `1000041` 的實際 schema 整理。為保持可讀性，完整資料庫拆成三張 ERD；三張圖合起來涵蓋目前 repository 內的資料表。

## 1. Identity、people 與 teaching membership

```mermaid
erDiagram
    authUsers["auth.users"] {
        uuid id PK
        text email
        jsonb rawUserMetaData
    }
    profiles["profiles"] {
        uuid id PK, FK
        text email
        text displayName
        text avatarUrl
    }
    userPreferences["user_preferences"] {
        uuid id PK
        uuid userId FK
        text timeZone
    }
    visibilityPreferences["user_entity_visibility_preferences"] {
        uuid id PK
        uuid userId FK
        text entityType
        uuid entityId
        bool isHidden
    }
    students["students"] {
        uuid id PK
        text name
        uuid userId FK
        text email
        text phone
        date birthday
    }
    studentContacts["student_contacts"] {
        uuid id PK
        uuid studentId FK
        text name
        text relation
        uuid userId FK
    }
    studentSchools["student_schools"] {
        uuid id PK
        uuid studentId FK
        text name
        text status
        uuid userId FK
    }
    studentCredentials["student_credentials"] {
        uuid id PK
        uuid studentId FK
        text platform
        text username
        text password
        uuid userId FK
    }
    teachers["teachers"] {
        uuid id PK
        text name
        uuid userId FK
        text email UK
        text phone
    }
    teacherCredentials["teacher_credentials"] {
        uuid id PK
        uuid teacherId FK
        text platform
        text username
        text password
        uuid userId FK
    }
    teachings["teachings"] {
        uuid id PK
        text name
        uuid ownerUserId FK
        bool isQuarantine
    }
    teachingMembers["teaching_members"] {
        uuid teachingId PK, FK
        uuid userId PK, FK
        uuid roleId FK
        text status
        date effectiveFrom
        date effectiveTo
    }

    authUsers ||--o| profiles : has
    authUsers ||--o{ userPreferences : owns
    authUsers ||--o{ visibilityPreferences : configures
    authUsers ||--o{ students : owns
    students ||--o{ studentContacts : has
    students ||--o{ studentSchools : attends
    students ||--o{ studentCredentials : protects
    authUsers ||--o{ studentContacts : owns
    authUsers ||--o{ studentSchools : owns
    authUsers ||--o{ studentCredentials : owns
    authUsers ||--o| teachers : maps
    teachers ||--o{ teacherCredentials : protects
    authUsers ||--o{ teacherCredentials : owns
    authUsers ||--o{ teachings : owns
    teachings ||--o{ teachingMembers : contains
    authUsers ||--o{ teachingMembers : joins
```

## 2. Teaching、課務、排程與報表

```mermaid
erDiagram
    teachings["teachings"] {
        uuid id PK
        text name
        uuid ownerUserId FK
        bool isQuarantine
    }
    classrooms["classrooms"] {
        uuid id PK
        uuid teachingId FK
        text name
        uuid userId FK
    }
    classroomSchedules["classroom_schedules"] {
        uuid id PK
        uuid classroomId FK
        int dayOfWeek
        time startTime
        time endTime
    }
    courses["courses"] {
        uuid id PK
        uuid teachingId FK
        text subject
        text stage
        uuid userId FK
    }
    lessons["lessons"] {
        uuid id PK
        uuid courseId FK
        text title
        int sequence
        uuid userId FK
    }
    classSessions["class_sessions"] {
        uuid id PK
        uuid teachingId FK
        uuid classroomId FK
        uuidArray courseIds
        text sessionType
        text scheduleMode
    }
    scheduleRules["class_session_schedule_rules"] {
        uuid id PK
        uuid classSessionId FK
        text scheduleKind
        int dayOfWeek
        date occurrenceDate
        time startTime
        time endTime
    }
    sessionTeachers["class_session_teachers"] {
        uuid id PK
        uuid classSessionId FK
        uuid teacherId FK
        uuid roleId FK
        date effectiveFrom
        date effectiveTo
    }
    holidays["holidays"] {
        uuid id PK
        text name
        date startDate
        date endDate
        uuidArray classroomIds
        uuidArray classSessionIds
    }
    students["students"] {
        uuid id PK
        text name
        uuid userId FK
    }
    teachers["teachers"] {
        uuid id PK
        text name
        uuid userId FK
    }
    enrollments["enrollments"] {
        uuid id PK
        uuid studentId FK
        uuid courseId FK
        uuid classroomId FK
        uuid classSessionId FK
        text status
        uuid userId FK
    }
    occurrences["class_occurrences"] {
        uuid id PK
        uuid classSessionId FK
        date occurrenceDate
        text status
        uuidArray teacherIds
    }
    reports["occurrence_reports"] {
        uuid id PK
        uuid enrollmentId FK
        uuid classOccurrenceId FK
        uuid lessonId FK
        int version
        bool isCompleted
        text attendanceStatus
    }
    reportVersions["report_versions"] {
        uuid id PK
        uuid occurrenceReportId FK
        int version
        uuid editedBy FK
        datetime createdAt
    }
    reportTemplates["report_templates"] {
        uuid id PK
        uuid teachingId FK
        uuid instructorId FK
        text name
        text content
    }
    suspensions["student_suspensions"] {
        uuid id PK
        uuid enrollmentId FK
        date startDate
        date endDate
        text reason
    }

    teachings ||--o{ classrooms : contains
    classrooms ||--o{ classroomSchedules : schedules
    teachings ||--o{ courses : contains
    courses ||--o{ lessons : contains
    teachings ||--o{ classSessions : contains
    classrooms ||--o{ classSessions : hosts
    classSessions ||--o{ scheduleRules : schedules
    classSessions ||--o{ sessionTeachers : assigns
    teachers ||--o{ sessionTeachers : teaches
    students ||--o{ enrollments : enrolls
    courses ||--o{ enrollments : receives
    classrooms ||--o{ enrollments : places
    classSessions ||--o{ enrollments : schedules
    classSessions ||--o{ occurrences : occurs
    enrollments ||--o{ reports : produces
    occurrences ||--o{ reports : contains
    lessons ||--o{ reports : references
    reports ||--o{ reportVersions : versions
    teachings ||--o{ reportTemplates : owns
    enrollments ||--o{ suspensions : pauses
    classSessions }o..o{ courses : courseIds_array
    occurrences }o..o{ teachers : teacherIds_array
    holidays }o..o{ classrooms : classroomIds_array
    holidays }o..o{ classSessions : classSessionIds_array
```

## 3. RBAC、audit、idempotency、協作與轉課

```mermaid
erDiagram
    roles["roles"] {
        uuid id PK
        text name
        text domain
        bool isSystem
    }
    permissions["permissions"] {
        uuid id PK
        text key UK
        text domain
        text resource
        text action
    }
    rolePolicies["role_permission_policies"] {
        uuid id PK
        uuid roleId FK
        uuid permissionId FK
        text effect
        text scopeType
        uuid scopeId
    }
    userAssignments["user_role_assignments"] {
        uuid id PK
        uuid userId FK
        uuid roleId FK
        text scopeType
        uuid scopeId
        date effectiveFrom
    }
    roleInheritance["role_inheritance"] {
        uuid roleId PK, FK
        uuid parentRoleId PK, FK
        datetime createdAt
    }
    rbacEpoch["rbac_policy_epoch"] {
        bool singleton PK
        bigint epoch
        datetime updatedAt
    }
    auditEvents["audit_events"] {
        uuid id PK
        uuid actorUserId FK
        text action
        text domain
        text resource
        uuid resourceId
        uuid scopeId
        text outcome
    }
    idempotencyKeys["api_idempotency_keys"] {
        uuid userId PK, FK
        text idempotencyKey PK
        text method
        text route
        int responseStatus
        datetime expiresAt
    }
    rateLimitBuckets["api_rate_limit_buckets"] {
        text bucketKey PK
        datetime windowStartedAt
        int requestCount
        datetime resetAt
    }
    reportCollabDocs["report_collab_docs"] {
        uuid id PK
        uuid occurrenceReportId FK
        text snapshotBase64
        uuid lastUpdatedBy FK
    }
    documents["documents"] {
        uuid id PK
        text roomId UK
        text content
        uuid createdBy FK
        uuid updatedBy FK
    }
    copyTemplates["copy_templates"] {
        uuid id PK
        uuid userId FK
        text templateType
        text scopeType
        text scopeEntityId
    }
    transfers["single_lesson_transfers"] {
        uuid id PK
        uuid enrollmentId FK
        uuid sourceOccurrenceId FK
        uuid targetOccurrenceId FK
        uuid createdBy FK
    }
    transferArchives["single_lesson_transfer_report_archives"] {
        uuid id PK
        uuid transferId FK
        uuid sourceReportId
        jsonb sourceReport
        jsonb sourceVersions
    }
    authUsers["auth.users"] {
        uuid id PK
        text email
    }
    teachings["teachings"] {
        uuid id PK
        text name
    }
    reportTemplates["report_templates"] {
        uuid id PK
        uuid teachingId FK
    }
    reports["occurrence_reports"] {
        uuid id PK
        uuid enrollmentId FK
        uuid classOccurrenceId FK
    }
    enrollments["enrollments"] {
        uuid id PK
    }
    occurrences["class_occurrences"] {
        uuid id PK
        uuid classSessionId FK
    }
    transfers ||--o{ transferArchives : archives
    reports ||--o| reportCollabDocs : collaborates
    authUsers ||--o{ auditEvents : acts
    authUsers ||--o{ idempotencyKeys : deduplicates
    roles ||--o{ rolePolicies : grants
    permissions ||--o{ rolePolicies : describes
    roles ||--o{ userAssignments : assigned
    authUsers ||--o{ userAssignments : receives
    roles ||--o{ roleInheritance : inherits
    roles ||--o{ roleInheritance : parentOf
    teachings }o..o{ rolePolicies : scopeId
    teachings }o..o{ userAssignments : scopeId
    reports ||--o| reportCollabDocs : persists
    enrollments ||--o{ transfers : moves
    occurrences ||--o{ transfers : sourceOrTarget
    authUsers ||--o{ documents : edits
    authUsers ||--o{ copyTemplates : owns
    reportTemplates }o..o{ copyTemplates : scopeEntityId
```

## 關聯與安全註記

- 實線代表 migration 中有明確 foreign key；虛線代表陣列欄位或由 scope/RPC 解析的邏輯關聯。
- `teachings` 是主要 teaching scope root；`lessons`、`enrollments`、`occurrence_reports` 等資源需沿關聯解析 teaching，不能只依 `user_id` 判斷。
- `student_credentials`、`teacher_credentials`、contact 欄位屬敏感資料，API projection 不應與一般資料混出。
- `rbac_policy_epoch`、`role_inheritance`、`role_permission_policies` 與 `userAssignments` 共同形成 RBAC 快取失效與 deny-precedence 邏輯。
- `api_rate_limit_buckets` 不保存原始 IP；`api_idempotency_keys` 以使用者與 key 去重。
- `class_session.course_ids`、`class_occurrences.teacher_ids`、`holidays.classroom_ids/class_session_ids` 目前是 UUID 陣列，不是可由 PostgreSQL 自動維護的 FK。
