$ErrorActionPreference = 'Stop'

$extensionRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $extensionRoot '..')).Path
$distributionRoot = Join-Path $extensionRoot 'dist'
$packageName = 'EduLog-Teaching-Tools-0.1.0-student-review-i18n'
$archivePath = Join-Path $distributionRoot "$packageName.zip"
$temporaryRoot = [System.IO.Path]::GetTempPath()
$stagingPath = Join-Path $temporaryRoot "edulog-package-$([guid]::NewGuid().ToString('N'))"

New-Item -ItemType Directory -Path $distributionRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stagingPath | Out-Null

try {
    Get-ChildItem -LiteralPath $extensionRoot -File | Where-Object {
        $_.Name -match '^(manifest\.json|.*\.(js|html|css)|README\.md)$'
    } | Copy-Item -Destination $stagingPath

    $adapterPath = Join-Path $stagingPath 'adapters'
    New-Item -ItemType Directory -Path $adapterPath | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $extensionRoot 'adapters') -File | Copy-Item -Destination $adapterPath

    $docsPath = Join-Path $stagingPath 'docs/deployment'
    New-Item -ItemType Directory -Path $docsPath -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'docs/deployment/extension-workspace.md') -Destination $docsPath
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'docs/deployment/extension-transferred-occurrence.md') -Destination $docsPath
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'docs/deployment/extension-enrollment-history.md') -Destination $docsPath
    Copy-Item -LiteralPath (Join-Path $extensionRoot 'tests/ACCEPTANCE.md') -Destination $stagingPath
    Copy-Item -LiteralPath (Join-Path $extensionRoot 'tests/ACCEPTANCE-1000125.md') -Destination $stagingPath
    Copy-Item -LiteralPath (Join-Path $extensionRoot 'tests/ACCEPTANCE-1000126.md') -Destination $stagingPath
    Copy-Item -LiteralPath (Join-Path $extensionRoot 'tests/ACCEPTANCE-student-review-i18n.md') -Destination $stagingPath

    $migrationPath = Join-Path $stagingPath 'supabase/migrations'
    New-Item -ItemType Directory -Path $migrationPath -Force | Out-Null
    foreach ($migration in @(
        '1000118_web_extension_workspace.sql',
        '1000119_extension_catalog.sql',
        '1000120_extension_mapping_memory.sql',
        '1000121_extension_reconciliation.sql',
        '1000122_extension_import_verification.sql',
        '1000123_extension_report_candidates.sql',
        '1000124_extension_field_mappings.sql',
        '1000125_extension_transferred_occurrence_import.sql',
        '1000126_enrollment_history_reports.sql'
    )) {
        Copy-Item -LiteralPath (Join-Path $repositoryRoot "supabase/migrations/$migration") -Destination $migrationPath
    }

    $manifest = Get-Content -LiteralPath (Join-Path $stagingPath 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.version -ne '0.1.0') { throw 'The prerelease extension must remain at version 0.1.0.' }
    $entryFiles = @($manifest.background.service_worker, $manifest.action.default_popup)
    foreach ($contentScript in $manifest.content_scripts) {
        $entryFiles += @($contentScript.js)
        $entryFiles += @($contentScript.css)
    }
    foreach ($entryFile in $entryFiles) {
        if ($entryFile -and -not (Test-Path -LiteralPath (Join-Path $stagingPath $entryFile) -PathType Leaf)) {
            throw "Missing extension entry file: $entryFile"
        }
    }

    # Check local module and HTML dependencies, including non-manifest workspace modules.
    $dependencyPattern = '(?:\b(?:from|import)\s*["'']|\b(?:src|href)=["''])(\.?\.?/[^"'']+|[^"'':]+\.(?:js|css))["'']'
    foreach ($sourceFile in (Get-ChildItem -LiteralPath $stagingPath -File -Recurse | Where-Object { $_.Extension -in @('.js','.html') })) {
        $sourceText = Get-Content -LiteralPath $sourceFile.FullName -Raw
        foreach ($reference in [regex]::Matches($sourceText, $dependencyPattern)) {
            $dependency = [System.IO.Path]::GetFullPath((Join-Path $sourceFile.DirectoryName $reference.Groups[1].Value))
            if (-not $dependency.StartsWith($stagingPath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $dependency -PathType Leaf)) {
                throw "Missing or out-of-package dependency in $($sourceFile.Name): $($reference.Groups[1].Value)"
            }
        }
    }

    Compress-Archive -Path (Join-Path $stagingPath '*') -DestinationPath $archivePath -Force
}
finally {
    $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
    $resolvedStagingPath = [System.IO.Path]::GetFullPath($stagingPath)
    if ($resolvedStagingPath.StartsWith($resolvedTemporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and $resolvedStagingPath -ne $resolvedTemporaryRoot) {
        Remove-Item -LiteralPath $resolvedStagingPath -Recurse -Force
    }
}

Write-Output "Created $archivePath"
