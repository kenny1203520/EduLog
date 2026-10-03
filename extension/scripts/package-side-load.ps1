$ErrorActionPreference = 'Stop'

$extensionRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $extensionRoot '..')).Path
$distributionRoot = Join-Path $extensionRoot 'dist'
$packageName = 'EduLog-Teaching-Tools-0.1.0-import-verification'
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
    Copy-Item -LiteralPath (Join-Path $extensionRoot 'tests/ACCEPTANCE.md') -Destination $stagingPath

    $migrationPath = Join-Path $stagingPath 'supabase/migrations'
    New-Item -ItemType Directory -Path $migrationPath -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'supabase/migrations/1000122_extension_import_verification.sql') -Destination $migrationPath

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
