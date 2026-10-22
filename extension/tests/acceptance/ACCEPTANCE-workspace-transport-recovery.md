# EduLog 0.1.0: workspace transport and draft recovery

## Changes

- Workspace save, list, open, and delete operations first ask the extension worker to validate the current binding. Only instance, account, action, work ID, and revision cross the runtime message channel.
- The workspace then reads or writes segmented drafts through the existing IndexedDB store. Work history lists contain only compact summaries; a selected or resumed work loads its full draft on demand. A save response contains metadata rather than a cloned report body.
- Runtime messaging failures retain a bounded diagnostic code for invalidated contexts, closed channels, missing receivers, oversized messages, and other bridge failures. Diagnostics include stage, current work and batch identifiers, revision, approximate work size, and the last successful save for that work; report bodies and credentials are excluded.
- A failed or uncertain save pauses preview and sync. Explicit retry saves the current draft first and rechecks the existing import job with its original batch identifiers.

## Verification

- The full extension test suite passed: 270 tests. Focused cases cover bridge error classification, storage authorization and account ownership, compact list summaries, preview retry behavior, and batch request integrity.
- The synthetic browser suite was run in Chrome and Edge. It covered initial entries, a failed first save followed by an explicit retry, persisted IndexedDB contents, the metadata-only runtime boundary, responsive viewports, and the import flow. The suite reported no uncaught page errors or unhandled promise rejections.
- The packaging script parses every JavaScript file in the staged archive before replacing the output archive.
- No live source teaching report was submitted. No server endpoint or SQL migration was added.

## Acceptance still pending

- Reloading the real unpacked extension while a large draft is being saved, then verifying recovery after the worker restarts.
- A real Chrome/Edge installed-extension run against the user's API and account.
- Measuring a real draft's serialized size and save time. The reported `/imports` 200 response only confirms job creation and does not identify the later bridge failure's exact cause.
