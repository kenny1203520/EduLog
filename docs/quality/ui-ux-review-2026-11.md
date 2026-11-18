# UI/UX and accessibility review: 2026-11

**Scope:** web app (`app/`) at `develop` @ `90f271fd` (2.0.0-alpha.10). This is a report only. No application code was changed.
**Routes audited:** `/login`, `/dashboard`, `/dashboard/classrooms` (including the add-classroom dialog), `/dashboard/students`, `/dashboard/reports/:enrollmentId` (report editor and its confirm modal), `/dashboard/settings`, `/oauth/consent`.
**Checks:** text contrast (≥ 4.5:1), visible focus, keyboard order, labels and ARIA, touch targets (44 px goal, 24 px WCAG 2.2 AA floor), horizontal scroll, reduced motion, error message placement, loading states, toast accessibility, and light/dark at 375 / 768 / 1440 px.
**Target:** WCAG 2.2 AA, plus the 44 px touch-target goal from the brief.

## How this was tested

- **Live:** Vite dev server (`npm run dev`, port 5175) in the Claude desktop browser pane. Viewport and `prefers-color-scheme` were emulated. axe-core 4.10.3 ran on every route (tags `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, `best-practice`). A script also measured target sizes and horizontal overflow and logged every `focusin` (element, `:focus-visible`, computed outline or box-shadow). Keyboard order was checked with real Tab and Escape key presses.
- **Backend:** the configured Supabase/API points at a non-local host, and the repo has no seed accounts. To avoid that host, `/api` was proxied to a throwaway local mock that returned synthetic data (one teacher, two classrooms, three students, one enrollment, one occurrence). The mock lives outside the repo. Some screens therefore show mock-induced error toasts. Those toasts are only used below to study toast behaviour; they are not reported as app bugs.
- **Static:** each live finding was traced to source with `file:line`. Repo-wide scans counted how widespread each pattern is.
- **Guidance packs:** the `modern-web-guidance` lookup (`npx modern-web-guidance`) was blocked by the session's permission policy, so it was not consulted. The `ui-ux-pro-max` skill was not run either. The recommendations rest on WCAG 2.2, the axe results, and patterns already in this repo.
- **Not covered:** real screen readers (NVDA, VoiceOver), a real backend, the browser extension's own dark theme, and every secondary route (courses, holidays, teachers, incomplete reports, student profile were only scanned statically). The pane could not emulate `prefers-reduced-motion`, so motion is assessed from code. The 1440 px screenshots are downscaled by the pane.

Screenshots are in [`ui-ux-review-2026-11/`](ui-ux-review-2026-11/). They are referenced as **[S01]** … **[S17]** below.

## Summary

| Severity | Count | Theme |
|---|---|---|
| Critical | 3 | Modals don't manage focus; the off-screen mobile drawer is in the Tab order; clickable `div`s can't be reached by keyboard |
| High | 6 | Inputs have no visible boundary (Tailwind v4 border regression); invisible focus on primary buttons and inputs; brand-green contrast; unlabeled icon buttons; OAuth consent buttons unstyled and too small; raw API errors on login |
| Medium | 9 | Toast accessibility and contrast; silent session-expiry redirect; status messages not announced; loading states; editor ARIA; segmented-control state |
| Low | 7 | Landmarks and heading order, targets under 44 px, dead animation classes, breakpoint transition, no dark theme, i18n leftovers |

What already works:
- No horizontal scroll at 375, 768 or 1440 on any audited route.
- `<html lang>` follows the locale (`utils/documentHead.ts:55`).
- The report editor has polite live regions for save and collaboration status.
- `BaseCalendar` days are real `role="button"` elements with Enter/Space support.
- `TeacherFormDialog.vue` already uses native `<dialog>.showModal()`, which gives focus containment, Esc, an inert background and focus return. This is the in-repo pattern to copy.
- The login form has labels and `autocomplete`.
- Error toasts carry translated text plus a copyable error code (`useFeedback`).

---

## Critical

### C1. Modal dialogs don't move, trap or restore focus, and Esc is inconsistent
- **Where:**
  - `components/classroom/ClassroomManagementPanel.vue:192`: `role="dialog" aria-modal="true"`, but no focus handling.
  - `components/ui/ConfirmModal.vue:42-47`: no `role`/`aria-modal`/`aria-labelledby`. Its Esc listener is attached on mount even while closed (`:31`). Scroll lock is applied only if the modal is open *at mount* (`:27-29`), so in practice it never applies.
  - `views/ClassroomManagementView.vue:1345` (create-session modal): no role and no focus handling.
  - Same pattern in about 20 other overlay modals (`fixed inset-0` without `<dialog>`), for example `TeacherAssignmentModal.vue`, `EnrollStudentModal.vue`, `TransferModal.vue`, `ConflictModal.vue`, `ReportVersionHistoryModal.vue`, and `CourseManagementView.vue`, `HolidayManagementView.vue`, `StudentManagementView.vue`.
- **Observed:**
  - Opening "新增教室" with the keyboard left focus on the trigger behind the overlay. Tab then moved through the page *underneath* ("只顯示未隱藏", "顯示全部", …), and Escape did not close the dialog **[S11]**.
  - The report page's auto-opened "建立新報告" confirm modal left focus on `<body>`. Tab went to the sidebar language switcher and nav links behind the backdrop, and the body still scrolled **[S13]**.
- **Impact:** keyboard and screen-reader users can't find or operate dialogs, and can act on the page behind a modal (WCAG 2.4.3 Focus Order, 2.1.2, 4.1.2). For ConfirmModal this includes destructive confirmations (delete report or student).
- **Fix direction:** move every modal to one `BaseDialog` built on native `<dialog>.showModal()`, as `TeacherFormDialog.vue` already does. Give it `aria-labelledby` pointing at the title, use `role="alertdialog"` for ConfirmModal, and put initial focus on the least destructive button.

### C2. The closed mobile and tablet nav drawer stays in the Tab order (focus goes off-screen)
- **Where:** `layouts/MainLayout.vue:102-108`. The `<aside>` is hidden only with `-translate-x-full` below `lg`. It is not `inert`, `hidden` or `visibility:hidden`.
- **Observed at 375 and 768:** from the hamburger button, Tab went to the off-canvas close button, then the language switcher, -A, +A, 儀表板, 學生列表, 課程管理 … The focused element's `left` was **−272 px**, so focus was invisible for about 15 stops before reaching page content.
- **Also:**
  - The drawer doesn't move focus in when opened and has no Esc handler (only the account menu has one, `:34-36`).
  - The hamburger (`:80-81`) has no `aria-expanded` or `aria-controls`.
  - The account button (`:92`) reports `aria-expanded` from the *drawer* state.
- **Impact:** WCAG 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured, 2.4.3. Every authenticated page is affected below 1024 px.
- **Fix direction:** below `lg`, set `inert` (and `aria-hidden`) on the `<aside>` while it is closed. Treat the open drawer as a modal: focus the first link, close on Esc, and return focus to the hamburger.

### C3. Clickable `div`s with no keyboard access
- **Where:**
  - `components/occurrence/OccurrenceCalendar.vue:48-50`: the occurrence list under a selected calendar day. This is how a teacher opens a lesson's report from the calendar.
  - `views/StudentReportsView.vue:67`: incomplete-report shortcuts.
  - `components/classroom/TeacherAssignmentModal.vue:124`: the teacher picker.
- **Detail:** each is a `div @click` with no `role`, `tabindex` or key handler. Compare `views/GlobalIncompleteReportsView.vue:154`, which does it right (`role="button" tabindex="0"` with Enter/Space), and `ui/BaseCalendar.vue:43`.
- **Impact:** keyboard-only users can't open a report from the calendar or assign a teacher (WCAG 2.1.1 Keyboard).
- **Fix direction:** use `<button type="button">`, or `<a>` when it navigates. A real button needs no ARIA.

## High

### H1. About 90 form fields have no visible border (Tailwind v4 border regression)
- **Cause:** Tailwind v4's preflight resets every element to `border: 0 solid`. A colour class such as `border-gray-300` *without* a width class (`border`, `border-2` …) therefore draws nothing. The project has no forms plugin, and `style.css` contains only `@import "tailwindcss"`.
- **Where (count of fields per file):**
  - `views/ClassroomManagementView.vue`: 12 (e.g. `:1354`, `:1384`, `:1392`)
  - `components/student/StudentSchools.vue`: 10
  - `StudentCredentials.vue`: 8
  - `StudentMainDetails.vue`: 8
  - `views/CourseManagementView.vue`: 7
  - `components/classroom/ClassroomManagementPanel.vue`: 6 (`:217-233`)
  - `StudentSuspensions.vue`: 6
  - `EnrollStudentModal.vue`: 4
  - `views/HolidayManagementView.vue`: 4
  - `views/LoginView.vue:142-143`: the email field. The password field next to it has `border`, so the two look different.
  - 23 files in total.
- **Observed:** in the add-classroom dialog, every field ("教室名稱", "地址 / 位置", …) renders as plain text on white (computed `border-width: 0px`) **[S11]**. Login email vs. password **[S02]**.
- **Impact:** fields can't be identified as inputs (WCAG 1.4.11 Non-text Contrast, 3:1 for component boundaries). The `focus:border-emerald-500` focus style does nothing on these fields (see H2).
- **Fix direction:** add a base layer that gives fields a border by default (`@layer base { input:where(:not([type=checkbox],[type=radio])), select, textarea { border-width: 1px } }`). Alternatively, add `border` wherever a `border-<colour>` class appears on a field. A lint or contract spec can stop it coming back.

### H2. Focus indicator invisible on primary buttons and many inputs
- **Primary buttons:** buttons with `bg-emerald-600 text-white` and no explicit focus style get Chrome's `outline: auto` in `currentColor`, which is white. On the white cards the ring disappears.
  - Observed on the login "登入" button (`views/LoginView.vue:181`), computed `outline: rgb(255,255,255) auto 3px` **[S04]**. The same applies to similar primary buttons (110 uses of `bg-emerald-600`).
- **Inputs:** the email input's only focus cue is `focus:ring-4 focus:ring-emerald-500/10`, which is 10 % alpha, roughly 1.1:1 against white. Combined with H1, the focused email field looks exactly like the unfocused one **[S03]**.
  - There are 34 low-alpha (`/5`–`/30`) focus rings in 14 files.
- **`outline-none` with no replacement:**
  - `components/report/ReportEditor.vue:103`: the **刪除報告** (delete report) button
  - `views/ClassroomManagementView.vue:970`
  - `views/HolidayManagementView.vue:498`
  - `views/StudentManagementView.vue:81`
  - `components/classroom/TeacherAssignmentModal.vue:117`
- **Impact:** WCAG 2.4.7 Focus Visible and 2.4.13 (AAA) focus appearance.
- **Fix direction:** add one global `:focus-visible { outline: 2px solid var(--focus, #047857); outline-offset: 2px }` in `style.css`, and stop using `outline-none` without a `focus-visible:` replacement. The sign-in-with-Google link already shows a good ring (`focus-visible:ring-2 ring-emerald-600 ring-offset-2`).

### H3. Brand-green and gray-400 text contrast fails site-wide
axe flagged 6 to 15 contrast nodes on every authenticated route. The main pairs, computed:

| Use | Pair | Ratio | Example |
|---|---|---|---|
| Primary button text | white on `emerald-600` #009966 | **3.65** | login 登入, 新增學生, 儲存 |
| Hero CTA | white on `emerald-500` #00bc7d | **2.47** | dashboard 瀏覽課程 (`views/HomeView.vue:149`) |
| Brand text, eyebrow labels, active tabs | `emerald-600` on white / gray-50 / gray-100 | **3.65 / 3.53 / 3.32** | "EduLog" header, "教室管理" eyebrow, segmented tabs |
| Secondary text | `gray-400` #99a1af on white | **2.60** | dashboard italic subtitle, 11 px stat captions |
| Boot loader | `gray-500` on `gray-100` | **4.39** | `App.vue:48-49` "載入中" **[S01]** |

- **Scale:** 182 uses of `text-emerald-600`, 110 of `bg-emerald-600`, 40 of `bg-emerald-500`, 368 of `text-gray-400`. Many of these are 10–12 px uppercase with wide tracking, which makes them even harder to read.
- **Fix direction:** keep the brand hue but move one step darker: `emerald-700` #007a55 gives 5.36:1 with white. Use `gray-500` (4.84) or `gray-600` for secondary text on white. Do this with design tokens or a `@theme` override, not 700 hand edits.

### H4. Icon-only controls without accessible names
- `layouts/MainLayout.vue:80` (hamburger) and `:119` (drawer close): axe `button-name`, critical, on every authenticated page below `lg`.
- `views/HomeView.vue:242`: the icon link to `/dashboard/classrooms` has no name (`link-name`).
- The toast close button is labelled `"close"` in English on a zh-TW page (library default, see M1).
- **Fix direction:** add `aria-label="$t(...)"` and `aria-hidden="true"` on the SVGs.

### H5. OAuth consent: Approve/Deny unstyled at 32×24 px, and the destination isn't shown
- **Where:** `views/OutboundOAuthConsentView.vue:82-83` uses `class="btn-base"`, but `btn-base` is not defined anywhere. The same undefined class is used in `components/settings/OutboundOAuthClients.vue` and `OutboundOAuthGrants.vue`.
- **Observed:** "拒絕" renders as bare text and "同意" as a tight green box, each 32×24 px **[S17]**.
- **Security UX:** the page shows the client *name* (which the client chooses) and the scopes. It does not show `details.redirect_uri` (`:76-80`), even though the API returns it. On a consent screen, the redirect host is the main cue for spotting a look-alike client.
- **Fix direction:** add real button styles (the size of the login buttons, ≥ 44 px), make Deny equally visible, and show the redirect host (e.g. `partner.example.com`) under the app name.

### H6. Login shows raw English API errors
- **Where:** `views/LoginView.vue:94-105` matches Supabase message strings ("Invalid login credentials" …). The BFF never sends those; it returns `code: 'AUTH_INVALID'` with `message: 'Authentication is invalid'` (`server/src/auth/auth.ts:344`). A wrong password therefore lands in the `else` branch and shows `登入失敗: Authentication is invalid` (mock message shown in **[S05]**).
- **Fix direction:** branch on `e.code`, or reuse `describeError()` like the rest of the app. This is also covered in M3.

## Medium

### M1. Toasts (vue-toastification 2.0.0-rc.5)
Observed on a live error toast **[S14]**:
- **Live region:**
  - `role="alert"` is set on each toast body (`.Vue-Toastification__toast-component-body`). The library defaults to `toastRole: "alert"` for every type.
  - Success and info messages are therefore announced assertively, interrupting the user.
  - The containers have no persistent live region. Announcement depends on the screen reader picking up a newly inserted `role="alert"` node, which is not reliable.
- **Contrast** (library CSS, not overridden anywhere):

  | Toast type | White text on | Ratio |
  |---|---|---|
  | error | #ff5252 | **3.19** |
  | info | #2196f3 | **3.12** |
  | success | #4caf50 | **2.78** |
  | warning | #ffc107 | **1.63** |

- **Close button:** `aria-label="close"` (English), drawn as a 24×95 px "×".
- **Placement:** at ≤ 639 px the toasts are top-centre and cover the fixed mobile header, including the hamburger, until they time out (8 s for errors) **[S16]**.
- **Timing:** `pauseOnHover` is on, but there is no pause on keyboard focus. `draggable: true` adds a drag gesture with no keyboard equivalent. Close still works by keyboard, so this is not a blocker.
- **Good:** reduced motion is honoured for the toast transition (`main.ts:40`), and errors that need action are persistent.
- **Short-term mitigations without replacing the library** (`main.ts:35-55`):
  - `accessibility: { toastRole: 'status', closeButtonLabel: t('common.close') }`, keeping errors on `alert`.
  - CSS overrides for the four background colours.
  - `POSITION.BOTTOM_CENTER` on narrow screens.

  See the replacement recommendation at the end.

### M2. Session expiry silently redirects to /login (known item, confirmed)
- **Where:** `App.vue:16-21` calls `clearSession()` and then `router.replace({ name: 'login', query: { redirect } })`. Nothing is shown, either before or after the redirect, and `LoginView` has no "session expired" message (only `?error=oauth|link`, `:77-78`).
- **Impact:** a teacher in the middle of a report suddenly finds themselves on the login page with no explanation. Local drafts are kept (`useAuthStore.ts:38-41`), but the user isn't told that either.
- **Fix direction:**
  - Pass `reason=expired` and render an inline `role="status"` notice on the login page: "登入已逾時，請重新登入；未儲存的報告草稿已保留在此裝置".
  - Optionally, warn about 2 minutes before expiry with a "繼續工作" action (WCAG 2.2.1 Timing Adjustable).

### M3. Inline errors and status changes are not announced
- **Login error block:** `views/LoginView.vue:165-174` is inserted without `role="alert"` or a live region. Focus stays on the password field, and the field gets no `aria-invalid` or `aria-describedby` **[S05]**.
- **Field-level validation:** the API returns per-field errors (`error.fields`), but the classroom, student and course forms (`ClassroomManagementView.vue`, `ClassroomManagementPanel.vue`, `StudentManagementView.vue`, `CourseManagementView.vue`) never set `aria-invalid` or `aria-describedby`. Only 2 components in the whole app use `aria-invalid` (`ReportLessonEntriesEditor.vue`, `AiDeidentificationPanel.vue`).
- **Search results** (students, classrooms) update with no announced result count. No live region was present on either page.

### M4. Loading states
- **Boot screen:** `App.vue:48-49` is a bare `<p>` "載入中" with no `role="status"` and 4.39:1 contrast **[S01]**.
- **Dashboard spinner:** `views/HomeView.vue:251-258` is an SVG with no text alternative or status role. Compare the classroom grid skeleton (`BaseSkeletonCard.vue`), which is `aria-hidden` and leaves the announcement to its caller.
- **"新增教室" button:** `views/ClassroomManagementView.vue:652-660` `await`s five dependency requests before opening the dialog, with no busy state. On a slow network the button seems to do nothing. If any request fails, it throws to the global error toast and the dialog never opens (seen when the mock lacked `/roles`).
- **Fix direction:** add `aria-busy` and a disabled spinner on the trigger. Open the dialog immediately with skeletons, and degrade gracefully per tab.
- **Good:** `aria-busy` is used in 24 places, and the report editor shows "協作暫停" and save state in polite live regions.

### M5. Report editor: rich-text areas lack textbox semantics
- **Where:** `components/text-editor/TextEditor.vue:89` and `CollaborativeTextEditor.vue:105` set `aria-label` on Tiptap's `contenteditable` `div` with no `role`. axe reports `aria-prohibited-attr` for 聯絡欄, 課堂筆記/記錄 and 學習報告. Some screen readers ignore the label.
- **Fix direction:** add `role: 'textbox'`, `'aria-multiline': 'true'` and the label to the editor attributes, or use `aria-labelledby` pointing at the visible section heading.

### M6. Rating input targets are 14×28 px
- **Where:** `components/ui/RatingInput.vue:46-60`. Each half-star is a separate button 14 px wide (評為 0.5 / 5 分 …), placed next to each other.
- **Impact:** below the 24 px WCAG 2.5.8 minimum in width, and far below 44 px. Hard to hit on a phone, and that's where classroom ratings are often entered.
- **Fix direction:** keep 0.5 steps, but use a 44 px star with left/right halves inside one `role="radiogroup"` and arrow-key support, or a `<input type="range">`.

### M7. Segmented controls and filters don't expose their state
- **Where:** `views/ClassroomManagementView.vue:987` and `:992` (教室管理 / 班級時段), and the visibility filters (只顯示未隱藏 / 顯示全部 / 只顯示已隱藏). The selected state is shown only by colour and a white background.
- **Missing:** `aria-pressed`, `aria-selected` or a `role="tablist"`.
- **Also:** the text is 10–11 px uppercase, and the targets are 29–32 px tall.

### M8. Small targets on secondary report actions
- **Where:** `components/report/ReportEditor.vue` header buttons 報告參考查詢 / 版本紀錄 / 範本管理 / 刪除報告 are 20 px tall. axe `target-size` fails two of them at 1440. Also:
  - the "返回" back button, 60×24
  - copy-course-info icon buttons, 24×24
- **Impact:** together with H2, the delete button is small, red-on-white and has no focus ring.

### M9. Reduced motion only partly honoured
- **Count:** 133 `animate-*` uses vs 22 `motion-reduce:` overrides. Also 58 `active:scale-*`, 25 `hover:scale/translate-*`, `transition-all duration-300` on the sidebar, and `duration-700` on the editor shadow (that one is handled).
- **No global rule:** there is no `@media (prefers-reduced-motion: reduce)` reset in `style.css`.
- **Fix direction:** add one global reset that shortens animations and transitions, and keep spinners (they show state) but slow them.

## Low

- **L1. Landmarks and headings:**
  - No `<main>` on `/login` (axe `landmark-one-main`, `region`). The login page has no `h1` during boot.
  - `heading-order` skips (an `h3` card title directly under an `h1`) on the dashboard, classrooms and students pages.
  - Two unnamed `<aside>`/`<nav>` landmarks on settings (`landmark-unique`).
- **L2. Targets of 40×40 px** (pass AA, miss the 44 px goal): hamburger, -A / +A font-size buttons, the dashboard icon link, the 36 px search inputs, and the password show/hide toggle (40×58).
- **L3. Dead `animate-in` / `fade-in` / `zoom-in` / `slide-in-from-*` classes** (48 uses): these come from `tailwindcss-animate`/`tw-animate-css`, and neither is installed, so they do nothing. Remove them or add the plugin; at the moment they mislead readers of the code.
- **L4. Sidebar transitions across breakpoints:** `transition-all duration-300` on `<aside>` (`MainLayout.vue:103`) animates the drawer sliding over content whenever the viewport crosses `lg`, for example when rotating a tablet **[S07]**.
- **L5. No dark theme in the web app:** with `prefers-color-scheme: dark` the app renders exactly as in light mode **[S09]**. There are 0 `dark:` classes, no `color-scheme` and no `<meta name="color-scheme">`. Not a WCAG failure, and dark mode is currently provided by the extension's site theme (`docs/deployment/extension-privacy.md`). Because there are no dark styles, every contrast result above applies to both schemes. Add `color-scheme: light` so native controls and scrollbars stay consistent, and plan dark tokens together with H3.
- **L6. i18n leftovers:**
  - The toast close label (M1) and raw API errors (H6) are in English.
  - Third-party sign-in buttons show the letter "G" as the icon for both Google and GitHub **[S02]**.
- **L7. Inconsistent focus colours:** a mix of the browser default (orange `auto` ring), emerald rings and white rings. Settle on one token (H2).

---

## Recommendation: replacing vue-toastification

**Status:**
- `vue-toastification@2.0.0-rc.5` is a release candidate, last published in May 2022. Its npm `latest` tag is still the Vue 2 line (1.7.14).
- It is pinned with `^`, which never moves off an rc, and it has no Vue 3.5 or Vite 8 maintenance.
- On top of the issues in M1, it is supply-chain and upgrade risk with no upstream fixes coming.

**Coupling in the codebase:**
- `composables/useFeedback.ts` is the intended single entry point. It already owns translation, the `ErrorToast` body and timeouts.
- But **29 files make 67 direct `toast.success/error/info/warning` calls** through `useToast()` from `vue-toastification`, contrary to useFeedback's own doc comment. For example `ClassroomManagementView.vue`, `StudentReportsView.vue`, `composables/session/*` and `composables/report/*`.
- `main.ts:5-55` holds the plugin options and the de-duplicating `filterBeforeCreate`.

**Recommended path:**
1. **First (no new dependency):**
   - Route the 67 direct calls through `useFeedback`, and add an ESLint `no-restricted-imports` rule for `vue-toastification` outside `useFeedback.ts`/`main.ts`.
   - Apply the M1 config mitigations (`toastRole` per type, localised close label, accessible colours, bottom placement on mobile).

   This fixes the user-facing problems by itself and makes the library swappable.
2. **Then replace the backend of `useFeedback`.** Two viable options:
   - **`vue-sonner`** (Vue 3 port of Sonner, actively maintained, 2.x in 2025). Advantages:
     - It renders one persistent `<section aria-live="polite">` region with a keyboard shortcut to reach toasts.
     - It supports custom component toasts (for `ErrorToast`), `duration: Infinity` for persistent errors, `id`-based de-duplication, and pausing on hover.
     - Reasonable default contrast.
     - About 1 day of work once step 1 is done.
     - Verify in a spike that error toasts can still use an assertive region (`role="alert"`) and that `prefers-reduced-motion` is respected.
   - **In-house `ToastRegion.vue`** (about 150 lines): two always-mounted regions (`role="status"` polite and `role="alert"` assertive), a Pinia queue with the existing `toastSignature` de-dup and `MAX_TOASTS`, `TOAST_TIMEOUTS`, and pause on hover and focus. No dependency, and full control of contrast, tokens and motion, which suits a small, security-sensitive app. Costs a little more upkeep.

   **Recommendation:** do step 1 now, then take **vue-sonner** unless the spike shows it can't keep assertive errors, in which case build the in-house region. Either way, add a component test that asserts the live-region roles and the localised close label.

## Suggested fix order

1. C1 + C2: shared `BaseDialog` (native `<dialog>`) and an inert drawer. Biggest keyboard and screen-reader gain, contained in a few components.
2. H1 + H2 + H3: one `style.css` base layer (field borders, global `:focus-visible`, reduced-motion reset) plus emerald and gray token shifts. Fixes hundreds of instances at once; check visually.
3. C3, H4, H5, H6: small targeted edits.
4. M1 (step 1 of the toast plan) and M2 (expired-session notice).
5. The remaining Medium and Low items.

## Screenshot index

| Ref | File | Shows |
|---|---|---|
| S01 | `01-boot-loader-375.jpg` | Boot "載入中", low contrast, no status role |
| S02 | `02-login-375.jpg` | Login: borderless email vs bordered password; "G" icon for GitHub |
| S03 | `03-login-375-email-focused.png` | Email field focused, no visible indicator |
| S04 | `04-login-375-signin-button-focused.png` | 登入 focused, white ring invisible |
| S05 | `05-login-375-error.jpg` | Raw API message inline, not announced |
| S06–S08 | `06/07/08-dashboard-*.jpg` | Dashboard at 375 / 768 / 1440 |
| S09 | `09-dashboard-1440-dark-scheme.jpg` | `prefers-color-scheme: dark`, unchanged |
| S10 | `10-classrooms-768.jpg` | Classroom list, segmented controls |
| S11 | `11-classroom-dialog-375.jpg` | Add-classroom dialog: borderless fields; focus left behind |
| S12 | `12-students-375.jpg` | Student list |
| S13 | `13-report-confirm-modal-1440.jpg` | ConfirmModal with focus on the page behind |
| S14 | `14-error-toast-1440.jpg` | Error toast (library colours, `role="alert"`) |
| S15 | `15-report-editor-1440.jpg` | Report editor |
| S16 | `16-settings-375-toast-over-header.jpg` | Mobile toast covering the header and hamburger |
| S17 | `17-oauth-consent-375.jpg` | OAuth consent: unstyled 32×24 buttons, no redirect host |
