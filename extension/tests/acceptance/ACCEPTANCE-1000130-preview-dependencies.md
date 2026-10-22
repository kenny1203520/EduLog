# EduLog 0.1.0 acceptance: preview dependencies and UI repair

## Included changes

- Popup uses a stable 390px layout target with one vertical scroll area.
- The source-site integration panel uses the same width rules with the theme enabled or disabled. It has an explicit close control, Escape and outside-click dismissal, and focus restoration.
- Workspace review panels use a viewport-based height on short screens.
- Import batches can reference verified enrollment checkpoints from earlier previews in the same job. Preview manifests store identifiers and relationship fingerprints only; they do not store source report text.
- Reference errors expose bounded row, kind, field, and reason keys. The workspace retains blocked rows, retries eligible rows separately, and asks before syncing only eligible batches.
- Servers without the dependency RPC return a localized, safe retry message and do not weaken reference checks.

## Automated results

| Check | Result |
| --- | --- |
| Extension tests | 213 passed |
| API router tests | 20 passed |
| Server TypeScript typecheck | Passed |
| PGlite migration and workspace regression | Passed, including 1000130 dependency checks, invalid fingerprints, cross-job rejection, apply ordering, and history persistence |
| Browser layout script | Not run: Playwright is not installed in this workspace |

The PGlite cases verify that a history batch can preview against a same-job enrollment manifest, cannot apply before the enrollment batch is applied, and becomes eligible after the parent is written. Mismatched fingerprints and cross-job dependencies are rejected. Existing no-dependency batch fingerprints remain compatible.

## Manual acceptance pending

- Load the packaged extension in Chrome and Edge and open the actual toolbar popup. Confirm sizing, long URLs, connected and disconnected states, keyboard navigation, and narrow-window behavior.
- Inspect the site panel with the native theme enabled and disabled; verify close hit target, Escape, outside click, focus return, and panel bounds.
- Inspect workspace panels at 360, 390, 768, 1024, 1200, 1440, and 1920 CSS pixels, a 480px short viewport, and native 200% zoom.
- Run the real sideloaded extension against an authorized test account. Do not submit source teaching forms during acceptance.

Automated tests and PGlite do not count as real Chrome/Edge toolbar popup or production RBAC acceptance. Record those results separately after the manual checks.

## Deployment

Apply `supabase/migrations/1000130_import_preview_dependencies_and_diagnostics.sql`, deploy the updated API, then reload the 0.1.0 extension. Older servers safely block cross-batch previews until updated. Existing jobs and batches retain their stored keys and checkpoints.
