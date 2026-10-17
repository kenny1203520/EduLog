# EduLog 2.0 prerelease tracking

The first alpha releases the currently available features. It does not deploy production or promise a date for the stable release. Each completed batch gets a new alpha number and an updated changelog; published tags and versioned images must not be overwritten.

| Item | Current state | Completion condition |
| --- | --- | --- |
| School history create/update | Fixed in alpha.1 | Writable-only payloads; blank dates persist as null; unrelated patches preserve dates; regression tests pass. |
| OAuth callbacks | Deferred; no enabled login entrypoint | Agree on supported providers and redirects, implement server configuration and callback flow, and verify login/error/security cases before exposing the entrypoint. |
| Storage proxy | Deferred; no current frontend Storage calls | Agree on the upload/download workflow, implement permission-checked server-issued signed URLs, and verify authorization before exposing the feature. |
| Remaining intended 2.0 features | Not yet enumerated in repository documentation | Confirm the final feature list with the maintainer; record each item's acceptance criteria and target alpha here. |
| Database upgrade | Required for evaluation installs | Back up and verify the full append-only migration chain through the release's documented endpoint; validate existing data and permission boundaries. |

OAuth and Storage are known deferred capabilities, not automatic requirements for stable 2.0. Their inclusion must be decided when the final feature list is confirmed.

## Stable promotion criteria

- The agreed final feature list is complete or explicitly deferred out of 2.0.
- No release-blocking known bugs remain.
- Frontend/API tests and builds, migration/RLS/security gates, and image health checks pass for the exact release commit.
- Login, roster/report workflows, collaboration recovery, and authorization are verified in an evaluation deployment.
- Database upgrade and backup restoration are verified with representative existing data.
- Publish a new `v2.0.0` tag and non-prerelease Release, with matching frontend/API images; only stable releases update stable aliases.
