# Portable runtime bootstrap. Windows PowerShell 5.1+, Windows x64 only.
# Downloads directly from nodejs.org, pins both archive and executable SHA256.
# No installer, machine-wide configuration, PATH mutation, or elevated privileges.
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$version = 'v24.22.2'
$archiveHash = 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
$exeHash = '1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9'
$app = $PSScriptRoot
$runtime = Join-Path $app 'runtime'
$nodeExe = Join-Path $runtime 'node.exe'
$work = Join-Path $app '.runtime-setup'
function IsValidRuntime {
    if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { return $false }
    if (-not (Test-Path -LiteralPath (Join-Path $runtime 'LICENSE') -PathType Leaf)) { return $false }
    return ((Get-FileHash -LiteralPath $nodeExe -Algorithm SHA256).Hash.ToLowerInvariant() -eq $exeHash)
}
if (-not [Environment]::Is64BitOperatingSystem) {
    Write-Error 'OCC portable requires Windows x64.'
    exit 1
}
if (IsValidRuntime) {
    if (-not $Quiet) { Write-Host '[OCC] Verified portable Node.js runtime already available.' }
    exit 0
}
try {
    Write-Host '[OCC] Preparing private runtime in application folder (first launch needs Internet).'
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $zip = Join-Path $work 'node-windows-x64.zip'
    $url = "https://nodejs.org/dist/$version/node-$version-win-x64.zip"
    # Windows PowerShell 5.1 uses TLS 1.2 for the official HTTPS endpoint.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 180
    $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $archiveHash) { throw "Downloaded ZIP SHA256 mismatch. Refusing to run it." }
    $unpacked = Join-Path $work 'unpacked'
    Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
    $source = Join-Path $unpacked "node-$version-win-x64"
    $staging = Join-Path $work 'runtime-new'
    New-Item -ItemType Directory -Path $staging | Out-Null
    foreach ($name in @('node.exe','LICENSE','README.md','CHANGELOG.md')) {
        $sourceFile = Join-Path $source $name
        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Missing official runtime component: $name" }
        Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $staging $name)
    }
    $stagedHash = (Get-FileHash -LiteralPath (Join-Path $staging 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($stagedHash -ne $exeHash) { throw "Extracted node.exe SHA256 mismatch. Refusing to run it." }
    if (Test-Path -LiteralPath $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
    Move-Item -LiteralPath $staging -Destination $runtime
    if (-not (IsValidRuntime)) { throw 'Final runtime verification failed.' }
    Write-Host '[OCC] Portable runtime installed and verified in .\runtime\.'
    exit 0
} catch {
    Write-Host ('[OCC] Runtime installation failed: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host '[OCC] Application did not start. Check Internet access and folder permissions.'
    exit 1
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}
