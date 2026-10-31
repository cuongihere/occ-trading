# Read-only connector. Credentials are never written to disk.
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
Set-Location -LiteralPath $root
& (Join-Path $root 'BOOTSTRAP_RUNTIME.ps1')
if($LASTEXITCODE -ne 0){throw 'Node runtime setup failed'}
Write-Host 'Binance Futures BTCUSDT READ-ONLY account verification' -ForegroundColor Cyan
Write-Host 'Enter API credentials locally. Do NOT send them to ChatGPT or GitHub.'
$k=Read-Host 'API KEY (hidden)' -AsSecureString
$s=Read-Host 'API SECRET (hidden)' -AsSecureString
$kp=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($k)
$sp=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
try{
 $env:BINANCE_FUTURES_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($kp)
 $env:BINANCE_FUTURES_API_SECRET=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($sp)
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($kp)
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($sp)
}
try{
 & (Join-Path $root 'runtime\node.exe') (Join-Path $root 'CHECK_BINANCE.mjs')
 if($LASTEXITCODE -ne 0){throw 'Binance verification failed'}
}finally{
 Remove-Item Env:\BINANCE_FUTURES_API_KEY -ErrorAction SilentlyContinue
 Remove-Item Env:\BINANCE_FUTURES_API_SECRET -ErrorAction SilentlyContinue
}
