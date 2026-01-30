# AGENT.md - EduLog Developer Guide

> **Target Audience**: AI Agents & Developers
> **Project**: EduLog (Education Report Log)
> **Stack**: Vue.js 3 + TypeScript + Supabase (Self-hosted)

## 1. Project Context & Vision
EduLog is a specialized tool for tutors to write, manage, and sync student learning reports. It addresses the limitations of the official company website by providing a fast, real-time, cross-device interface.

### Key Use Case
- **Real-time Reporting**: Auto-save and sync report drafts as they are typed.
- **Split-Pane Lookup**: View past reports (same student) or peer reports (same course) side-by-side while writing.
- **Cross-Device**: Seamless transition between desktop and mobile.

### Future Roadmap
- **Company Integration**: An unofficial interface to scrape/fetch cookies from the official company site to pull student lists and auto-fill data.

---

## 2. Architecture & Design Principles
This project enforces **Object-Oriented Programming (OOP)** principles within a functional framework (Vue.js Composition API). We utilize strict **Software Engineering Design Patterns** to ensure maintainability and scalability.

### Core Architectural Pattern: MVVM + Service Logic
We separate concerns into three distinct layers:

1.  **Model (Domain Layer)**: Pure TypeScript classes representing business entities.
2.  **Service (Data Layer)**: Static/Singleton classes handling API interactions (Supabase).
3.  **ViewModel (State Layer/Pinia)**: Manages reactive state and business logic application.
4.  **View (UI Layer)**: Dumb Vue components that render state and emit events.

### OOP Guidelines for Agents
When creating new features, do NOT put business logic in `.vue` files. Follow this structure:

#### A. Models (`src/models/`)
Use `class` to define entities. Encapsulate validation and formatting logic here.

```typescript
// src/models/Student.ts
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

#### B. Services (`src/services/`)
Use the **Repository Pattern** or **Service Objects** to handle data fetching. This abstracts the Supabase client implementation details.

```typescript
// src/services/ReportService.ts
import { supabase } from '@/lib/supabase';
import { Report } from '@/models/Report';

export class ReportService {
  /**
   * Fetches reports by student ID.
   * @throws ServiceError
   */
  static async getByStudent(studentId: string): Promise<Report[]> {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('student_id', studentId);
      
    if (error) throw new Error(error.message);
    
    return data.map(dto => new Report(dto));
  }
}
```

#### C. State Management (Pinia Stores)
Stores act as the "ViewModel". They hold instances of your *Models* and call *Services*.

```typescript
// src/stores/useStudentStore.ts
export const useStudentStore = defineStore('student', () => {
  const currentStudent = ref<Student | null>(null);

  async function loadStudent(id: string) {
    const data = await StudentService.getById(id);
    currentStudent.value = new Student(data); // Hydrate class instance
  }

  return { currentStudent, loadStudent };
});
```

---

## 3. Directory Structure
```
src/
├── components/     # UI Components (Presentational)
│   ├── ui/         # Generic UI (Buttons, Inputs)
│   └── feature/    # Feature-specific (ReportEditor, StudentList)
├── layouts/        # Page layouts (SplitPaneLayout)
├── models/         # [OOP] Domain Entities (Class definitions)
├── services/       # [OOP] API & Data Handling (Static/Singleton)
├── stores/         # State Management (Pinia)
├── views/          # Page definitions
└── lib/            # Third-party config (Supabase, Utils)
```

---

## 4. Coding Standards

### Design Patterns to Employ
1.  **Singleton**: For the Supabase client wrapper and global configuration services.
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
- Use Supabase Realtime subscriptions.
- Encapsulate subscription logic in a specialized Service (e.g., `RealtimeService.subscribeToRoom(id)`).
- Debounce text inputs in the UI before sending updates to avoid strict rate limits, but listen to incoming changes immediately.

### Split-Pane View
- This is a layout concern. Ensure the "Main Editor" and "Reference View" are decoupled.
- They should verify data via the Store, not passed props deeper than 2 levels.
