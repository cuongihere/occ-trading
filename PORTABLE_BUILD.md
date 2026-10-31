# Đóng gói portable Windows x64

Không cài runtime hệ thống. Các lệnh dưới đây chỉ tải ZIP chính thức, xác minh SHA256, giải nén vào thư mục dự án và tạo ZIP sạch. Không tắt chính sách bảo mật hoặc tự chạy ứng dụng.

Mở PowerShell tại thư mục mã nguồn sạch (cạnh `server.mjs`), chạy từng đoạn và dừng nếu có lỗi:

```powershell
$ErrorActionPreference = 'Stop'
$version = 'v24.22.2'
$expected = 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
New-Item -ItemType Directory -Force dist | Out-Null
$zip = Join-Path $PWD 'dist/node-v24.22.2-win-x64.zip'
Invoke-WebRequest "https://nodejs.org/dist/$version/node-$version-win-x64.zip" -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Runtime checksum mismatch. Stop; do not run this file.'
}
$stage = Join-Path $PWD 'dist/OCC_Portable'
if (Test-Path $stage) { throw 'dist/OCC_Portable already exists. Use a clean build directory.' }
Expand-Archive -LiteralPath $zip -DestinationPath 'dist/node-extracted'
New-Item -ItemType Directory -Path "$stage/runtime" -Force | Out-Null
$source = Join-Path $PWD 'dist/node-extracted/node-v24.22.2-win-x64'
'node.exe','LICENSE','README.md','CHANGELOG.md' | ForEach-Object {
    Copy-Item (Join-Path $source $_) "$stage/runtime/"
}
'server.mjs','server-feed.mjs','engine.mjs','store.mjs','stats.mjs',
'START_WINDOWS.bat','README_VI.md','RUNTIME_SOURCE.txt','PORTABLE_BUILD.md' | ForEach-Object {
    Copy-Item $_ $stage
}
if ((Get-FileHash "$stage/runtime/node.exe" -Algorithm SHA256).Hash.ToLowerInvariant() -ne '1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9') {
    throw 'node.exe checksum mismatch. Stop.'
}
Compress-Archive -Path $stage -DestinationPath 'dist/OCC_Portable_Windows_x64.zip'
Get-FileHash 'dist/OCC_Portable_Windows_x64.zip' -Algorithm SHA256
```

Chỉ các file trong danh sách được đóng gói; không chép `data`, cơ sở dữ liệu, thông tin đăng nhập hoặc nhật ký cá nhân. Người nhận giải nén toàn bộ ZIP rồi bấm START_WINDOWS.bat; không cần cài Node.js.

Nguồn chính thức / checksum upstream: https://nodejs.org/dist/v24.22.2/SHASUMS256.txt

Lệnh PowerShell được rà soát tĩnh, chưa thực thi trên Windows thật. Chỉ dành cho Windows x64. Không có GitHub Release/binary được công bố bởi tài liệu này.
