# Automated application releases

Push a version tag to build and publish the frontend, API and Presidio analyzer images, then create the matching GitHub Release. Tags use `vMAJOR.MINOR.PATCH` with optional SemVer prerelease identifiers, for example `v2.1.0`, `v2.1.0-alpha.1`, or `v2.1.0-rc.1`. Prerelease numeric identifiers cannot have leading zeroes. Build metadata (`+...`), incomplete versions, and Docker tags longer than 128 characters are rejected.

Before tagging, set `app/package.json`'s `version` to the exact version without the leading `v`. The workflow checks that version against the tagged commit and validates the SemVer syntax before it starts quality, database, security, or image jobs. It checks out and tests the resolved tag commit SHA throughout.

Stable tags publish the versioned images and update `latest`, major, and major.minor aliases. Prerelease tags publish the versioned images and update a channel alias named after the first prerelease identifier: `v2.1.0-alpha.1` updates `alpha`, `-beta.N` updates `beta`, `-rc.N` updates `rc`. They never touch `latest`, and they produce a GitHub pre-release. A Release is created only after all three image pushes succeed. Its notes use GitHub's generated pull request notes, with commit links when no pull request is listed. A matching `.github/releases/<tag>.md` supplies release-specific deployment and migration notes; otherwise the exact version section from `CHANGELOG.md` is included when available. The Release also lists the three image digests and pull commands.

The Compose files default `EDULOG_IMAGE_TAG` to `alpha` until the first stable release; the `v2.0.0` release commit switches that default (in `docker-compose.yml` and `.env.example`) to `latest`.

If a publication job fails, rerun the workflow for the same existing tag using `workflow_dispatch`; the workflow validates the same tag and commit before rebuilding. An already-published Release is left untouched, and an existing draft is updated and published. Existing tags are not backfilled automatically.
