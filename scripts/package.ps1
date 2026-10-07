$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputDir = Join-Path $projectRoot 'submission'
[System.IO.Directory]::CreateDirectory($outputDir) | Out-Null
$zipPath = Join-Path $outputDir ('clearline-review-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
# Explicit allowlist. Never include .env, .git or local test outputs.
$topFiles = @('README.md','TEST_CASES.md','package.json','server.mjs','.env.example','.gitignore')
$folders = @('public','lib','samples','tests','scripts')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($relative in $topFiles) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $projectRoot $relative), $relative) | Out-Null
    }
    foreach ($folder in $folders) {
        Get-ChildItem -LiteralPath (Join-Path $projectRoot $folder) -File -Recurse | ForEach-Object {
            $relative = $_.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $relative) | Out-Null
        }
    }
} finally { $archive.Dispose() }
Write-Output $zipPath
