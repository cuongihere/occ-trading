# Build a complete Windows x64 portable distribution with verified runtime.
# Run from repository root: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\BUILD_PORTABLE.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'OCC_Portable'
$archive = Join-Path $dist 'OCC_Portable_Windows_x64.zip'
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$files = @(
    'START_WINDOWS.bat','BOOTSTRAP_RUNTIME.ps1',
    'CHECK_BINANCE_WINDOWS.bat','CHECK_BINANCE.ps1','CHECK_BINANCE.mjs','binance-account.mjs','binance-live-stats.mjs','BINANCE_API_SETUP.md',
    'futures-transport.mjs','futures-sizing.mjs','futures-order-plan.mjs','futures-lifecycle.mjs','futures-protection-plan.mjs','FUTURES_EXECUTION_STATUS.md',
    'server.mjs','server-feed.mjs','engine.mjs','store.mjs','stats.mjs',
    'dashboard.html','BINANCE_UI_PREVIEW.html','package.json','README.md','README_VI.md',
    'RUNTIME_SOURCE.txt','PORTABLE_BUILD.md'
)
foreach ($file in $files) {
    $src = Join-Path $root $file
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "Missing source file: $file" }
    Copy-Item -LiteralPath $src -Destination (Join-Path $stage $file)
}
& (Join-Path $stage 'BOOTSTRAP_RUNTIME.ps1')
if ($LASTEXITCODE -ne 0) { throw "Runtime bootstrap failed with exit code $LASTEXITCODE" }
$node = Join-Path $stage 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw "Missing portable node.exe" }
& $node --version
if ($LASTEXITCODE -ne 0) { throw 'Bundled node.exe could not run.' }
Compress-Archive -LiteralPath $stage -DestinationPath $archive -CompressionLevel Optimal
Write-Host "Portable ZIP: $archive"
Get-FileHash -LiteralPath $archive -Algorithm SHA256
