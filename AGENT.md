# AGENT.md - EduLog Developer Guide

> **Target Audience**: AI Agents & Developers
> **Project**: EduLog (Education Report Log)
> **Stack**: Vue 3 + TypeScript (app) · Express + TypeScript BFF (server) · Self-hosted Supabase (Postgres, Auth, Realtime, Storage) · Chrome MV3 extension

## 1. Project Context & Vision
EduLog is a specialized tool for tutors to write, manage, and sync student learning reports. It addresses the limitations of the official company website by providing a fast, real-time, cross-device interface.

### Key Use Case
- **Real-time Reporting**: Auto-save and sync report drafts as they are typed.
- **Split-Pane Lookup**: View past reports (same student) or peer reports (same course) side-by-side while writing.
- **Cross-Device**: Seamless transition between desktop and mobile.

### Company Integration
The browser extension (`extension/`) reads the official company site and syncs student lists, history reports and attendance into EduLog through the API's `/api/extension/*` routes.

---

## 2. Architecture & Design Principles

### Request path
```text
Browser (Vue app)  ─┐
Chrome extension   ─┴─> Nginx ── /api/* ──> Express (server/) ──> Supabase (internal network)
                         └──── /*  ──> Vue static files
```
- The browser never talks to Supabase and never holds a Supabase URL or key. Every request goes to the same-origin `/api/*` with an HttpOnly session cookie.
- Express uses a client carrying the user's JWT for ordinary data access, so Postgres RLS stays the last line of defense. The service-role client is reserved for narrow, server-checked operations.
- There are no edge functions and no browser runtime config; see `docs/deployment/frontend-api-bff.md` and `docs/deployment/environment.md`.

### Frontend layers (MVVM + Service)
1.  **Model** (`models/`): TypeScript classes for business entities; validation and formatting live here.
2.  **Service** (`services/<domain>/`): static classes that call the API. Components never call the HTTP clients directly.
3.  **ViewModel** (`stores/`, `composables/`): Pinia stores for shared state, composables for reusable view logic.
4.  **View** (`views/`, `components/`): render state and emit events; keep business logic out of `.vue` files.

### OOP Guidelines for Agents

#### A. Models (`app/src/models/`)
Use `class` to define entities. Encapsulate validation and formatting logic here.

```typescript
// app/src/models/Student.ts
export class Student {
  constructor(
    public id: string,
    public name: string,
    private _reports: Report[] = []
  ) {}

  get latestReport(): Report | null {
    if (this._reports.length === 0) return null;
    return this._reports.reduce((prev, current) =>
      (prev.createdAt > current.createdAt) ? prev : current
    );
  }

  isValid(): boolean {
    return this.name.length > 0;
  }
}
```

#### B. Services (`app/src/services/<domain>/`)
Services wrap the API clients in `services/api/`:
- `apiV1Client` (`ApiV1Client.ts`): raw `/api` requests; handles CSRF, idempotency keys, auth refresh and typed `ApiV1Error`s.
- `apiResourceClient` (`ApiResourceClient.ts`): generic list/get/create/update/remove for registry resources, mapping errors to `AppError` types.
- `PageApiService` / `AggregateService`: page read models under `/api/pages/*`.

```typescript
// app/src/services/report/ReportQueryService.ts
import { apiV1Client } from '@/services/api/ApiV1Client'
import { OccurrenceReport } from '@/models/OccurrenceReport'

export class ReportQueryService {
  /** Fetches one report by id. Throws ApiV1Error on failure. */
  static async getReportById(reportId: string): Promise<OccurrenceReport> {
    const response = await apiV1Client.get<any>('/reports/' + encodeURIComponent(reportId))
    return new OccurrenceReport(response.data)
  }
}
```

#### C. State Management (Pinia Stores)
Stores act as the "ViewModel". They hold instances of your *Models* and call *Services*.

```typescript
// app/src/stores/useStudentStore.ts
export const useStudentStore = defineStore('student', () => {
  const currentStudent = ref<Student | null>(null);

  async function loadStudent(id: string) {
    currentStudent.value = await StudentService.getById(id); // services return hydrated models
  }

  return { currentStudent, loadStudent };
});
```

---

## 3. Directory Structure
```
EduLog/
├── app/                    # Vue 3 frontend (Nginx image)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/         # Generic controls only (Base*, ConfirmModal, Pagination, ErrorToast…)
│   │   │   └── <domain>/   # classroom, copy-template, enrollment, occurrence, rbac, report (+ report/ai),
│   │   │                   # settings, student, teacher, text-editor
│   │   ├── composables/    # Reusable view logic (useAutoSave, useReportCollab, …)
│   │   ├── layouts/        # Page layouts (MainLayout)
│   │   ├── lib/            # Browser/platform integration (e.g. iosViewport)
│   │   ├── locales/        # zh-TW / en messages and in-app changelog
│   │   ├── models/         # [OOP] Domain entities
│   │   ├── router/
│   │   ├── services/
│   │   │   ├── api/        # HTTP clients and page read models
│   │   │   ├── errors/     # AppError taxonomy and error-to-i18n mapping
│   │   │   └── <domain>/   # ai, audit, auth, classroom, copy-template, course, enrollment, extension,
│   │   │                   # holiday, occurrence, preference, rbac, report, session, student, suspension, teacher
│   │   ├── stores/         # Pinia stores
│   │   ├── utils/          # Pure, framework-free helpers
│   │   └── views/          # Routed pages
│   └── tests/contracts/db/ # Specs that assert on supabase/migrations SQL
├── server/src/             # Express BFF: routes/{rest,pages,extension}, auth, realtime, ai, openapi
├── extension/              # Chrome MV3 extension (background, content, sidepanel, workspace, sites/)
├── supabase/               # Self-hosted Supabase: migrations/, tests/, volumes/, Compose overlays
├── scripts/                # Release, env-example check, extension packaging
└── docs/                   # Architecture, deployment and operations docs
```

Placement rules:
- `components/ui/` holds only domain-free controls; it must not import from a domain folder. Anything that knows about reports, students, sessions, etc. goes in that domain's folder.
- `lib/` is for browser or third-party integration; `utils/` is for pure functions with no side effects.
- New services go in their domain folder under `services/`, never at the `services/` root.
- Specs sit next to the code as `*.spec.ts`; source-reading contract specs are named `*.contract.spec.ts`.

---

## 4. Coding Standards

### Design Patterns to Employ
1.  **Singleton**: For the API client and global configuration services.
2.  **Factory Method**: For creating complex Model instances (e.g., `ReportFactory.createDraft()`).
3.  **Observer**: Vue's reactivity system handles this, but be mindful of explicit subscriptions in stores.
4.  **Strategy**: For handling different report types or export formats (e.g., `ExportStrategy`, `JsonExport`, `MarkdownExport`).

### Error Handling
- Use `try-catch` blocks in Services.
- Throw typed Errors (e.g., `NetworkError`, `ValidationError`).
- Handle UI feedback in the Store or View layer based on caught errors.

### Commits & Workflow
- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `docs:`.
- **Documentation**: All public methods in Services and Models must have JSDoc comments.

---

## 5. Specific Feature Implementation Guides

### Real-Time Sync
- Collaboration runs over the same-origin WebSocket proxy, never a direct Supabase Realtime connection. `ApiRealtimeChannel` first requests a short-lived ticket from `POST /api/realtime/ticket`, and the server authorizes the room.
- `CollaborationProvider` (Yjs) loads and saves version-guarded snapshots through `/api/reports/:id/collaboration`; `useReportCollab` wires it into the editor.
- Debounce text inputs in the UI before sending updates to avoid strict rate limits, but listen to incoming changes immediately.

### Split-Pane View
- The reference view (`components/report/ReportReferencePanel.vue`) sits beside the editor and loads history or peer reports on its own.
- Keep the editor and the reference view decoupled: share data through services or stores, not props passed deeper than 2 levels.

---

## 6. Quality Assurance & Version Control (CRITICAL)

### Testing & Verification
1. **Write Tests**: You must proactively write unit tests (`spec.ts`) for all new features, stores, services, and complex components.
2. **Pre-Release Checks**: Before any release or major merge, you **MUST** run `npm run test` and `npm run build` (inside the `app` directory) to catch any TypeScript, syntax, or logic errors. 
3. **Docker Verification**: Always verify that the Docker image build process works smoothly as part of the release checklist.

### Version Control (Git Flow)
1. **Strict Git Flow**: ALL Git operations must strictly adhere to the Git Flow standard.
2. **Branching**: Use `feature/`, `release/`, and `hotfix/` branches branching from `develop` (or `master` for hotfixes).
3. **Merging**: Never merge `develop` directly into `master`. Always merge `release/` or `hotfix/` branches into `master` and `develop` using the `--no-ff` flag to preserve branch topology.

### Release Management
1. **Release Branch Checklist**: When creating a `release/vX.Y.Z` branch, you MUST:
   - Bump the `"version"` field in `app/package.json` to match the new release version.
   - Update the root `CHANGELOG.md` with the new version's features, fixes, and notes.
   - Update the in-app changelog (e.g., `app/src/locales/en/changelog.json` & `zh-TW/changelog.json`) so users can see updates in the UI.
2. **GitHub Releases**: When a new version is released (i.e. tagging `master`), you MUST create a corresponding **GitHub Release** on the repository.
3. **Release Notes**: The release description must clearly document the version update contents (Changelog) and include any **Database/System Migration Manuals** if applicable.
