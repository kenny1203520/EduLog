# Extension release pipeline acceptance

Date: 2026-10-18. Runtime includes theme startup fix 84640ea8358b215f63a854f14ab3de6b75d3bdab. The exact packaging commit is recorded in the delivered release.json; the older 0.1.1.1 archive used ab4438782a4d340ea95b038070c87319cb4e5322.

## Delivered

- Reproducible beta package version 0.1.1.2, display version 0.1.1-beta.2, fixed sideload ID caefagceiajdhjnmogiaicaijckmplge.
- ZIP, SHA-256, source/file metadata and tester instructions in extension/dist/beta/.
- Separate PR (develop/master), develop and tag CI, default ZIP channel, disabled stable channel, API capability gate and immutable GitHub release assets.
- Optional Chrome Web Store API V2 publishing through OIDC/service account; durable upload/submission receipts and a separate readonly status workflow.
- Tester, deployment, store-listing and privacy-policy draft documentation.

## Verification

- Extension unit suite: 394 passed.
- Release tooling suite: 20 passed, including deterministic Git-object packaging, archive corruption/missing files, numeric versions, API compatibility, lost responses, immutable receipts and duplicate-publication prevention, public-key acceptance, credential redaction and rejection of secrets hidden in allowed runtime files.
- Extension API suite: 47 passed across four test files.
- Isolated PGlite extension workspace/catalog/mapping/history/permission/lifecycle contracts passed, including migration 1000141.
- Server typecheck passed; actionlint accepted both new workflows; git diff whitespace checks passed.
- Pattern-based source scan passed over 200 extension/release/workflow files. Actual archive validation applies the same credential checks to unpacked runtime files. This does not establish the absence of secrets in all Git history or remote logs.
- Official Actions references were resolved to full commits through GitHub's API. All checkout steps disable credential persistence; ZIP publishing has no OIDC permission. Store status uses a separate protected environment; its readonly request scope does not make the shared publisher identity permanently readonly.
- Real packaged MV3 installation in Playwright Chromium passed: fixed ID, service worker, popup messaging, actual content scripts, host scope, installation UUID and preferences across restart, and persistence through the real segmented IndexedDB work store.
- Startup/refresh/Turbo navigation recheck passed 28 recordings in Chrome/Edge. The initial Chrome run used the obsolete expectation that a late preference never enables the theme; the corrected scenario verifies native fallback followed by automatic theme activation. Evidence: extension/tests/artifacts/startup-release-recheck/startup-results.json.
- Independent .NET ZIP extraction verified all 63 runtime entries against release.json hashes; CI also validates the archive with the system unzip tool.
- Chrome/Edge synthetic suites cover page layouts, startup and recovery, accounts, hours, native editor/date/rating, workspace, history, mapping, save recovery and stale recovery.
- Earlier mapping and reconciliation reruns passed all eight viewports in both browsers; hours recovery passed all four viewports in both. Their historical evidence remains in extension/tests/artifacts/ci-mapping-final.log, ci-reconciliation-final.log and ci-hours-recheck.log. Current screenshot evidence is written under extension/tests/artifacts/ci/ and the individual suites' artifact directories.

Legacy synthetic fixtures were updated for the current preferences panel, workspace storage authorization, native textarea selector, actual responsive back-button visibility, saved-mapping duplicate prevention and source identity preservation on incomplete rereads. Screenshot paths now use fileURLToPath so Linux CI retains absolute paths. Reconciliation now uses the current history-review pane; transferred-occurrence write eligibility remains verified by the executable database contract rather than the removed legacy report picker.

Some localhost/browser tests cannot run inside the desktop sandbox. Their successful runs used isolated profiles and synthetic fixtures outside that sandbox, without a live teaching API or source-site submission.

## External acceptance still required

- Configure the deployed test API URL, exact-ID allowlist, complete migration chain and a dedicated paired CI credential.
- Configure branch/tag rulesets, environment deployment restrictions and the documented numeric-repository-ID/workflow/ref OIDC conditions. These are external settings, not enabled by committing YAML.
- Execute the new workflows on GitHub after committing/pushing these files; local checks do not prove remote Actions execution or OIDC/IAM configuration.
- Create the developer account/item, tester group, listing assets, publisher contact and publicly reachable reviewed privacy policy before enabling store distribution.
- Verify real Google-account access to the private listing and native Chrome/Edge installation, permissions, pairing, update and recovery with the intended environment.
- The source site's teaching forms remain manually reviewed/submitted. No real teaching records were written during these checks.
