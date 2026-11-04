# SonarCloud 704 finding inventory status

The attached SonarCloud export is page 2 of 2 (total=704, pageSize=500) and contains exactly 204 issue records. Its analysis UUID is 6cece5b1-4432-442b-bf3a-153f2ff0c9c1.

[sonarcloud-704-page-2.csv](sonarcloud-704-page-2.csv) records each issue key, rule, severity, file, line, message, and current disposition. It excludes author emails and other account metadata.

The 204 rows reconcile to the export counts: 160 Vue accessibility findings, 32 shell conditional findings, 7 TypeScript findings, 2 shell security findings, 2 commented secret placeholders, and 1 Envoy SHA-1 hotspot.

The screenshots were reviewed as visual evidence for the first-page findings. The visible groups include GitHub Actions pinning, webhook example secrets, extension input/path handling, Envoy authentication and proxy exposure, shell upgrade scripts, provider parsing and async reliability, Vue form labels, and workspace translations. Corresponding fixes are split across the branch commits.

The issue cards in the screenshots do not expose machine-readable issue keys, and their text is not consistently legible enough to reconcile every one of the first 500 rows individually. The page-2 CSV is the only row-level inventory. Treat the screenshots as coverage evidence, not as a completed 704-row checklist. Duplicate IDs in provider HTML fixtures are retained because those fixtures model external provider markup and the extension tests explicitly exercise that case.
